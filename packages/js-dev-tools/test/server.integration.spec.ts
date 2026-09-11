import { request as httpRequest } from 'node:http';
import { createServer as netCreateServer, type AddressInfo } from 'node:net';
import { createYcsfLocalServer } from '../src/server';

vi.mock('../src/server/iam', () => ({
  resolveIamToken: vi.fn(async () => undefined),
  resolveIamTokenDetailed: vi.fn(async () => ({ reason: 'no-credential' })),
}));

const ENTRY = './test/fixtures/user-service/app.module.ts';

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  buffer: Buffer;
}

function httpGet(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    const req = httpRequest(
      `${baseUrl}${path}`,
      { method: 'GET', headers: { connection: 'close', ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: buffer.toString('utf8'),
            buffer,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    writes,
    restore: () => {
      process.stderr.write = orig;
    },
  };
}

function perRequestTraceIds(writes: string[]): string[] {
  const ids: string[] = [];
  for (const line of writes) {
    const match = /→ \d+ \(\d+ ms\) trace_id=([0-9a-f-]{36})/.exec(line);
    if (match?.[1]) {
      ids.push(match[1]);
    }
  }
  return ids;
}

describe('US1 server lifecycle (T050)', () => {
  it('starts, serves a NestJS handler, correlates trace_id, stops', async () => {
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({
      entry: ENTRY,
      port: 0,
      yandexContext: { token: 'test-token', folderId: 'f1' },
    });

    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.port).toBeGreaterThan(0);

    const first = await httpGet(server.baseUrl, '/api/users');
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ users: [] });

    const second = await httpGet(server.baseUrl, '/api/users');
    expect(second.status).toBe(200);
    expect(JSON.parse(second.body)).toEqual({ users: [] });

    const missing = await httpGet(server.baseUrl, '/nonexistent');
    expect(missing.status).toBe(404);

    const errA = await httpGet(server.baseUrl, '/respond/error');
    const errB = await httpGet(server.baseUrl, '/respond/error');

    expect(errA.status).toBe(500);
    expect(errB.status).toBe(500);

    // Observed connector 500 envelope (trust-the-probe): { statusCode: 500, message, trace_id }.
    // Nest default exception layer builds { statusCode, message }, the connector attaches trace_id
    // to >=400 envelopes (dispatch-pipeline). Distinct from the emulator's own errorResponse
    // { error, message, trace_id } (response.ts), used when the handler result is not a valid envelope.
    const bodyA = JSON.parse(errA.body) as {
      statusCode?: unknown;
      message?: unknown;
      trace_id?: unknown;
    };
    const bodyB = JSON.parse(errB.body) as {
      statusCode?: unknown;
      message?: unknown;
      trace_id?: unknown;
    };

    expect(bodyA.statusCode).toBe(500);
    expect(typeof bodyA.message).toBe('string');
    expect(typeof bodyA.trace_id).toBe('string');
    expect(bodyB.statusCode).toBe(500);
    expect(typeof bodyB.message).toBe('string');
    expect(typeof bodyB.trace_id).toBe('string');

    const traceA = String(bodyA.trace_id);
    const traceB = String(bodyB.trace_id);
    expect(traceA.length).toBeGreaterThan(0);
    expect(traceB.length).toBeGreaterThan(0);

    expect(errA.headers['x-trace-id']).toBe(traceA);
    expect(errB.headers['x-trace-id']).toBe(traceB);

    expect(perRequestTraceIds(stderr.writes)).toContain(traceA);
    expect(perRequestTraceIds(stderr.writes)).toContain(traceB);

    expect(traceA).not.toBe(traceB);

    stderr.restore();
    await server.stop();
    await expect(httpGet(server.baseUrl, '/api/users')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });

  it('reuses a warm handler on subsequent requests', async () => {
    const server = await createYcsfLocalServer({
      entry: ENTRY,
      port: 0,
      yandexContext: { token: 'test-token' },
    });

    const warmup = await httpGet(server.baseUrl, '/api/users');
    const firstStart = performance.now();
    const first = await httpGet(server.baseUrl, '/api/users');
    const firstMs = performance.now() - firstStart;
    const secondStart = performance.now();
    const secondHttp = await httpGet(server.baseUrl, '/api/users');
    const secondMs = performance.now() - secondStart;

    expect(warmup.status).toBe(200);
    expect(first.status).toBe(200);
    expect(secondHttp.status).toBe(200);
    expect(secondMs).toBeLessThan(firstMs + 25);

    await server.stop();
  });

  it('serves concurrent requests through the shared handler (Sc12)', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => httpGet(server.baseUrl, '/api/users')),
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ users: [] });
    }
    await server.stop();
  });
});

