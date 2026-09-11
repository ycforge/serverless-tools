import {
  createServer as httpCreateServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as netCreateServer } from 'node:net';
import type { YandexCloudFunctionHandler } from '@ycforge/nestjs-connector';
import { JDT_PORT_IN_USE, LocalDevServerError } from './diagnostics';
import { type YcsfLocalServerOptions, validateOptions } from './options';
import { loadEntryModule } from './entry';
import { createHandler, type ConnectorDeps } from './connector';
import { resolveIamTokenDetailed } from './iam';
import { newRequestId } from './request-id';
import { buildGatewayV2Event } from './payload';
import { buildRawContext } from './context';
import { isYandexFunctionHttpResponse, applyEnvelope, errorResponse } from './response';
import { redactSecrets } from './diagnostics';

export interface LocalDevServer {
  readonly port: number;
  readonly baseUrl: string;
  readonly stop: () => Promise<void>;
}

/** Structural subset of `node:http`.Server needed by the lifecycle. */
export interface HttpServerLike {
  on(
    event: 'request',
    listener: (req: IncomingMessage, res: ServerResponse) => unknown,
  ): unknown;
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  listen(port: number, host: string, callback: () => void): unknown;
  address(): { port: number } | string | null;
  closeIdleConnections(): void;
  close(callback?: (error?: Error) => void): void;
}

export interface CreateServerDeps extends ConnectorDeps {
  readonly validateOptions?: typeof validateOptions;
  readonly loadEntryModule?: typeof loadEntryModule;
  readonly probePort?: (port: number) => Promise<void>;
  readonly resolveIamTokenDetailed?: typeof resolveIamTokenDetailed;
  readonly createHandler?: typeof createHandler;
  readonly createHttpServer?: () => HttpServerLike;
  readonly logWriter?: (text: string) => void;
}

/**
 * Public entry point (S-2, FR-003): creates a local server emulating the
 * Yandex API Gateway v2 transport for one NestJS application module.
 */
export async function createYcsfLocalServer(options: YcsfLocalServerOptions): Promise<LocalDevServer> {
  return createYcsfLocalServerInternal(options);
}

/**
 * Internal seam accepting dependency overrides for unit tests and a widened
 * `options` parameter that arrives already validated.
 */
export async function createYcsfLocalServerInternal(
  options: unknown,
  deps: CreateServerDeps = {},
): Promise<LocalDevServer> {
  const {
    validateOptions: validate = validateOptions,
    loadEntryModule: loadEntry = loadEntryModule,
    probePort: probe = probePort,
    resolveIamTokenDetailed: resolveIam = resolveIamTokenDetailed,
    createHandler: buildHandler = createHandler,
    createHttpServer = () => httpCreateServer(),
    logWriter = defaultLogWriter,
  } = deps;

  const validated = validate(options);
  const appModule = await loadEntry(validated.entry);
  await probe(validated.port);

  // IAM resolution (US3, FR-023).
  let token: string | undefined;
  let iamReason: string | undefined;
  if (typeof validated.yandexContext.token === 'string') {
    token = validated.yandexContext.token;
  } else {
    const detail = await resolveIam();
    if (detail.token !== undefined) {
      token = detail.token;
    }
    iamReason = detail.reason;
  }

  const runtime = buildHandler(appModule);
  const server = createHttpServer();
  const yandexContext = {
    ...validated.yandexContext,
    ...(token === undefined ? undefined : { token }),
  };

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    return onRequest(req, res, runtime.handler, yandexContext, logWriter);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(validated.port, '127.0.0.1', () => resolve());
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(new LocalDevServerError(JDT_PORT_IN_USE, `port ${validated.port} is already in use: ${String(error.code)}`));
    });
  });

  const address = server.address();
  const boundPort =
    typeof address === 'object' && address !== null ? (address.port ?? validated.port) : validated.port;
  const baseUrl = `http://127.0.0.1:${boundPort}`;
  writeBanner(token, iamReason, baseUrl, logWriter);

  let closed = false;
  return {
    port: boundPort,
    baseUrl,
    async stop(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      server.closeIdleConnections();
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error === undefined) {
            resolveStop();
          } else {
            rejectStop(error);
          }
        });
      });
      await runtime.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Per-request pipeline
// ---------------------------------------------------------------------------

async function onRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: YandexCloudFunctionHandler,
  yandexContext: Readonly<Record<string, unknown>>,
  logWriter: (text: string) => void,
): Promise<void> {
  const traceId = newRequestId();
  const start = Date.now();
  let statusCode = 500;
  const secrets = [
    ...extractPerRequestSecrets(req.headers),
    typeof yandexContext.token === 'string' ? yandexContext.token : undefined,
  ];

  try {
    const body = await readBody(req);
    const event = buildGatewayV2Event(req, body, { requestId: traceId });
    const context = buildRawContext({
      requestId: traceId,
      uberTraceId: typeof req.headers['uber-trace-id'] === 'string' ? req.headers['uber-trace-id'] : undefined,
      yandexContext: yandexContext as Readonly<Record<string, unknown>>,
    });
    const result = await handler(event, context);

    if (isYandexFunctionHttpResponse(result)) {
      statusCode = result.statusCode;
      applyEnvelope(res, result, traceId);
    } else {
      statusCode = 500;
      errorResponse(res, 500, new Error('unexpected handler result'), traceId, secrets);
    }
  } catch (error) {
    statusCode = 500;
    logWriter(redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error), secrets));
    errorResponse(res, 500, error, traceId, secrets);
  } finally {
    logWriter(`${req.method ?? 'GET'} ${req.url ?? ''} → ${statusCode} (${Date.now() - start} ms) trace_id=${traceId}`);
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractPerRequestSecrets(headers: IncomingHttpHeaders): ReadonlyArray<string | undefined> {
  const auth = typeof headers.authorization === 'string' ? headers.authorization : undefined;
  const cookie = typeof headers.cookie === 'string' ? headers.cookie : undefined;
  return [auth, cookie];
}

// ---------------------------------------------------------------------------
// Infrastructure helpers
// ---------------------------------------------------------------------------

async function probePort(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const probe = netCreateServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new LocalDevServerError(JDT_PORT_IN_USE, `port ${port} is already in use`)
          : new LocalDevServerError(JDT_PORT_IN_USE, `failed to probe port ${port}: ${String(error.code)}`),
      );
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve());
    });
  });
}

function writeBanner(
  token: string | undefined,
  iamReason: string | undefined,
  baseUrl: string,
  logWriter: (text: string) => void,
): void {
  if (typeof token === 'string') {
    logWriter(
      `local-dev-server listening on ${baseUrl} (apiGatewayV2) — IAM token resolved`,
    );
  } else {
    const reason = iamReason ?? 'no-credential';
    logWriter(`JDT_IAM_UNAVAILABLE: ${reason}`);
    logWriter(
      `local-dev-server listening on ${baseUrl} (apiGatewayV2) — IAM unavailable (JDT_IAM_UNAVAILABLE: ${reason}) — running without token`,
    );
  }
}

function defaultLogWriter(text: string): void {
  process.stderr.write(text + '\n');
}