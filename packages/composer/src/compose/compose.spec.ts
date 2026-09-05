import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenApiDocument } from '../errors.js';
import type { AuthScheme, AuthYamlDocument } from '../auth/types.js';

import { compose } from './compose.js';

const hoisted = vi.hoisted(() => {
  const extractCalls: string[] = [];
  const authConfigCalls: string[] = [];
  const authRefCalls: string[] = [];
  const docs = new Map<string, OpenApiDocument>();
  const failAuth = { value: false };
  const compositionRoot = '/composition-root';
  const authYaml: AuthYamlDocument = {
    version: 1,
    defaultScheme: 'user',
    schemes: {
      public: { type: 'none' },
      user: {
        type: 'jwt',
        jwksUri: 'https://auth.example.com/jwks.json',
        issuer: 'https://auth.example.com',
        audience: ['my-api'],
      } as AuthScheme,
      internal: {
        type: 'function',
        function: { ref: 'functions.internal_authorizer', name: 'internal_authorizer' },
      } as AuthScheme,
      frontend: { type: 'none' },
    },
  };
  return { extractCalls, authConfigCalls, authRefCalls, docs, failAuth, authYaml, compositionRoot };
});

vi.mock('../extract.js', () => ({
  extractOpenApi: async (request: { appRoot: string }) => {
    hoisted.extractCalls.push(request.appRoot);
    const doc = hoisted.docs.get(request.appRoot);
    if (doc === undefined) {
      throw Object.assign(new Error('no source'), {
        name: 'OpenApiExtractError',
        code: 'NO_SOURCE',
      });
    }
    return doc;
  },
}));

vi.mock('../auth/auth-config.js', () => ({
  validateAuthConfig: async (request: { appRoot: string }) => {
    hoisted.authConfigCalls.push(request.appRoot);
    if (hoisted.failAuth.value) {
      throw Object.assign(new Error('auth file missing'), {
        name: 'AuthConfigError',
        code: 'AUTH_FILE_MISSING',
        path: request.appRoot,
      });
    }
    return { authYaml: hoisted.authYaml };
  },
  validateAuthReferences: (openApi: OpenApiDocument) => {
    hoisted.authRefCalls.push(String(Object.keys(openApi.paths).length));
    return { authYaml: hoisted.authYaml };
  },
}));

vi.mock('./overrides/override-yaml.js', () => ({
  loadOverrideFile: async (root: string) =>
    root === hoisted.compositionRoot
      ? {
          version: 1 as const,
          rules: [
            {
              op: 'replace' as const,
              target: { kind: 'info' as const },
              value: { title: 'gateway', version: '1.0.0' },
            },
          ],
        }
      : null,
}));

function frozenDoc(paths: Record<string, unknown>, schemaName: string): OpenApiDocument {
  return Object.freeze({
    openapi: '3.0.0',
    info: Object.freeze({ title: 'app', version: '1.0.0' }),
    paths: Object.freeze(
      Object.fromEntries(
        Object.entries(paths).map(([path, pathItem]) => [path, Object.freeze(pathItem)]),
      ),
    ),
    components: Object.freeze({
      schemas: Object.freeze({ [schemaName]: Object.freeze({ type: 'object' }) }),
    }),
  }) as unknown as OpenApiDocument;
}

const APP_A = '/pool/app-a';
const APP_B = '/pool/app-b';

beforeEach(() => {
  hoisted.extractCalls.length = 0;
  hoisted.authConfigCalls.length = 0;
  hoisted.authRefCalls.length = 0;
  hoisted.failAuth.value = false;
  hoisted.compositionRoot = '/composition-root';
  hoisted.docs.clear();
  hoisted.docs.set(APP_A, frozenDoc({ '/a': { get: { operationId: 'getA' } } }, 'ADto'));
  hoisted.docs.set(APP_B, frozenDoc({ '/b': { get: { operationId: 'getB' } } }, 'BDto'));
});

const REQUEST = {
  compositionRoot: '/composition-root',
  apps: [{ appRoot: APP_A }, { appRoot: APP_B }],
};

