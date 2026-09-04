import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { validateAuthConfig, type AuthConfigErrorCode } from '../src/index.js';

const FIXTURE = (name: string) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

function readFixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE(name), 'openapi.json'), 'utf8'));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

const MINIMAL_DOC = {
  openapi: '3.0.0',
  info: { title: 'minimal', version: '1.0.0' },
  paths: {},
};

const CANONICAL_ROOT = FIXTURE('openapi-app');
const CANONICAL_DOC = readFixtureJson('openapi-app');

const US1_NEGATIVE_CASES: Array<[string, AuthConfigErrorCode]> = [
  ['openapi-app-no-auth', 'AUTH_FILE_MISSING'],
  ['openapi-app-bad-version', 'AUTH_VERSION_UNSUPPORTED'],
  ['openapi-app-missing-default', 'AUTH_DEFAULT_MISSING'],
  ['openapi-app-default-unresolved', 'AUTH_DEFAULT_UNRESOLVED'],
  ['openapi-app-empty-schemes', 'AUTH_SCHEMES_EMPTY'],
  ['openapi-app-schemes-not-map', 'AUTH_SCHEMES_NOT_MAP'],
  ['openapi-app-dup', 'AUTH_DUPLICATE_SCHEME'],
  ['openapi-app-unknown-type', 'AUTH_UNKNOWN_SCHEME_TYPE'],
  ['openapi-app-missing-jwt-fields', 'AUTH_MISSING_FIELD'],
  ['openapi-app-missing-function', 'AUTH_MISSING_FIELD'],
];

describe('validateAuthConfig — US1 self-validation on fixture roots', () => {
  it('resolves the canonical openapi-app composition with the expected authYaml (US1/AC1, SC-002)', async () => {
    const result = await validateAuthConfig({
      appRoot: CANONICAL_ROOT,
      openApi: CANONICAL_DOC,
      functions: ['internal_authorizer'],
    });
    expect(result).toEqual({
      authYaml: {
        version: 1,
        defaultScheme: 'user',
        schemes: {
          public: { type: 'none' },
          user: {
            type: 'jwt',
            jwksUri: 'https://auth.example.com/jwks.json',
            issuer: 'https://auth.example.com',
            audience: ['my-api'],
          },
          internal: { type: 'function', function: 'functions.internal_authorizer' },
          frontend: { type: 'none' },
        },
      },
    });
  });

  it.each(US1_NEGATIVE_CASES)(
    'rejects %s with the exact deterministic code (US1/AC2..7, SC-003)',
    async (fixtureName, code) => {
      await expect(
        validateAuthConfig({ appRoot: FIXTURE(fixtureName), openApi: MINIMAL_DOC }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('reports the problem context (field / scheme name) in the rejection', async () => {
    await expect(
      validateAuthConfig({ appRoot: FIXTURE('openapi-app-missing-jwt-fields'), openApi: MINIMAL_DOC }),
    ).rejects.toMatchObject({
      code: 'AUTH_MISSING_FIELD',
      schemeName: 'user',
      field: 'audience',
    });
  });
});

describe('validateAuthConfig — US2 security-reference cross-validation on fixture roots', () => {
  it('accepts the canonical document with all declared refs, plus a declared-but-unused scheme (US2/AC1+AC3)', async () => {
    const result = await validateAuthConfig({
      appRoot: CANONICAL_ROOT,
      openApi: CANONICAL_DOC,
      functions: ['internal_authorizer'],
    });
    expect(result.authYaml.defaultScheme).toBe('user');
    expect(Object.keys(result.authYaml.schemes)).toEqual(['public', 'user', 'internal', 'frontend']);
  });

  it('rejects an undeclared scheme ref with schemeName + route (US2/AC2, SC-004)', async () => {
    await expect(
      validateAuthConfig({
        appRoot: FIXTURE('openapi-app-undeclared-ref'),
        openApi: readFixtureJson('openapi-app-undeclared-ref'),
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_SECURITY_UNDECLARED',
      schemeName: 'admin',
      route: 'GET /admin',
    });
  });

  it('rejects `public` in a security entry with the route (US2/AC5, FR-009)', async () => {
    await expect(
      validateAuthConfig({
        appRoot: FIXTURE('openapi-app-public-ref'),
        openApi: readFixtureJson('openapi-app-public-ref'),
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_SECURITY_PUBLIC_VIOLATION',
      route: 'GET /any',
    });
  });

  it('accepts naked operations without applying defaultScheme (US2/AC4, 008 seam)', async () => {
    const frozenDoc = deepFreeze(readFixtureJson('openapi-app-naked-ops'));
    const result = await validateAuthConfig({
      appRoot: FIXTURE('openapi-app-naked-ops'),
      openApi: frozenDoc,
    });
    expect(Object.keys(result)).toEqual(['authYaml']);
    expect(result.authYaml.defaultScheme).toBe('user');
  });
});