describe('US4 response mapping (T060)', () => {
  it('maps 201 + X-Custom header + JSON body', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const res = await httpGet(server.baseUrl, '/respond/201');
    expect(res.status).toBe(201);
    expect(res.headers['x-custom']).toBe('v');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await server.stop();
  });

  it('emits multiple Set-Cookie headers as separate lines, not comma-joined', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const res = await httpGet(server.baseUrl, '/respond/multicookie');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(Array.isArray(cookies)).toBe(true);
    expect(cookies).toEqual(['a=1', 'b=2']);
    await server.stop();
  });

  it('round-trips a binary body byte-for-byte (base64 envelope)', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const res = await httpGet(server.baseUrl, '/respond/binary');
    expect(res.status).toBe(200);
    expect(res.buffer).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0xff]),
    );
    await server.stop();
  });

  it('maps a thrown controller error to 500 with trace_id', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const res = await httpGet(server.baseUrl, '/respond/error');
    expect(res.status).toBe(500);
    const body = JSON.parse(res.body) as { trace_id?: unknown };
    expect(typeof body.trace_id).toBe('string');
    expect(res.headers['x-trace-id']).toBe(String(body.trace_id));
    await server.stop();
  });
});

describe('US5 fail-fast on invalid configuration (T080)', () => {
  async function expectRejection(
    options: Parameters<typeof createYcsfLocalServer>[0],
    code: string,
  ): Promise<void> {
    await expect(createYcsfLocalServer(options)).rejects.toMatchObject({
      name: 'LocalDevServerError',
      code,
    });
  }

  it('rejects messageQueue: true with JDT_MQ_UNSUPPORTED', async () => {
    await expectRejection({ entry: ENTRY, messageQueue: true }, 'JDT_MQ_UNSUPPORTED');
  });

  it('rejects no-transport config with JDT_NO_TRANSPORT', async () => {
    await expectRejection(
      { entry: ENTRY, apiGatewayV2: false, messageQueue: false },
      'JDT_NO_TRANSPORT',
    );
  });

  it('rejects a missing entry path with JDT_ENTRY_RESOLVE_FAILED', async () => {
    await expectRejection(
      { entry: './test/fixtures/user-service/does-not-exist.ts' },
      'JDT_ENTRY_RESOLVE_FAILED',
    );
  });

  it('rejects an entry with no module export with JDT_ENTRY_MODULE_NOT_FOUND', async () => {
    await expectRejection(
      { entry: './test/fixtures/user-service/no-module.ts' },
      'JDT_ENTRY_MODULE_NOT_FOUND',
    );
  });

  it('rejects an ambiguous entry with JDT_ENTRY_MODULE_AMBIGUOUS', async () => {
    await expectRejection(
      { entry: './test/fixtures/user-service/ambiguous.ts' },
      'JDT_ENTRY_MODULE_AMBIGUOUS',
    );
  });

  it.each([
    ['NaN', NaN],
    ['-1', -1],
    ['70000', 70000],
    ['3000.5', 3000.5],
  ])('rejects invalid port %s with JDT_INVALID_PORT', async (_label, port) => {
    await expectRejection({ entry: ENTRY, port }, 'JDT_INVALID_PORT');
  });

  it('rejects an already-bound port with JDT_PORT_IN_USE before creating a handler', async () => {
    const blocker = netCreateServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (blocker.address() as AddressInfo).port;
    try {
      await expectRejection({ entry: ENTRY, port }, 'JDT_PORT_IN_USE');
    } finally {
      blocker.close();
    }
  });
});

