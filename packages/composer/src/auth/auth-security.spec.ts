import { describe, expect, it } from 'vitest';
import type { OpenApiDocument } from '../errors.js';
import type { AuthYamlDocument } from './types.js';
import { collectSecurityEntries, validateSecurityReferences } from './auth-security.js';

const AUTH: AuthYamlDocument = {
  version: 1,
  defaultScheme: 'user',
  schemes: {
    public: { type: 'none' },
    user: { type: 'none' },
  },
};

const AUTH_WITH_PUBLIC_NORMAL: AuthYamlDocument = {
  version: 1,
  defaultScheme: 'Public',
  schemes: {
    Public: { type: 'none' },
    user: { type: 'none' },
  },
};

function docWith(patch: Record<string, unknown>): OpenApiDocument {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1.0.0' },
    paths: {},
    ...patch,
  };
}

describe('collectSecurityEntries', () => {
  it('collects root security with route "root" (R6, FR-013)', () => {
    const entries = collectSecurityEntries(
      docWith({ security: [{ user: [] }] }),
    );
    expect(entries).toEqual([{ route: 'root', schemeName: 'user' }]);
  });

  it('collects operation security with "METHOD /path" routes', () => {
    const entries = collectSecurityEntries(
      docWith({
        paths: {
          '/admin': { get: { security: [{ admin: [] }] } },
          '/users': { post: { security: [{ user: ['read'] }] } },
        },
      }),
    );
    expect(entries).toEqual([
      { route: 'GET /admin', schemeName: 'admin' },
      { route: 'POST /users', schemeName: 'user' },
    ]);
  });

  it('ignores non-operation keys, naked operations and empty requirements', () => {
    const entries = collectSecurityEntries(
      docWith({
        paths: {
          '/ping': { get: {}, parameters: [{ name: 'x', in: 'header' }] },
          '/none': { security: [] },
          '/mixed': { get: { security: [{ user: [] }, {}] } },
        },
      }),
    );
    expect(entries).toEqual([{ route: 'GET /mixed', schemeName: 'user' }]);
  });
});

describe('validateSecurityReferences', () => {
  it('passes when every referenced scheme is declared (US2/AC1)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({
          security: [{ user: [] }],
          paths: { '/users': { get: { security: [{ user: [] }] } } },
        }),
        AUTH,
      ),
    ).not.toThrow();
  });

  it('rejects an undeclared scheme with schemeName + route (US2/AC2, SC-004)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({ paths: { '/admin': { get: { security: [{ admin: [] }] } } } }),
        AUTH,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'AUTH_SECURITY_UNDECLARED',
        schemeName: 'admin',
        route: 'GET /admin',
      }),
    );
  });

  it('passes with declared-but-unused schemes (US2/AC3)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({ paths: { '/users': { get: { security: [{ user: [] }] } } } }),
        { ...AUTH, schemes: { ...AUTH.schemes, unused: { type: 'none' } } },
      ),
    ).not.toThrow();
  });

  it('passes naked operations and explicit empty security (US2/AC4, 008 seam)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({
          paths: {
            '/naked': { get: {} },
            '/empty': { get: { security: [] } },
          },
        }),
        AUTH,
      ),
    ).not.toThrow();
  });

  it('rejects `public` inside a security entry (US2/AC5, FR-009)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({ paths: { '/any': { get: { security: [{ public: null }] } } } }),
        AUTH,
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'AUTH_SECURITY_PUBLIC_VIOLATION', route: 'GET /any' }),
    );
  });

  it('rejects `public` in the document-root security with route root (FR-009)', () => {
    expect(() => validateSecurityReferences(docWith({ security: [{ public: [] }] }), AUTH)).toThrowError(
      expect.objectContaining({
        code: 'AUTH_SECURITY_PUBLIC_VIOLATION',
        route: 'root',
      }),
    );
  });

  it('ignores components.securitySchemes as a source (R6, FR-013)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({
          security: [{ user: [] }],
          components: {
            securitySchemes: { weird: { type: 'apiKey', name: 'x', in: 'header' } },
          },
        }),
        AUTH,
      ),
    ).not.toThrow();
  });

  it('matches scheme names case-sensitively: `Public` is not `public` (Edge cases)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({ paths: { '/x': { get: { security: [{ Public: [] }] } } } }),
        AUTH,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'AUTH_SECURITY_UNDECLARED',
        schemeName: 'Public',
        route: 'GET /x',
      }),
    );
  });

  it('treats a declared `Public` scheme as a normal scheme (Edge cases)', () => {
    expect(() =>
      validateSecurityReferences(
        docWith({ paths: { '/x': { get: { security: [{ Public: [] }] } } } }),
        AUTH_WITH_PUBLIC_NORMAL,
      ),
    ).not.toThrow();
  });
});