import { describe, expect, it } from 'vitest';

import { ComposeError, type ComposeErrorCode, type ComposeErrorContext } from './compose-errors.js';

const ALL_CODES: readonly ComposeErrorCode[] = [
  'COMPOSE_NO_PARTICIPANTS',
  'COMPOSE_OPENAPI_VERSION_MISMATCH',
  'COMPOSE_PATH_COLLISION',
  'COMPOSE_OPERATIONID_COLLISION',
  'COMPOSE_COMPONENT_COLLISION',
  'COMPOSE_SECURITY_REF_NONE_SCHEME',
  'COMPOSE_INFO_MISSING',
  'OVERRIDE_FILE_UNREADABLE',
  'OVERRIDE_FILE_INVALID_YAML',
  'OVERRIDE_VERSION_UNSUPPORTED',
  'OVERRIDE_RULES_NOT_LIST',
  'OVERRIDE_RULES_EMPTY',
  'OVERRIDE_UNKNOWN_OP',
  'OVERRIDE_INVALID_TARGET',
  'OVERRIDE_VALUE_REQUIRED',
  'OVERRIDE_VALUE_FORBIDDEN',
  'OVERRIDE_METHOD_INVALID',
  'OVERRIDE_TARGET_MISSING',
  'OVERRIDE_TARGET_ALREADY_EXISTS',
  'OVERRIDE_OUT_OF_SCOPE',
];

function buildError(code: ComposeErrorCode, context: ComposeErrorContext = {}): ComposeError {
  return new ComposeError(code, context);
}

describe('ComposeError — taxonomy (foundational)', () => {
  it('is an Error with name "ComposeError" (SC-003 pattern)', () => {
    const error = buildError('COMPOSE_NO_PARTICIPANTS');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ComposeError');
  });

  it('every contract code maps to an instantiable ComposeError carrying that code', () => {
    for (const code of ALL_CODES) {
      const error = buildError(code);
      expect(error).toBeInstanceOf(ComposeError);
      expect(error.code).toBe(code);
      expect(error.message).toBeTypeOf('string');
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('carries contract context fields when provided', () => {
    const error = buildError('COMPOSE_OPERATIONID_COLLISION', {
      app: 'user_service',
      path: '/users',
      method: 'get',
      operationId: 'listUsers',
      componentName: 'UserDto',
      target: 'operation',
      op: 'replace',
      ruleIndex: 2,
      filePath: '/root/overrides.yaml',
      schemeName: 'user',
      route: 'GET /users',
      versions: ['3.0.0', '3.1.0'],
      apps: ['user_service', 'analytics'],
    });
    expect(error.app).toBe('user_service');
    expect(error.path).toBe('/users');
    expect(error.method).toBe('get');
    expect(error.operationId).toBe('listUsers');
    expect(error.componentName).toBe('UserDto');
    expect(error.target).toBe('operation');
    expect(error.op).toBe('replace');
    expect(error.ruleIndex).toBe(2);
    expect(error.filePath).toBe('/root/overrides.yaml');
    expect(error.schemeName).toBe('user');
    expect(error.route).toBe('GET /users');
    expect(error.versions).toEqual(['3.0.0', '3.1.0']);
    expect(error.apps).toEqual(['user_service', 'analytics']);
  });

  it('messages are deterministic and built only from context, never from document contents', () => {
    const pathCollision = buildError('COMPOSE_PATH_COLLISION', {
      path: '/users',
      apps: ['user_service', 'analytics'],
    });
    expect(pathCollision.message).toBe(
      'path /users is declared by more than one app (user_service, analytics)',
    );

    const versionMismatch = buildError('COMPOSE_OPENAPI_VERSION_MISMATCH', {
      apps: ['a', 'b'],
      versions: ['3.0.0', '3.1.0'],
    });
    expect(versionMismatch.message).toContain('3.0.0');

    const noneRef = buildError('COMPOSE_SECURITY_REF_NONE_SCHEME', {
      route: 'GET /admin',
      schemeName: 'anon',
    });
    expect(noneRef.message).toContain('GET /admin');
    expect(noneRef.message).toContain('anon');
  });

  it('context-free construction still yields a non-empty, non-throwing message per code', () => {
    for (const code of ALL_CODES) {
      expect(() => buildError(code)).not.toThrow();
      expect(buildError(code).message.length).toBeGreaterThan(0);
    }
  });
});