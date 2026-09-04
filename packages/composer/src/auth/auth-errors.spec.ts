import { describe, expect, it } from 'vitest';
import {
  AuthConfigError,
  AUTH_CONFIG_ERROR_CODES,
  type AuthConfigErrorCode,
} from './auth-errors.js';

const CODE_COUNT = 16;

const MESSAGE_CASES: Array<[AuthConfigErrorCode, Record<string, string>, string[]]> = [
  ['AUTH_FILE_MISSING', { path: '/app/auth.yaml' }, ['/app/auth.yaml']],
  ['AUTH_FILE_INVALID_YAML', { path: '/app/auth.yaml' }, ['/app/auth.yaml']],
  ['AUTH_DUPLICATE_KEY', { keyPath: 'schemes.user.issuer' }, ['schemes.user.issuer']],
  ['AUTH_DUPLICATE_SCHEME', { schemeName: 'user' }, ['user']],
  ['AUTH_VERSION_UNSUPPORTED', { field: 'version' }, ['version']],
  ['AUTH_DEFAULT_MISSING', { field: 'defaultScheme' }, ['defaultScheme']],
  ['AUTH_DEFAULT_UNRESOLVED', { schemeName: 'ghost' }, ['ghost']],
  ['AUTH_SCHEMES_EMPTY', { field: 'schemes' }, ['schemes']],
  ['AUTH_SCHEMES_NOT_MAP', { field: 'schemes' }, ['schemes']],
  ['AUTH_UNKNOWN_SCHEME_TYPE', { schemeName: 'user', type: 'oauth2' }, ['user', 'oauth2']],
  ['AUTH_MISSING_FIELD', { schemeName: 'user', field: 'audience' }, ['user', 'audience']],
  ['AUTH_FUNCTION_INVALID_REF', { ref: 'internal_authorizer' }, ['internal_authorizer']],
  ['AUTH_FUNCTION_UNRESOLVED', { ref: 'functions.nope' }, ['functions.nope']],
  ['AUTH_FUNCTION_SET_REQUIRED', { schemeName: 'internal' }, ['internal']],
  ['AUTH_SECURITY_UNDECLARED', { schemeName: 'admin', route: 'GET /admin' }, ['admin', 'GET /admin']],
  ['AUTH_SECURITY_PUBLIC_VIOLATION', { route: 'root' }, ['root']],
];

describe('AuthConfigError', () => {
  it('extends Error with name "AuthConfigError" and carries the code', () => {
    const err = new AuthConfigError('AUTH_VERSION_UNSUPPORTED', { field: 'version' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthConfigError);
    expect(err.name).toBe('AuthConfigError');
    expect(err.code).toBe('AUTH_VERSION_UNSUPPORTED');
  });

  it('exposes the full 16-code taxonomy from the contract table', () => {
    expect(AUTH_CONFIG_ERROR_CODES).toHaveLength(CODE_COUNT);
    expect(new Set(AUTH_CONFIG_ERROR_CODES)).toHaveLength(CODE_COUNT);
    for (const code of AUTH_CONFIG_ERROR_CODES) {
      const err = new AuthConfigError(code);
      expect(err).toBeInstanceOf(AuthConfigError);
      expect(err.code).toBe(code);
    }
  });

  it('carries the contract context fields', () => {
    const err = new AuthConfigError('AUTH_SECURITY_UNDECLARED', {
      path: '/app/auth.yaml',
      schemeName: 'admin',
      field: 'security',
      type: 'oauth2',
      ref: 'functions.nope',
      route: 'GET /admin',
      keyPath: 'schemes.user',
    });
    expect(err).toMatchObject({
      path: '/app/auth.yaml',
      schemeName: 'admin',
      field: 'security',
      type: 'oauth2',
      ref: 'functions.nope',
      route: 'GET /admin',
      keyPath: 'schemes.user',
    });
  });

  it('builds deterministic messages that name only the context (SC-003)', () => {
    for (const [code, context, fragments] of MESSAGE_CASES) {
      const first = new AuthConfigError(code, context);
      const second = new AuthConfigError(code, { ...context });
      expect(first.message).toBe(second.message);
      for (const fragment of fragments) {
        expect(first.message).toContain(fragment);
      }
    }
  });

  it('never includes document contents or secrets in messages', () => {
    const dynDocContents = 'eyJhbGciOiJIUzI1NiJ9.some-secret';
    const err = new AuthConfigError('AUTH_FILE_INVALID_YAML', { path: '/app/auth.yaml' });
    expect(err.message).not.toContain('some-secret');
    expect(err.message).not.toContain(dynDocContents);
  });
});