describe('compose — pipeline order, delegation, immutability (US1, FR-001/015/017)', () => {
  it('a doc failing EXTRACT (006 NO_SOURCE) stops before AUTH (SC-001/SC-005)', async () => {
    hoisted.docs.delete(APP_B);
    await expect(
      compose({ ...REQUEST, apps: [{ appRoot: APP_A }, { appRoot: APP_B }] }),
    ).rejects.toMatchObject({ name: 'OpenApiExtractError', code: 'NO_SOURCE' });
    expect(hoisted.authConfigCalls).toEqual([]);
  });

  it('an auth config failure (007) stops before VERSION/MERGE', async () => {
    hoisted.failAuth.value = true;
    await expect(
      compose({ ...REQUEST, compositionRoot: '/root-with-bad-auth' }),
    ).rejects.toMatchObject({ name: 'AuthConfigError' });
  });

  it('surfaces delegated 006/007 errors as their OWN error types, not ComposeError (FR-015)', async () => {
    hoisted.failAuth.value = true;
    await expect(
      compose({ ...REQUEST, compositionRoot: '/root-with-bad-auth' }),
    ).rejects.toMatchObject({ name: 'AuthConfigError', code: 'AUTH_FILE_MISSING' });

    hoisted.docs.delete(APP_A);
    hoisted.failAuth.value = false;
    await expect(
      compose({ ...REQUEST, apps: [{ appRoot: APP_A }, { appRoot: APP_B }] }),
    ).rejects.toMatchObject({ code: 'NO_SOURCE' });
  });

  it('delegates extraction to extractOpenApi and auth to validateAuthConfig/validateAuthReferences (research R1/R7)', async () => {
    const result = await compose({
      ...REQUEST,
      compositionRoot: '/composition-root',
    });
    expect(hoisted.extractCalls).toEqual([APP_A, APP_B]);
    expect(hoisted.authConfigCalls).toEqual(['/composition-root']);
    expect(hoisted.authRefCalls).toEqual(['1']);
    expect(result.document.paths).toBeDefined();
  });

  it('never mutates input documents (deep-freeze + deep-compare, FR-014/SC-007)', async () => {
    const snapshotA = `${JSON.stringify(hoisted.docs.get(APP_A))}\n`;
    const snapshotB = `${JSON.stringify(hoisted.docs.get(APP_B))}\n`;
    await compose({ ...REQUEST, compositionRoot: '/composition-root' });
    expect(`${JSON.stringify(hoisted.docs.get(APP_A))}\n`).toBe(snapshotA);
    expect(`${JSON.stringify(hoisted.docs.get(APP_B))}\n`).toBe(snapshotB);
    expect(Object.isFrozen(hoisted.docs.get(APP_A))).toBe(true);
    expect(Object.isFrozen(hoisted.docs.get(APP_B))).toBe(true);
  });

  it('rejects an empty apps list with COMPOSE_NO_PARTICIPANTS before any extraction', async () => {
    await expect(compose({ ...REQUEST, apps: [] })).rejects.toMatchObject({
      code: 'COMPOSE_NO_PARTICIPANTS',
    });
    expect(hoisted.extractCalls).toEqual([]);
  });
});

describe('compose — delegation/boundary regression (T035, FR-015, quickstart §US5)', () => {
  it('compose never reimplements extraction/auth: fake app roots only resolve via the 006/007 mocks (research R1/R7)', async () => {
    const fakeA = '/nonexistent/pool/app-a';
    const fakeB = '/nonexistent/pool/app-b';
    hoisted.docs.set(fakeA, frozenDoc({ '/a': { get: { operationId: 'getA' } } }, 'ADto'));
    hoisted.docs.set(fakeB, frozenDoc({ '/b': { get: { operationId: 'getB' } } }, 'BDto'));
    const result = await compose({
      compositionRoot: '/composition-root',
      apps: [{ appRoot: fakeA }, { appRoot: fakeB }],
    });
    expect(hoisted.extractCalls).toEqual([fakeA, fakeB]);
    expect(hoisted.authConfigCalls).toEqual(['/composition-root']);
    expect(result.document.openapi).toBe('3.0.0');
  });

  it('surfaces 006/007 errors untransformed as their own types across the whole pipeline (FR-015)', async () => {
    hoisted.failAuth.value = true;
    await expect(
      compose({ ...REQUEST, compositionRoot: '/root-with-bad-auth' }),
    ).rejects.toMatchObject({
      name: 'AuthConfigError',
      code: 'AUTH_FILE_MISSING',
      path: '/root-with-bad-auth',
    });
    hoisted.failAuth.value = false;

    hoisted.docs.delete(APP_B);
    await expect(
      compose({ ...REQUEST, apps: [{ appRoot: APP_A }, { appRoot: APP_B }] }),
    ).rejects.toMatchObject({ name: 'OpenApiExtractError', code: 'NO_SOURCE' });
  });
});

describe('compose — edge cases (T037, FR-002/004)', () => {
  it('single-participant composition is a valid gateway with the same override/auth rules (US1/AC4)', async () => {
    const result = await compose({
      compositionRoot: '/composition-root',
      apps: [{ appRoot: APP_A }],
    });
    expect(result.document.openapi).toBe('3.0.0');
    expect(result.document.info).toEqual({ title: 'gateway', version: '1.0.0' });
    const paths = result.document.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toEqual(['/a']);
    expect(result.provenance.get('/a')).toBe('app-a');
  });

  it('an empty-app participant (no paths) contributes an empty set, not an error — other participants complete (FR-002)', async () => {
    hoisted.docs.set(APP_B, frozenDoc({}, 'BDto'));
    const result = await compose({
      compositionRoot: '/composition-root',
      apps: [{ appRoot: APP_A }, { appRoot: APP_B }],
    });
    const paths = result.document.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toEqual(['/a']);
    expect(result.provenance.get('/a')).toBe('app-a');
  });

  it('duplicate appRoot in apps → fail-fast (data-model §НЕ ошибки, optimistic-duplicate rule)', async () => {
    await expect(
      compose({
        compositionRoot: '/composition-root',
        apps: [{ appRoot: APP_A }, { appRoot: APP_A }],
      }),
    ).rejects.toMatchObject({
      name: 'ComposeError',
      code: 'COMPOSE_NO_PARTICIPANTS',
      app: APP_A,
    });
    expect(hoisted.extractCalls).toEqual([]);
  });
});