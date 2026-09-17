import { describe, expect, it } from 'vitest';
import { parseAuthYaml } from './auth-yaml.js';
import { AuthConfigError } from './auth-errors.js';

const SOURCE = '/app/auth.yaml';

const VALID_YAML = `
version: 1
defaultScheme: user

schemes:
  public:
    type: none

  user:
    type: jwt
    jwksUri: https://auth.example.com/jwks.json
    issuer: https://auth.example.com
    audience: [my-api]

  internal:
    type: function
    function: functions.internal_authorizer
`;

describe('parseAuthYaml — valid documents (US1/AC1, SC-002)', () => {
  it('accepts a document with none + jwt + function schemes and array audience', () => {
    const doc = parseAuthYaml(VALID_YAML, SOURCE);
    expect(doc).toEqual({
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
      },
    });
  });

  it('accepts a scalar string audience (R7)', () => {
    const doc = parseAuthYaml(
      `
version: 1
defaultScheme: user
schemes:
  user:
    type: jwt
    jwksUri: https://auth.example.com/jwks.json
    issuer: https://auth.example.com
    audience: my-api
`,
      SOURCE,
    );
    expect(doc.schemes.user).toMatchObject({ type: 'jwt', audience: 'my-api' });
  });

  it('accepts `public` (none) and function schemes together (FR-009)', () => {
    const doc = parseAuthYaml(
      `
version: 1
defaultScheme: internal
schemes:
  public:
    type: none
  internal:
    type: function
    function: functions.internal_authorizer
`,
      SOURCE,
    );
    expect(doc.schemes.public).toEqual({ type: 'none' });
  });
});

