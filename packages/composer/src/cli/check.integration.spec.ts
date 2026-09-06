import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkCommand } from './check.js';
import { compileCommand } from './compile.js';

const FIXTURE = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${name}/`, import.meta.url));

describe('ycsf-api check — integration scenarios (T037)', () => {
  it('passes all 5 checks on a valid CLI project (check exit code 0)', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-pass') });

    expect(summary.summary).toEqual({ passed: 5, failed: 0, total: 5 });
    expect(summary.exitCode).toBe(0);
    for (const result of summary.results) {
      expect(result.passed).toBe(true);
    }
  });

  it('fails auth-schemes-valid when a JWT scheme is missing required fields', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-bad-auth') });

    expect(summary.exitCode).toBe(1);
    const authCheck = summary.results.find((r) => r.check === 'auth-schemes-valid');
    expect(authCheck?.passed).toBe(false);
    expect(authCheck?.errors?.[0]?.code).toBeDefined();
  });

  it('fails overrides-targets-exist when an override targets a missing operation', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-bad-override') });

    expect(summary.exitCode).toBe(1);
    const overrideCheck = summary.results.find((r) => r.check === 'overrides-targets-exist');
    expect(overrideCheck?.passed).toBe(false);
    expect(overrideCheck?.details).toMatch(/^1\/2 override targets exist$/);

    const passing = summary.results.filter((r) => r.check !== 'overrides-targets-exist');
    for (const result of passing) {
      expect(result.passed, `expected ${result.check} to pass`).toBe(true);
    }
  });

  it('fails resource-refs-resolvable when a ref points to an undeclared resource', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-bad-ref') });

    expect(summary.exitCode).toBe(1);
    const refCheck = summary.results.find((r) => r.check === 'resource-refs-resolvable');
    expect(refCheck?.passed).toBe(false);
    expect(refCheck?.errors?.[0]?.code).toBe('UNRESOLVED_RESOURCE_REF');

    const passing = summary.results.filter((r) => r.check !== 'resource-refs-resolvable');
    for (const result of passing) {
      expect(result.passed, `expected ${result.check} to pass`).toBe(true);
    }
  });

  it('reports per-check human-ready details on success', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-pass') });
    const details = new Map(summary.results.map((r) => [r.check, r.details]));

    expect(details.get('openapi-sources-exist')).toBe('All OpenAPI sources exist');
    expect(details.get('auth-schemes-valid')).toBe('All auth schemes valid');
    expect(details.get('no-path-operationid-conflicts')).toBe('No conflicts found');
    expect(details.get('resource-refs-resolvable')).toBe('1/1 refs resolved');
    expect(details.get('overrides-targets-exist')).toBe('2/2 override targets exist');
  });

  it('auto-detects ENV-only mode from .ycsf/env.yaml (mode: env-only) without --env-only (T048)', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-env-only') });

    expect(summary.summary).toEqual({ passed: 5, failed: 0, total: 5 });
    expect(summary.exitCode).toBe(0);

    const skipped = summary.results.filter((r) => r.details === 'Skipped (ENV-only mode)');
    expect(skipped.map((r) => r.check)).toEqual([
      'openapi-sources-exist',
      'no-path-operationid-conflicts',
      'resource-refs-resolvable',
      'overrides-targets-exist',
    ]);

    const auth = summary.results.find((r) => r.check === 'auth-schemes-valid');
    expect(auth?.passed).toBe(true);
    expect(auth?.details).toBe('All auth schemes valid');
  });
});

describe('ycsf-api compile — integration smoke (T014–T034)', () => {
  it('compiles the gateway app into a deterministic OpenAPI document', async () => {
    const run = async () =>
      compileCommand({ projectDir: FIXTURE('cli-pass'), output: undefined });

    const first = await run();
    const second = await run();

    expect(first.document.openapi).toBe('3.0.0');
    expect(JSON.stringify(first.document)).toBe(JSON.stringify(second.document));

    const paths = first.document.paths as Record<string, unknown>;
    expect(Object.keys(paths).sort()).toEqual(['/admin', '/users', '/users/{id}']);

    const listUsers = (paths['/users'] as Record<string, unknown>)['get'] as Record<string, unknown>;
    expect(listUsers.summary).toBe('Updated list users');

    const adminPathItem = paths['/admin'] as Record<string, unknown>;
    expect(adminPathItem.summary).toBe('Admin panel');

    expect(Array.isArray(first.document.security)).toBe(true);

    expect(first.provenance.get('/users')).toEqual({ sourceApp: 'user_service', sourceFile: '' });
  });

  it('resolves resource refs inside override values (compile-time; T033)', async () => {
    const previous = process.env.AUTHORIZER_ID;
    try {
      process.env.AUTHORIZER_ID = 'd4e0000000000000000000000001';
      const { document } = await compileCommand({ projectDir: FIXTURE('cli-override-ref') });

      const paths = document.paths as Record<string, unknown>;
      const ping = (paths['/ping'] as Record<string, unknown>).get as Record<string, unknown>;

      expect(ping.summary).toBe('d4e0000000000000000000000001');
      const authorizer = ping['x-yc-apigateway-authorizer'] as Record<string, unknown>;
      expect(authorizer.function_id).toBe('d4e0000000000000000000000001');

      const listUsers = (paths['/users'] as Record<string, unknown>).get as Record<string, unknown>;
      expect(listUsers.summary).toBe('Updated list users');
    } finally {
      if (previous === undefined) {
        delete process.env.AUTHORIZER_ID;
      } else {
        process.env.AUTHORIZER_ID = previous;
      }
    }
  });

  it('fails fast when an override value references an undeclared resource (T033)', async () => {
    await expect(
      compileCommand({ projectDir: FIXTURE('cli-bad-override-ref') }),
    ).rejects.toThrow(/not declared in resources.yaml/);
  });

  it('compiles a placeholder document in auto-detected ENV-only mode (T048)', async () => {
    const previous = process.env.AUTHORIZER_ID;
    try {
      process.env.AUTHORIZER_ID = 'd4e0000000000000000000000001';
      const { document } = await compileCommand({ projectDir: FIXTURE('cli-env-only') });

      expect(document.openapi).toBe('3.1.0');
      expect(document.paths).toEqual({});
      expect(document.info).toEqual({ title: 'User Service', version: '0.0.0' });
    } finally {
      if (previous === undefined) {
        delete process.env.AUTHORIZER_ID;
      } else {
        process.env.AUTHORIZER_ID = previous;
      }
    }
  });
});