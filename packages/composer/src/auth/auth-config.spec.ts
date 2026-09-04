import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateAuthConfig, validateAuthReferences, type OpenApiDocument } from '../index.js';

function tempRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yc-composer-auth-config-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function docWithSecurity(scheme: string): OpenApiDocument {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1.0.0' },
    paths: { '/x': { get: { security: [{ [scheme]: [] }] } } },
  };
}

describe('validateAuthConfig — fixed pipeline order (SC-003)', () => {
  const cases: Array<[string, Record<string, string>, OpenApiDocument, { functions?: string[] }, object]> =
    [
      [
        'bad version wins over an undeclared security ref',
        { 'auth.yaml': 'version: 2\ndefaultScheme: user\nschemes:\n  user:\n    type: none\n' },
        docWithSecurity('ghost'),
        {},
        { code: 'AUTH_VERSION_UNSUPPORTED', field: 'version' },
      ],
      [
        'missing defaultScheme wins over an undeclared security ref',
        { 'auth.yaml': 'version: 1\nschemes:\n  user:\n    type: none\n' },
        docWithSecurity('ghost'),
        {},
        { code: 'AUTH_DEFAULT_MISSING', field: 'defaultScheme' },
      ],
      [
        'empty schemes wins over an unresolved defaultScheme',
        { 'auth.yaml': 'version: 1\ndefaultScheme: ghost\nschemes: {}\n' },
        docWithSecurity('ghost'),
        {},
        { code: 'AUTH_SCHEMES_EMPTY', field: 'schemes' },
      ],
      [
        'missing jwt field wins over an undeclared security ref',
        {
          'auth.yaml':
            'version: 1\ndefaultScheme: user\nschemes:\n  user:\n    type: jwt\n    jwksUri: u\n    issuer: i\n',
        },
        docWithSecurity('ghost'),
        {},
        { code: 'AUTH_MISSING_FIELD', schemeName: 'user', field: 'audience' },
      ],
      [
        'unresolved function ref wins over an undeclared security ref',
        {
          'auth.yaml':
            'version: 1\ndefaultScheme: internal\nschemes:\n  internal:\n    type: function\n    function: functions.nope\n',
        },
        docWithSecurity('ghost'),
        { functions: ['internal_authorizer'] },
        { code: 'AUTH_FUNCTION_UNRESOLVED', ref: 'functions.nope' },
      ],
      [
        'invalid function grammar wins over a missing functions set',
        {
          'auth.yaml':
            'version: 1\ndefaultScheme: internal\nschemes:\n  internal:\n    type: function\n    function: internal_authorizer\n',
        },
        docWithSecurity('ghost'),
        {},
        { code: 'AUTH_FUNCTION_INVALID_REF', ref: 'internal_authorizer' },
      ],
      [
        'undeclared security ref is the final stage error',
        {
          'auth.yaml': 'version: 1\ndefaultScheme: user\nschemes:\n  user:\n    type: none\n',
        },
        docWithSecurity('ghost'),
        {},
        { code: 'AUTH_SECURITY_UNDECLARED', schemeName: 'ghost', route: 'GET /x' },
      ],
    ];

  it.each(cases)('%s', async (_label, files, openApi, request, expected) => {
    const root = tempRoot(files);
    try {
      await expect(
        validateAuthConfig({ appRoot: root, openApi, ...request }),
      ).rejects.toMatchObject(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops the pipeline at the first stage failure (SECURITY is never reached)', async () => {
    const root = tempRoot({
      'auth.yaml': 'version: 2\ndefaultScheme: ghost\nschemes: {}\n',
    });
    try {
      await expect(
        validateAuthConfig({
          appRoot: root,
          openApi: docWithSecurity('ghost'),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_VERSION_UNSUPPORTED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('validateAuthReferences — standalone cross-validation against a validated authYaml', () => {
  it('validates security references without re-reading auth.yaml', () => {
    const result = validateAuthReferences(
      docWithSecurity('user'),
      {
        version: 1,
        defaultScheme: 'user',
        schemes: { user: { type: 'none' } },
      },
    );
    expect(result).toEqual({
      authYaml: {
        version: 1,
        defaultScheme: 'user',
        schemes: { user: { type: 'none' } },
      },
    });
  });

  it('rejects an undeclared security reference', () => {
    expect(() =>
      validateAuthReferences(
        docWithSecurity('admin'),
        { version: 1, defaultScheme: 'user', schemes: { user: { type: 'none' } } },
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'AUTH_SECURITY_UNDECLARED', schemeName: 'admin' }),
    );
  });
});