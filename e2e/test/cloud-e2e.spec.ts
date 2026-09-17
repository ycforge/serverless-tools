import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deployE2e, type DeployResult } from './helpers/deploy.js';
import { httpGet, invokeFunction, terraformOutputs, waitForLog } from './helpers/cloud.js';
import { PILOT_CLI } from './helpers/state.js';
import { run, runOrThrow } from './helpers/exec.js';
import { getObjectText, listObjectKeys, purgeQueue, receiveMessages, sendMessage } from './helpers/aws.js';
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

    it('enforces the function authorizer', async () => {
      const denied = await httpGet(`${baseUrl}/api/auth/function`);
      expect(denied.status).toBe(401);
      const allowed = await httpGet(`${baseUrl}/api/auth/function`, { 'x-e2e-auth': 'allow' });
      expect(allowed.status).toBe(200);
      expect(parseJsonBody(allowed.text)).toEqual({ route: 'function' });
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
    it('invokes the function with an API Gateway v1 event', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/users',
        url: '/api/users',
        headers: {},
        queryStringParameters: {},
        requestContext: { identity: {} },
        isBase64Encoded: false,
      };
      const result = (await invokeFunction(state().apiFunctionId, event)) as {
        statusCode: number;
        body: string;
      };
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ users: ['alice', 'bob'] });
    });
  });

  describe('message queue', () => {
    it('delivers a message to the fail-fast worker (MQ -> function -> nest-bridge)', async () => {
      await purgeQueue(state().workerEventsName);
      const eventId = `good-${Date.now()}`;
      await sendMessage(state().workerEventsName, { eventId });
      await waitForLog(state().workerFunctionId, 'E2E_WORKER_OK', { timeoutMs: 180_000 });
    }, 240_000);

    it('routes a failing message to the trigger DLQ', async () => {
      await purgeQueue(state().workerEventsDlqName);
      const eventId = `bad-${Date.now()}`;
      await sendMessage(state().workerEventsName, { eventId, fail: true });
      const messages = await receiveMessages(state().workerEventsDlqName, {
        max: 1,
        timeoutMs: 240_000,
      });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.body).toContain(eventId);
    }, 300_000);

    it('degrades and republishes failed messages to the app-level DLQ', async () => {
      await purgeQueue(state().workerDlqEventsName);
      await purgeQueue(state().workerAppDlqName);
      const goodId = `dlq-good-${Date.now()}`;
      const badId = `dlq-bad-${Date.now()}`;
      await sendMessage(state().workerDlqEventsName, { eventId: goodId });
      await sendMessage(state().workerDlqEventsName, { eventId: badId, fail: true });
      await waitForLog(state().workerDlqFunctionId, 'E2E_WORKER_DLQ_OK', { timeoutMs: 180_000 });
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
    it('performs a KMS encrypt/decrypt roundtrip through the function', async () => {
      const response = await httpGet(`${baseUrl}/api/kms?key=${state().kmsKeyId}`);
      expect(response.status).toBe(200);
      expect(parseJsonBody(response.text)).toEqual({ ok: true, roundtrip: true });
    });

    it('exposes trace_id through the execution context', async () => {
      const response = await httpGet(`${baseUrl}/api/context`);
      expect(response.status).toBe(200);
      const body = parseJsonBody(response.text) as { trace_id?: string };
      expect(typeof body.trace_id).toBe('string');
      expect((body.trace_id as string).length).toBeGreaterThan(0);
    });

    it('emits structured logs with the marker', async () => {
      const response = await httpGet(`${baseUrl}/api/logged`);
      expect(response.status).toBe(200);
      await waitForLog(state().apiFunctionId, 'e2e structured log line', { timeoutMs: 120_000 });
    }, 180_000);

    it('carries trace_id in error responses', async () => {
      const response = await httpGet(`${baseUrl}/api/guarded`);
      expect(response.status).toBe(403);
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

      const plan = await run('terraform', ['plan', '-detailed-exitcode', '-input=false', '-no-color'], {
        cwd: join(state().projectDir, 'infra'),
        env: deployed.buildEnv,
      });
      expect(plan.code).toBe(0);
    }, 600_000);
  });
});
