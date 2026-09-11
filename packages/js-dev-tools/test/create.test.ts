import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IamUnavailableReason } from '../src/server/iam';
import { LocalDevServerError } from '../src/server/diagnostics';
import { createYcsfLocalServerInternal } from '../src/server/create';

class FakeServer extends EventEmitter {
  port = 0;

  listen(port: number, _host: string, callback?: () => void): void {
    this.port = port === 0 ? 41999 : port;
    if (callback) {
      callback();
    }
  }

  address(): { port: number } {
    return { port: this.port };
  }

  closeIdleConnections(): void {}

  close(callback?: (error?: Error) => void): void {
    if (callback) {
      callback(undefined);
    }
    this.emit('close');
  }
}

function mockRequest(url: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: 'GET',
    url,
    rawHeaders: [] as string[],
    headers: {} as Record<string, string>,
  });
  process.nextTick(() => req.emit('end'));
  return req;
}

function mockResponse(): { res: ServerResponse; ended: ReturnType<typeof vi.fn> } {
  const ended = vi.fn((_data?: unknown) => undefined);
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    appendHeader: vi.fn(),
    end: (data?: unknown) => {
      ended(data);
    },
  };
  return { res: res as unknown as ServerResponse, ended };
}

const ENVELOPE = Object.freeze({
  statusCode: 200,
  headers: {},
  body: '{"users":[]}',
  isBase64Encoded: false,
});

interface DepsOverrides {
  yandexContext?: Record<string, unknown>;
  port?: number;
  handlerImpl?: (event: unknown, context: unknown) => Promise<unknown>;
  probeThrows?: Error;
  iamResult?: { token?: string; reason?: IamUnavailableReason };
}

function setup(options: DepsOverrides = {}) {
  const order: string[] = [];
  const appModule = class ProbeAppModule {};
  const server = new FakeServer();
  const handlerImpl = options.handlerImpl ?? (async () => ENVELOPE);
  const handler = vi.fn(handlerImpl);
  const handlerClose = vi.fn(async (): Promise<void> => {
    order.push('handlerClose');
  });
  const serverOrderKey = 'serverClose';

  const deps = {
    validateOptions: vi.fn((raw: unknown) => {
      order.push('validate');
      const input = raw as { entry?: string } & Record<string, unknown>;
      return {
        entry: input.entry ?? './probe.ts',
        apiGatewayV2: true,
        messageQueue: false,
        port: options.port ?? 0,
        yandexContext: options.yandexContext ?? {},
      };
    }),
    loadEntryModule: vi.fn(async (entry: string) => {
      order.push('loadEntry');
      expect(entry).toBe('./probe.ts');
      return appModule;
    }),
    probePort: vi.fn(async () => {
      order.push('probe');
      if (options.probeThrows) {
        throw options.probeThrows;
      }
    }),
    resolveIamTokenDetailed: vi.fn(async () => {
      order.push('resolveIam');
      return options.iamResult ?? {};
    }),
    createHandler: vi.fn((mod: unknown) => {
      order.push('createHandler');
      expect(mod).toBe(appModule);
      return { handler, close: handlerClose };
    }),
    createHttpServer: () => server,
    logWriter: vi.fn(),
  };

  const serverProxy = server as unknown as { close: typeof server.close };
  const originalClose = serverProxy.close.bind(server);
  serverProxy.close = vi.fn((callback?: (error?: Error) => void) => {
    order.push(serverOrderKey);
    originalClose(callback);
  });

  return { deps, order, server, handler, handlerClose };
}

describe('createYcsfLocalServerInternal (FR-003/004/009, S-2)', () => {
  it('runs option validation first in the lifecycle', async () => {
    const { deps, order } = setup();
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    await handle.stop();
    expect(order[0]).toBe('validate');
  });

  it('loads the entry module with the validated entry path', async () => {
    const { deps, server } = setup();
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    await handle.stop();
    expect(deps.loadEntryModule).toHaveBeenCalledWith('./probe.ts');
    void server;
  });

  it('probes the port before creating the handler', async () => {
    const { deps, order } = setup();
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    await handle.stop();
    expect(order.indexOf('probe')).toBeGreaterThan(order.indexOf('loadEntry'));
    expect(order.indexOf('probe')).toBeLessThan(order.indexOf('createHandler'));
  });

  it('rejects with JDT_PORT_IN_USE before the handler is created', async () => {
    const { deps } = setup({
      probeThrows: new LocalDevServerError('JDT_PORT_IN_USE', 'port 3000 busy'),
    });
    const error = await createYcsfLocalServerInternal(
      { entry: './probe.ts' },
      deps,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocalDevServerError);
    expect((error as LocalDevServerError).code).toBe('JDT_PORT_IN_USE');
    expect(deps.createHandler).not.toHaveBeenCalled();
  });

  it('skips IAM resolution when yandexContext.token is set', async () => {
    const { deps } = setup({ yandexContext: { token: 'provided-token' } });
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    await handle.stop();
    expect(deps.resolveIamTokenDetailed).not.toHaveBeenCalled();
  });

  it('resolves IAM when no token is provided and warns on fail-open', async () => {
    const { deps } = setup({ iamResult: { reason: 'no-credential' } });
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    await handle.stop();
    expect(deps.resolveIamTokenDetailed).toHaveBeenCalledTimes(1);
    const warnings = (deps.logWriter.mock.calls as unknown[][]).map((call) =>
      String(call[0]),
    );
    expect(warnings.some((line) => line.includes('JDT_IAM_UNAVAILABLE'))).toBe(true);
  });

  it('invokes the handler exactly once with (rawEvent, rawContext)', async () => {
    const { deps, server, handler } = setup();
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    const requestHandler = (server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => Promise<void>);
    const request = mockRequest('/api/users');
    const { res, ended } = mockResponse();

    await requestHandler(request, res);

    expect(handler).toHaveBeenCalledTimes(1);
    const [event, context] = handler.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(event.rawPath).toBe('/api/users');
    expect(context.requestId).toBe((event.requestContext as Record<string, unknown>).requestId);
    expect(ended).toHaveBeenCalledTimes(1);

    await handle.stop();
  });

  it('returns a working server handle with port, baseUrl and idempotent stop', async () => {
    const { deps, server, handlerClose } = setup();
    const handle = await createYcsfLocalServerInternal({ entry: './probe.ts' }, deps);
    expect(handle.port).toBe(server.port);
    expect(handle.baseUrl).toBe(`http://127.0.0.1:${server.port}`);

    await handle.stop();
    await handle.stop();

    expect(handlerClose).toHaveBeenCalledTimes(1);
  });
});