import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { validateAuthConfig, type AuthConfigErrorCode } from '../src/index.js';

const FIXTURE = (name: string) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

const MINIMAL_DOC = {
  openapi: '3.0.0',
  info: { title: 'minimal', version: '1.0.0' },
  paths: {},
};

const CANONICAL_ROOT = FIXTURE('openapi-app');
const CANONICAL_DOC = JSON.parse(readFileSync(join(CANONICAL_ROOT, 'openapi.json'), 'utf8'));

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