describe('parseAuthYaml — invalid documents (US1/AC2..7, SC-003)', () => {
  it.each([
    [
      'missing version',
      `
defaultScheme: user
schemes:
  user:
    type: none
`,
      { code: 'AUTH_VERSION_UNSUPPORTED', field: 'version' },
    ],
    [
      'foreign version 2',
      `
version: 2
defaultScheme: user
schemes:
  user:
    type: none
`,
      { code: 'AUTH_VERSION_UNSUPPORTED', field: 'version' },
    ],
    [
      'missing defaultScheme',
      `
version: 1
schemes:
  user:
    type: none
`,
      { code: 'AUTH_DEFAULT_MISSING', field: 'defaultScheme' },
    ],
    [
      'defaultScheme that is not declared',
      `
version: 1
defaultScheme: ghost
schemes:
  user:
    type: none
`,
      { code: 'AUTH_DEFAULT_UNRESOLVED', schemeName: 'ghost' },
    ],
    [
      'empty schemes map',
      `
version: 1
defaultScheme: user
schemes: {}
`,
      { code: 'AUTH_SCHEMES_EMPTY', field: 'schemes' },
    ],
    [
      'schemes that is not a map',
      `
version: 1
defaultScheme: user
schemes:
  - user
  - internal
`,
      { code: 'AUTH_SCHEMES_NOT_MAP', field: 'schemes' },
    ],
    [
      'unknown scheme type oauth2',
      `
version: 1
defaultScheme: user
schemes:
  user:
    type: oauth2
`,
      { code: 'AUTH_UNKNOWN_SCHEME_TYPE', schemeName: 'user', type: 'oauth2' },
    ],
    [
      'jwt missing required audience',
      `
version: 1
defaultScheme: user
schemes:
  user:
    type: jwt
    jwksUri: https://auth.example.com/jwks.json
    issuer: https://auth.example.com
`,
      { code: 'AUTH_MISSING_FIELD', schemeName: 'user', field: 'audience' },
    ],
    [
      'jwt with empty audience array equals missing (R7)',
      `
version: 1
defaultScheme: user
schemes:
  user:
    type: jwt
    jwksUri: https://auth.example.com/jwks.json
    issuer: https://auth.example.com
    audience: []
`,
      { code: 'AUTH_MISSING_FIELD', schemeName: 'user', field: 'audience' },
    ],
    [
      'function scheme missing the function field',
      `
version: 1
defaultScheme: internal
schemes:
  internal:
    type: function
`,
      { code: 'AUTH_MISSING_FIELD', schemeName: 'internal', field: 'function' },
    ],
  ])(
    'rejects %s fail-fast with the exact code + context',
    (_label, yaml, expected) => {
      expect(() => parseAuthYaml(yaml, SOURCE)).toThrowError(
        expect.objectContaining(expected),
      );
    },
  );

  it('rejects a duplicate key outside schemes with AUTH_DUPLICATE_KEY and the keyPath', () => {
    const dup = `
version: 1
defaultScheme: user
schemes:
  user:
    type: none
schemes:
  user:
    type: jwt
`;
    expect(() => parseAuthYaml(dup, SOURCE)).toThrowError(
      expect.objectContaining({ code: 'AUTH_DUPLICATE_KEY', keyPath: 'schemes' }),
    );
  });

  it('rejects a duplicate scheme name inside schemes with AUTH_DUPLICATE_SCHEME', () => {
    const dup = `
version: 1
defaultScheme: user
schemes:
  user:
    type: none
  user:
    type: jwt
`;
    expect(() => parseAuthYaml(dup, SOURCE)).toThrowError(
      expect.objectContaining({ code: 'AUTH_DUPLICATE_SCHEME', schemeName: 'user' }),
    );
  });

  it('throws AuthConfigError (never a silent last-wins merge — Constitution V)', () => {
    const dup = `
version: 1
defaultScheme: user
schemes:
  user:
    type: none
  user:
    type: jwt
`;
    let thrown: unknown;
    try {
      parseAuthYaml(dup, SOURCE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthConfigError);
    expect((thrown as AuthConfigError).schemeName).toBe('user');
  });

  it('rejects an empty scheme-name key with AUTH_INVALID_SCHEME_NAME and schemeName context', () => {
    const yaml = `
version: 1
defaultScheme: user
schemes:
  user:
    type: none
  '':
    type: none
`;
    expect(() => parseAuthYaml(yaml, SOURCE)).toThrowError(
      expect.objectContaining({ code: 'AUTH_INVALID_SCHEME_NAME', schemeName: '' }),
    );
  });

  it('empty scheme-name error names the scheme and never embeds document contents', () => {
    const yaml = `
version: 1
defaultScheme: user
schemes:
  user:
    type: jwt
    jwksUri: https://auth.example.com/jwks.json
    issuer: https://auth.example.com
    audience: [NEVER-LEAK-SCHEME-CONTENT]
  '':
    type: jwt
    jwksUri: https://evil.example.com/jwks.json
    issuer: https://evil.example.com
    audience: [TOP-SECRET-AUDIENCE]
`;
    let thrown: unknown;
    try {
      parseAuthYaml(yaml, SOURCE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthConfigError);
    const error = thrown as AuthConfigError;
    expect(error.code).toBe('AUTH_INVALID_SCHEME_NAME');
    expect(error.schemeName).toBe('');
    expect(error.message).toContain("schemeName: ''");
    expect(error.message).not.toContain('NEVER-LEAK-SCHEME-CONTENT');
    expect(error.message).not.toContain('TOP-SECRET-AUDIENCE');
    expect(error.message).not.toContain('evil.example.com');
  });
});

describe('parseAuthYaml — edge cases (T025)', () => {
  it('accepts defaultScheme: public with a declared public/none scheme (FR-009)', () => {
    const doc = parseAuthYaml(
      `version: 1
defaultScheme: public
schemes:
  public:
    type: none
`,
      SOURCE,
    );
    expect(doc.defaultScheme).toBe('public');
    expect(doc.schemes.public).toEqual({ type: 'none' });
  });

  it('distinguishes Public from public (case-sensitive scheme names)', () => {
    const doc = parseAuthYaml(
      `version: 1
defaultScheme: Public
schemes:
  Public:
    type: none
`,
      SOURCE,
    );
    expect(doc).toEqual({
      version: 1,
      defaultScheme: 'Public',
      schemes: { Public: { type: 'none' } },
    });

    expect(() =>
      parseAuthYaml(
        `version: 1
defaultScheme: public
schemes:
  Public:
    type: none
`,
        SOURCE,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'AUTH_DEFAULT_UNRESOLVED',
        schemeName: 'public',
      }),
    );
  });

  it('rejects an empty/corrupt document as AUTH_FILE_INVALID_YAML', () => {
    expect(() => parseAuthYaml('', SOURCE)).toThrowError(
      expect.objectContaining({ code: 'AUTH_FILE_INVALID_YAML', path: SOURCE }),
    );
    expect(() => parseAuthYaml('   \n\t\n', SOURCE)).toThrowError(
      expect.objectContaining({ code: 'AUTH_FILE_INVALID_YAML', path: SOURCE }),
    );
  });
});