import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deployE2e, type DeployResult } from './helpers/deploy.js';
import {
  httpGet,
  invokeFunction,
  terraformOutputs,
  waitForLog,
  waitForLogGroup,
} from './helpers/cloud.js';
import { PILOT_CLI, REPO_ROOT } from './helpers/state.js';
import { run, runOrThrow } from './helpers/exec.js';
import {
  getObjectText,
  listObjectKeys,
  purgeQueue,
  queueMessageCount,
  receiveMessages,
  sendMessage,
} from './helpers/aws.js';
import { signToken } from './helpers/jwt.js';

process.env.YC_PROFILE = 'ycforge-sa';

const enabled = process.env.YCSF_E2E === '1';

let deployed: DeployResult;
let baseUrl = '';

function state(): DeployResult['state'] {
  return deployed.state;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await httpGet(url);
      if (response.status < 500) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(5_000);
  }
  throw new Error(`endpoint not ready: ${url}`);
}

async function waitForJwks(url: string, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await httpGet(url);
      if (response.status === 200) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(5_000);
  }
  throw new Error(`jwks not reachable: ${url}`);
}

function parseJsonBody(text: string): unknown {
  return JSON.parse(text) as unknown;
}

async function signValidToken(): Promise<string> {
  return signToken({
    issuer: state().jwtIssuer,
    audience: 'e2e-api',
    kid: String(state().jwk.kid),
    privateKeyPem: state().privateKeyPem,
  });
}

function mqEvent(payload: unknown): unknown {
  const id = `e2e-${Date.now()}`;
  return {
    messages: [
      {
        event_metadata: {
          event_id: id,
          event_type: 'yandex.cloud.events.messagequeue.QueueMessage',
          created_at: new Date().toISOString(),
          tracing_context: null,
          cloud_id: 'e2e',
          folder_id: 'e2e',
        },
        details: {
          queue_id: 'yrn:yc:ymq:ru-central1:e2e:e2e',
          message: {
            message_id: id,
            md5_of_body: 'e2e',
            body: JSON.stringify(payload),
            attributes: {
              ApproximateFirstReceiveTimestamp: '1',
              ApproximateReceiveCount: '1',
              SenderId: 'e2e',
              SentTimestamp: '1',
            },
            message_attributes: {},
            md5_of_message_attributes: '',
          },
        },
      },
    ],
  };
}

async function invokeMq(functionId: string, payload: unknown) {
  return run(
    'yc',
    ['serverless', 'function', 'invoke', '--id', functionId, '--data', JSON.stringify(mqEvent(payload))],
    { env: process.env, timeoutMs: 120_000 },
  );
}

async function expectQueueDrained(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = { visible: 0, notVisible: 0 };
  while (Date.now() < deadline) {
    last = await queueMessageCount(name);
    if (last.visible === 0 && last.notVisible === 0) {
      return;
    }
    await sleep(3_000);
  }
  throw new Error(
    `queue '${name}' was not drained within ${timeoutMs}ms (visible=${last.visible}, notVisible=${last.notVisible})`,
  );
}

async function expectQueueRedelivered(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = { visible: 0, notVisible: 0 };
  while (Date.now() < deadline) {
    last = await queueMessageCount(name);
    if (last.visible > 0) {
      return;
    }
    await sleep(3_000);
  }
  throw new Error(
    `queue '${name}' was not redelivered within ${timeoutMs}ms (visible=${last.visible}, notVisible=${last.notVisible})`,
  );
}

const BUILDERS_YAML = `version: 1
builders:
  ycforge:api-gateway: "../../../composer/dist/builder/index.js"
materializers:
  yandex-function: "@ycforge/materializers-core/yandex-function"
  yandex-serverless-container: "@ycforge/materializers-core/yandex-serverless-container"
  yandex-storage-bucket: "@ycforge/materializers-core/yandex-storage-bucket"
  yandex-api-gateway: "@ycforge/materializers-core/yandex-api-gateway"
`;

