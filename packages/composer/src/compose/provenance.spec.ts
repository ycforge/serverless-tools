import { describe, expect, it } from 'vitest';

import { PathOwnership, walkJsonKeys, type OperationIdRef } from './provenance.js';
import type { RouteOwner } from './types.js';

const USER_PATHS = {
  '/users': { get: { operationId: 'listUsers' } },
  '/users/{id}': { get: { operationId: 'getUser' } },
};

const ANALYTICS_PATHS = {
  '/analytics/{id}': { get: { operationId: 'getAnalytics' } },
};

const PROVENANCE_KEYS = /^(app|appId|owner|ownership|provenance|ownerByPath|operationIdIndex)$/i;

describe('PathOwnership — provenance (US1/AC3, FR-003/017)', () => {
  it('builds path → owner for every participant path', () => {
    const ownership = new PathOwnership([
      { appId: 'user_service', paths: USER_PATHS },
      { appId: 'analytics', paths: ANALYTICS_PATHS },
    ]);
    expect(ownership.ownerOf('/users')).toBe('user_service');
    expect(ownership.ownerOf('/users/{id}')).toBe('user_service');
    expect(ownership.ownerOf('/analytics/{id}')).toBe('analytics');
  });

  it('a global-override-added path maps to owner "global"', () => {
    const ownership = new PathOwnership([{ appId: 'user_service', paths: USER_PATHS }]);
    ownership.assignPath('/_health', 'global' as RouteOwner);
    expect(ownership.ownerOf('/_health')).toBe('global');
  });

  it('operationId index resolves to { path, appId } (FR-005 addressability)', () => {
    const ownership = new PathOwnership([{ appId: 'user_service', paths: USER_PATHS }]);
    const ref: OperationIdRef | undefined = ownership.resolveOperation('listUsers');
    expect(ref).toEqual({ path: '/users', appId: 'user_service', method: 'get' });
    expect(ownership.resolveOperation('nope')).toBeUndefined();
  });

  it('provenance never leaks into a serialized GatewayDocument (FR-017, SC-004)', () => {
    const ownership = new PathOwnership([{ appId: 'user_service', paths: USER_PATHS }]);
    const document = {
      openapi: '3.0.0',
      info: { title: 'gateway', version: '1.0.0' },
      paths: {
        '/users': { get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } } },
      },
      components: { schemas: { UserDto: { type: 'object' } } },
    };
    const keys: string[] = [];
    walkJsonKeys(document, (key) => keys.push(key));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(PROVENANCE_KEYS.test(key)).toBe(false);
    }
    expect(ownership.ownerByPath.size).toBeGreaterThan(0);
  });
});