describe('US6 graceful lifecycle (T090)', () => {
  it('releases the port on stop() and allows a fresh server on the same port', async () => {
    const first = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const port = first.port;
    await first.stop();

    const second = await createYcsfLocalServer({ entry: ENTRY, port });
    const res = await httpGet(second.baseUrl, '/api/users');
    expect(res.status).toBe(200);
    expect(second.port).toBe(port);
    await second.stop();
  });

  it('stop() is idempotent — a double call does not throw', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    await expect(server.stop()).resolves.toBeUndefined();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('waits for an in-flight invocation before closing', async () => {
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const pending = httpGet(server.baseUrl, '/slow');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await server.stop();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe('US7 observability (T100)', () => {
  it('emits the startup banner with IAM token resolved when a token is set', async () => {
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({
      entry: ENTRY,
      port: 0,
      yandexContext: { token: 'tok' },
    });
    await httpGet(server.baseUrl, '/api/users');
    stderr.restore();
    await server.stop();

    expect(stderr.writes.join('\n')).toMatch(
      /local-dev-server listening on http:\/\/127\.0\.0\.1:\d+ \(apiGatewayV2\) — IAM token resolved/,
    );
  });

  it('emits the JDT_IAM_UNAVAILABLE warning and no-token banner when resolution fails', async () => {
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    await httpGet(server.baseUrl, '/api/users');
    stderr.restore();
    await server.stop();

    const all = stderr.writes.join('\n');
    expect(all).toMatch(/JDT_IAM_UNAVAILABLE: no-credential/);
    expect(all).toMatch(/IAM unavailable \(JDT_IAM_UNAVAILABLE: no-credential\) — running without token/);
  });

  it('logs each invocation as method path → status (ms) trace_id=<uuid>', async () => {
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    await httpGet(server.baseUrl, '/api/users');
    stderr.restore();
    await server.stop();

    expect(stderr.writes.join('\n')).toMatch(
      /GET \/api\/users → 200 \(\d+ ms\) trace_id=[0-9a-f-]{36}/,
    );
  });

  it('assigns a fresh per-request trace_id per invocation', async () => {
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    await httpGet(server.baseUrl, '/api/users');
    await httpGet(server.baseUrl, '/api/users');
    stderr.restore();
    await server.stop();

    const ids = perRequestTraceIds(stderr.writes);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('correlates the error invocation across body, response header and log trace_id', async () => {
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({ entry: ENTRY, port: 0 });
    const res = await httpGet(server.baseUrl, '/respond/error');
    stderr.restore();
    await server.stop();

    const body = JSON.parse(res.body) as { trace_id?: unknown };
    const trace = String(body.trace_id);
    expect(res.headers['x-trace-id']).toBe(trace);
    expect(stderr.writes.join('\n')).toMatch(
      new RegExp(`GET /respond/error → 500 \\(\\d+ ms\\) trace_id=${trace}`),
    );
  });

  it('never leaks secrets (token, Authorization, Cookie) into stderr', async () => {
    const secrets = [
      'super-secret-token',
      'Bearer super-secret-auth',
      'session=super-secret-cookie',
    ];
    const stderr = captureStderr();
    const server = await createYcsfLocalServer({
      entry: ENTRY,
      port: 0,
      yandexContext: { token: secrets[0] ?? 'tok' },
    });
    await httpGet(server.baseUrl, '/api/users', {
      authorization: secrets[1] ?? '',
    });
    await httpGet(server.baseUrl, '/respond/error', {
      cookie: secrets[2] ?? '',
    });
    stderr.restore();
    await server.stop();

    const all = stderr.writes.join('\n');
    for (const secret of secrets) {
      expect(all).not.toContain(secret);
    }
  });
});