/** Builds a minimal Project-C fixture with duplicate operationIds. */
function writeComposerCollisionFixture(root: string): void {
  mkdirSync(join(root, '.ycsf'), { recursive: true });
  mkdirSync(join(root, 'apps', 'gw'), { recursive: true });
  writeFileSync(
    join(root, '.ycsf', 'apps.yaml'),
    `version: 1
apps:
  gw:
    source_path: apps/gw
    builder: ycforge:api-gateway
    depends_on: []
`,
    'utf8',
  );
  writeFileSync(join(root, '.ycsf', 'builders.yaml'), BUILDERS_YAML, 'utf8');
  writeFileSync(
    join(root, 'apps', 'gw', 'build_config.yaml'),
    `version: 1
build_config:
  openapi_entry: openapi.yaml
build_env: {}
`,
    'utf8',
  );
  writeFileSync(
    join(root, 'apps', 'gw', 'auth.yaml'),
    `version: 1
defaultScheme: public
schemes:
  public:
    type: none
`,
    'utf8',
  );
  writeFileSync(
    join(root, 'apps', 'gw', 'openapi.yaml'),
    `openapi: 3.0.0
info:
  title: collision
  version: 1.0.0
paths:
  /a:
    get:
      operationId: duplicateOperation
      responses:
        "200": { description: ok }
  /b:
    get:
      operationId: duplicateOperation
      responses:
        "200": { description: ok }
`,
    'utf8',
  );
}

describe.skipIf(!enabled)('cloud e2e (spec 037)', () => {
  beforeAll(async () => {
    deployed = await deployE2e();
    baseUrl = `https://${deployed.state.gatewayDomain}`;
    await waitForHttp(`${baseUrl}/api/public`);
    await waitForJwks(`${deployed.state.jwtIssuer}/.well-known/jwks.json`);
  }, 1_800_000);

  afterAll(async () => {
    if (deployed !== undefined) {
      await deployed.teardown();
    }
  }, 900_000);

  describe('gateway HTTPS transport', () => {
    it('serves a cloud_functions integration', async () => {
      const response = await httpGet(`${baseUrl}/api/users`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ users: ['alice', 'bob'] });
    });

    it('serves the container integration', async () => {
      const response = await httpGet(`${baseUrl}/api/analytics`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toMatchObject({ service: 'e2e-container', ok: true });
    });

    it('serves the managed frontend bucket via object_storage', async () => {
      const response = await httpGet(`${baseUrl}/web`);
      expect(response.status).toBe(200);
      expect(response.text).toContain('e2e web');
    });

    it('serves the external bucket resolved via ENV-only', async () => {
      const response = await httpGet(`${baseUrl}/static`);
      expect(response.status).toBe(200);
      expect(response.text).toContain('hello from the e2e static');
    });

    it('applies the global override (added /_health path)', async () => {
      const response = await httpGet(`${baseUrl}/_health`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ status: 'ok' });
    });

    it('applies the local override (removed /api/legacy)', async () => {
      const response = await httpGet(`${baseUrl}/api/legacy`);
      expect(response.status).toBe(404);
    });

    it('returns 404 for unknown paths', async () => {
      const response = await httpGet(`${baseUrl}/api/does-not-exist`);
      expect(response.status).toBe(404);
    });
  });

  describe('auth schemes', () => {
    it('rejects a jwt route without a token', async () => {
      const response = await httpGet(`${baseUrl}/api/auth/jwt`);
      expect(response.status).toBe(401);
    });

    it('accepts a valid jwt token', async () => {
      const token = await signValidToken();
      const response = await httpGet(`${baseUrl}/api/auth/jwt`, {
        Authorization: `Bearer ${token}`,
      });
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ route: 'jwt' });
    });

    it('rejects a jwt token issued by a foreign issuer', async () => {
      const token = await signToken({
        issuer: 'https://wrong-issuer.invalid',
        audience: 'e2e-api',
        kid: String(state().jwk.kid),
        privateKeyPem: state().privateKeyPem,
      });
      const response = await httpGet(`${baseUrl}/api/auth/jwt`, {
        Authorization: `Bearer ${token}`,
      });
      expect(response.status).toBe(401);
    });

    it('rejects a jwt token with a foreign audience', async () => {
      const token = await signToken({
        issuer: state().jwtIssuer,
        audience: 'other-api',
        kid: String(state().jwk.kid),
        privateKeyPem: state().privateKeyPem,
      });
      const response = await httpGet(`${baseUrl}/api/auth/jwt`, {
        Authorization: `Bearer ${token}`,
      });
      expect(response.status).toBe(401);
    });

    it('rejects an expired jwt token', async () => {
      const token = await signToken({
        issuer: state().jwtIssuer,
        audience: 'e2e-api',
        kid: String(state().jwk.kid),
        privateKeyPem: state().privateKeyPem,
        expiresAt: new Date(Date.now() - 60_000),
      });
      const response = await httpGet(`${baseUrl}/api/auth/jwt`, {
        Authorization: `Bearer ${token}`,
      });
      expect(response.status).toBe(401);
    });

    it('rejects the function-authorizer route without an Authorization header', async () => {
      // The gateway only invokes an `http bearer` function authorizer when the
      // bearer header is present; without it the request is rejected outright.
      const denied = await httpGet(`${baseUrl}/api/auth/function`);
      expect(denied.status).toBe(401);
    });

    it('accepts the function-authorizer route when the authorizer allows', async () => {
      const allowed = await httpGet(`${baseUrl}/api/auth/function?auth=allow`, {
        Authorization: 'Bearer dummy',
      });
      expect(allowed.status, `body: ${allowed.text}`).toBe(200);
      expect(parseJsonBody(allowed.text)).toEqual({ route: 'function' });
    });

    it('rejects the function-authorizer route when the authorizer denies', async () => {
      const denied = await httpGet(`${baseUrl}/api/auth/function`, {
        Authorization: 'Bearer dummy',
      });
      // A 403 (authorizer denied) is distinct from a 401 (no credentials).
      expect(denied.status).toBe(403);
    });

    it('runs the authorizer function logic (allow/deny)', async () => {
      const allow = await invokeFunction(state().authorizerFunctionId, {
        headers: { 'x-e2e-auth': 'allow' },
      });
      expect(JSON.stringify(allow)).toContain('"isAuthorized":true');
      const deny = await invokeFunction(state().authorizerFunctionId, {
        headers: { 'x-e2e-auth': 'nope' },
      });
      expect(JSON.stringify(deny)).toContain('"isAuthorized":false');
    });

    it('enforces the in-app @RequireAuth guard', async () => {
      const denied = await httpGet(`${baseUrl}/api/guarded`);
      expect(denied.status).toBe(403);
      const allowed = await httpGet(`${baseUrl}/api/guarded`, { 'x-e2e-guard': 'ok' });
      expect(allowed.status).toBe(200);
      expect(parseJsonBody(allowed.text)).toEqual({ route: 'guarded' });
    });
  });

  describe('direct invoke', () => {
    it('invokes the function with a real API Gateway v1 event fixture', async () => {
      const fixture = JSON.parse(
        readFileSync(
          join(REPO_ROOT, 'packages', 'nest-bridge', 'fixtures', 'http-apigw', 'get-without-query.json'),
          'utf8',
        ),
      ) as { event: Record<string, unknown> };
      const event = { ...fixture.event, path: '/api/users', url: '/api/users' };
      const result = (await invokeFunction(state().apiFunctionId, event)) as {
        statusCode: number;
        body: string;
      };
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ users: ['alice', 'bob'] });
    });
  });

  describe('message queue', () => {
    it('delivers a queue message to the fail-fast worker via a real trigger (MQ -> function -> nest-bridge)', async () => {
      await purgeQueue(state().workerEventsName);
      const eventId = `good-${Date.now()}`;
      await sendMessage(state().workerEventsName, { eventId });
      await expectQueueDrained(state().workerEventsName, 180_000);
      const logs = await waitForLog(state().workerFunctionId, 'E2E_WORKER_OK', {
        timeoutMs: 240_000,
      });
      // Structured handler log carries the eventId and the injected trace_id.
      expect(logs).toContain(eventId);
      expect(logs).toMatch(/"traceId":"[^"]+"/);
    }, 360_000);

    it('fails fast on a bad message (direct invoke surfaces the handler error)', async () => {
      const result = await invokeMq(state().workerFunctionId, {
        eventId: `bad-${Date.now()}`,
        fail: true,
      });
      if (result.code === 0) {
        throw new Error(`expected the fail-fast worker to reject the message\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      expect(`${result.stdout}\n${result.stderr}`).toContain('fail-fast');
    }, 180_000);

    it('redelivers a bad message through the real trigger (fail-fast keeps the message)', async () => {
      await purgeQueue(state().workerEventsName);
      await sendMessage(state().workerEventsName, { eventId: `redeliver-${Date.now()}`, fail: true });
      // The trigger consumes the message, the handler throws, and YMQ makes it
      // visible again after the visibility timeout (30s) for another attempt.
      await expectQueueRedelivered(state().workerEventsName, 150_000);
    }, 200_000);

    it('degrades a bad message in partial-failure mode (invocation succeeds)', async () => {
      const result = await invokeMq(state().workerDlqFunctionId, {
        eventId: `dlq-${Date.now()}`,
        fail: true,
      });
      if (result.code !== 0) {
        throw new Error(`expected partial-failure mode to accept the message\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
    }, 180_000);

    it('delivers a queue message to the partial-failure worker via a real trigger', async () => {
      await purgeQueue(state().workerDlqEventsName);
      const eventId = `dlq-good-${Date.now()}`;
      await sendMessage(state().workerDlqEventsName, { eventId });
      await expectQueueDrained(state().workerDlqEventsName, 180_000);
      const logs = await waitForLog(state().workerDlqFunctionId, 'E2E_WORKER_DLQ_OK', {
        timeoutMs: 240_000,
      });
      expect(logs).toContain(eventId);
    }, 360_000);

    it('republishes a failed message to the app-level DLQ via SigV4 (real trigger)', async () => {
      await purgeQueue(state().workerDlqEventsName);
      await purgeQueue(state().workerAppDlqName);
      const badId = `dlq-bad-${Date.now()}`;
      await sendMessage(state().workerDlqEventsName, { eventId: badId, fail: true });
      const messages = await receiveMessages(state().workerAppDlqName, {
        max: 1,
        timeoutMs: 240_000,
      });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.body).toContain(badId);
    }, 300_000);
  });

  describe('storage and build_env', () => {
    it('stores backend-unique bucket objects with interpolated build_env', async () => {
      const bucket = `e2e-web-${state().runId}`;
      const keys = await listObjectKeys(bucket);
      expect(keys).toContain('index.html');
      const jsKey = keys.find((key) => key.endsWith('.js'));
      expect(jsKey).toBeDefined();
      const bundle = await getObjectText(bucket, jsKey as string);
      expect(bundle).toContain('e2e-literal');
      expect(bundle).toContain(state().runId);
      expect(bundle).toContain('null-mode-value');
    });

    it('reads the external ENV-only bucket object', async () => {
      const content = await getObjectText(state().staticBucket, 'hello.txt');
      expect(content).toContain('hello from the e2e static');
    });
  });

  describe('kms and observability', () => {
    it('performs a KMS encrypt/decrypt roundtrip through the function', async (context) => {
      if (state().kmsKeyId === '') {
        context.skip('E2E_KMS_KEY_ID not provided — the reference SA has no KMS permissions');
        return;
      }
      const response = await httpGet(`${baseUrl}/api/kms?key=${state().kmsKeyId}`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ ok: true, roundtrip: true });
    });

    it('runs the injected YandexLogger without failing the invocation', async () => {
      const response = await httpGet(`${baseUrl}/api/logged`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ logged: true });
    });

    it('writes NestJS logs at every level into the user-owned logging group', async () => {
      const response = await httpGet(`${baseUrl}/api/logs`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ logged: 6 });

      // The default structured logger maps Nest levels to Cloud Logging ones.
      const filter = 'message: "e2e-nestjs"';
      const logs = await waitForLogGroup(state().logGroupId, 'e2e-nestjs-level-fatal', {
        timeoutMs: 240_000,
        since: '10m',
        filter,
      });
      const pairs: Array<[string, string]> = [
        ['TRACE', 'e2e-nestjs-level-verbose'],
        ['DEBUG', 'e2e-nestjs-level-debug'],
        ['INFO', 'e2e-nestjs-level-info'],
        ['WARN', 'e2e-nestjs-level-warn'],
        ['ERROR', 'e2e-nestjs-level-error'],
        ['FATAL', 'e2e-nestjs-level-fatal'],
      ];
      // `yc logging read` prints the Cloud Logging level column before the
      // message, so the text read asserts BOTH the assigned level and the
      // message (the structured logger must not fall back to TRACE/UNSPECIFIED).
      for (const [level, marker] of pairs) {
        expect(logs, `missing ${level} line for ${marker}`).toMatch(
          new RegExp(`${level}[^\\n]*${marker}`),
        );
      }
      // Sanity: the level column must not be the unstructured TRACE fallback.
      expect(logs).toContain('INFO');
    }, 300_000);

    it('carries trace_id in error responses', async () => {
      const response = await httpGet(`${baseUrl}/api/guarded`);
      expect(response.status, `body: ${response.text}`).toBe(403);
      const body = parseJsonBody(response.text) as { trace_id?: string };
      expect(typeof body.trace_id).toBe('string');
    });
  });

  describe('outputs, idempotency and cache', () => {
    it('exposes user and auto outputs from terraform state', () => {
      const outputs = state().outputs;
      for (const key of [
        'e2e_api_id',
        'e2e_gateway_id',
        'e2e_worker_id',
        'e2e_api_function_id',
        'e2e_openapi_gateway_id',
        'e2e_container_container_id',
        'e2e_web_bucket_id',
        'e2e_worker_function_id',
      ]) {
        expect(outputs[key], `missing output ${key}`).toBeDefined();
      }
    });

    it('is idempotent (terraform plan reports no changes)', async () => {
      const result = await run(
        'terraform',
        ['plan', '-detailed-exitcode', '-input=false', '-no-color'],
        { cwd: join(state().projectDir, 'infra'), env: deployed.buildEnv },
      );
      expect(result.code).toBe(0);
    }, 300_000);

    it('serves cached builds and invalidates on source change', async () => {
      const first = await runOrThrow(
        'node',
        [PILOT_CLI, '-p', state().projectDir, 'build', '--json'],
        { cwd: state().projectDir, env: deployed.buildEnv },
      );
      const firstResult = JSON.parse(first.stdout) as {
        summary: { cache: { hits: number; misses: number } };
      };
      expect(firstResult.summary.cache.hits).toBeGreaterThan(0);

      const second = await runOrThrow(
        'node',
        [PILOT_CLI, '-p', state().projectDir, 'build', '--json'],
        { cwd: state().projectDir, env: deployed.buildEnv },
      );
      const secondResult = JSON.parse(second.stdout) as {
        summary: { cache: { hits: number; misses: number } };
      };
      expect(secondResult.summary.cache.misses).toBe(0);

      const controller = join(state().projectDir, 'apps', 'e2e_api', 'src', 'app.controller.ts');
      const original = readFileSync(controller, 'utf8');
      writeFileSync(controller, `${original}\n// cache-invalidation-probe\n`, 'utf8');
      try {
        const changed = await runOrThrow(
          'node',
          [PILOT_CLI, '-p', state().projectDir, 'build', '--json'],
          { cwd: state().projectDir, env: deployed.buildEnv },
        );
        const changedResult = JSON.parse(changed.stdout) as {
          summary: { cache: { entries: Array<{ appId: string; hit: boolean }> } };
        };
        const apiEntry = changedResult.summary.cache.entries.find((e) => e.appId === 'e2e_api');
        const gatewayEntry = changedResult.summary.cache.entries.find((e) => e.appId === 'e2e_openapi');
        expect(apiEntry?.hit).toBe(false);
        expect(gatewayEntry?.hit).toBe(false);
      } finally {
        writeFileSync(controller, original, 'utf8');
        await runOrThrow('node', [PILOT_CLI, '-p', state().projectDir, 'build'], {
          cwd: state().projectDir,
          env: deployed.buildEnv,
        });
      }
    }, 300_000);
  });

  describe('moved.yaml', () => {
    it('renames an app without recreating its cloud resource', async () => {
      const before = state().renameFunctionId;

      const appsPath = join(state().projectDir, '.ycsf', 'apps.yaml');
      const apps = readFileSync(appsPath, 'utf8');
      writeFileSync(
        appsPath,
        apps.replace(/^(\s*)e2e_rename_me:/m, '$1e2e_renamed_app:'),
        'utf8',
      );

      const extensionsPath = join(state().projectDir, '.ycsf', 'extensions.yaml');
      const extensions = readFileSync(extensionsPath, 'utf8');
      writeFileSync(
        extensionsPath,
        extensions.replaceAll('functions.e2e_rename_me', 'functions.e2e_renamed_app'),
        'utf8',
      );

      writeFileSync(
        join(state().projectDir, '.ycsf', 'moved.yaml'),
        `version: 1
moves:
  - from: { idl: functions.e2e_rename_me, idt: yandex_function.e2e_rename_me }
    to: { idl: functions.e2e_renamed_app, idt: yandex_function.e2e_renamed_app }
`,
        'utf8',
      );

      await runOrThrow('node', [PILOT_CLI, '-p', state().projectDir, 'apply'], {
        cwd: state().projectDir,
        env: deployed.buildEnv,
      });

      const outputs = await terraformOutputs(join(state().projectDir, 'infra'), deployed.buildEnv);
      const after = String((outputs['e2e_renamed_app_function_id'] as { value: unknown }).value);
      expect(after).toBe(before);

      // Second phase: roll the rename forward through a two-hop moved chain and
      // assert the cloud resource is still the same (no recreate).
      writeFileSync(
        appsPath,
        readFileSync(appsPath, 'utf8').replace(/^(\s*)e2e_renamed_app:/m, '$1e2e_renamed_final:'),
        'utf8',
      );
      writeFileSync(
        extensionsPath,
        readFileSync(extensionsPath, 'utf8').replaceAll(
          'functions.e2e_renamed_app',
          'functions.e2e_renamed_final',
        ),
        'utf8',
      );
      writeFileSync(
        join(state().projectDir, '.ycsf', 'moved.yaml'),
        `version: 1
moves:
  - from: { idl: functions.e2e_rename_me, idt: yandex_function.e2e_rename_me }
    to: { idl: functions.e2e_renamed_app, idt: yandex_function.e2e_renamed_app }
  - from: { idl: functions.e2e_renamed_app, idt: yandex_function.e2e_renamed_app }
    to: { idl: functions.e2e_renamed_final, idt: yandex_function.e2e_renamed_final }
`,
        'utf8',
      );

      await runOrThrow('node', [PILOT_CLI, '-p', state().projectDir, 'apply'], {
        cwd: state().projectDir,
        env: deployed.buildEnv,
      });

      const finalOutputs = await terraformOutputs(join(state().projectDir, 'infra'), deployed.buildEnv);
      const final = String(
        (finalOutputs['e2e_renamed_final_function_id'] as { value: unknown }).value,
      );
      expect(final).toBe(before);

      const plan = await run('terraform', ['plan', '-detailed-exitcode', '-input=false', '-no-color'], {
        cwd: join(state().projectDir, 'infra'),
        env: deployed.buildEnv,
      });
      expect(plan.code).toBe(0);
    }, 900_000);
  });

  describe('composer collisions', () => {
    it('fails the build on a duplicate operationId inside one gateway app', async () => {
      const fixture = join(state().tempRoot, 'composer-collision');
      writeComposerCollisionFixture(fixture);
      const result = await run(
        'node',
        [PILOT_CLI, '-p', fixture, 'build', '--target', 'gw', '--json'],
        { cwd: fixture, env: deployed.buildEnv },
      );
      expect(result.code).not.toBe(0);
      // The composer code is wrapped by the builder into a descriptive
      // CLI_BUILD_FAILED message (the raw COMPOSE_* code is not surfaced).
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /operationId duplicateOperation is declared by more than one operation/,
      );
    }, 120_000);
  });
});
