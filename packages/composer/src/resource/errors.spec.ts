import { describe, expect, it } from 'vitest';

import { ResourceRefError, RESOURCE_REF_ERROR_CODES } from './errors.js';
import type { ResourceRefErrorCode, ResourceRefErrorContext } from './errors.js';

const ALL_CONTRACT_CODES: readonly ResourceRefErrorCode[] = [
  'RESOURCE_REF_VERSION_UNSUPPORTED',
  'RESOURCE_REF_INVALID_YAML',
  'RESOURCE_REF_DOMAIN_UNKNOWN',
  'RESOURCE_REF_PROPERTY_INVALID',
  'RESOURCE_REF_IDENTITY_COLLISION',
  'RESOURCE_REF_NOT_DECLARED',
  'RESOURCE_REF_SYNTAX_INVALID',
  'RESOURCE_REF_ENV_NOT_SET',
  'RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED',
  'RESOURCE_REF_ENV_UNDECLARED_RESOURCE',
  'RESOURCE_REF_COLLISION_APPS_RESOURCES',
];

describe('ResourceRefError — taxonomy (T003, contracts §Error Taxonomy, FR-001..020, SC-002/003)', () => {
  it('is instanceof Error with name "ResourceRefError"', () => {
    const err = new ResourceRefError('RESOURCE_REF_NOT_DECLARED', 'message', {});
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ResourceRefError');
  });

  it('exposes every contract code (all RESOURCE_REF_* incl. COLLISION seam 009→011)', () => {
    for (const code of ALL_CONTRACT_CODES) {
      expect(RESOURCE_REF_ERROR_CODES).toContain(code);
    }
    expect(ALL_CONTRACT_CODES.length).toBe(RESOURCE_REF_ERROR_CODES.length);
  });

  it('carries code and the contract context fields verbatim', () => {
    const context: ResourceRefErrorContext = {
      filePath: '/p/.ycsf/resources.yaml',
      version: '2',
      domain: 'functions',
      name: 'auth',
      property: 'id',
      allowedProperties: ['id'],
      input: 'functions.auth',
      reason: 'expected 3 segments, got 2',
      reference: '${resources.functions.auth.id}',
      envVar: 'LEGACY_AUTHORIZER_ID',
    };
    const err = new ResourceRefError('RESOURCE_REF_NOT_DECLARED', 'msg', context);
    expect(err.code).toBe('RESOURCE_REF_NOT_DECLARED');
    expect(err.context).toEqual(context);
    expect(err.filePath).toBe(context.filePath);
    expect(err.version).toBe('2');
    expect(err.domain).toBe('functions');
    expect(err.property).toBe('id');
    expect(err.allowedProperties).toEqual(['id']);
    expect(err.input).toBe('functions.auth');
    expect(err.reason).toBe('expected 3 segments, got 2');
    expect(err.reference).toBe('${resources.functions.auth.id}');
    expect(err.envVar).toBe('LEGACY_AUTHORIZER_ID');
  });

  it('builds English messages deterministically ONLY from context (no doc content, no non-deterministic data)', () => {
    const a = new ResourceRefError('RESOURCE_REF_DOMAIN_UNKNOWN', 'x', { domain: 'databases' });
    const b = new ResourceRefError('RESOURCE_REF_DOMAIN_UNKNOWN', 'y', { domain: 'databases' });
    expect(a.message).toBe(b.message);
    expect(a.message.length).toBeGreaterThan(0);
    expect(a.message).toMatch(/databases/);
    expect(a.message).not.toMatch(/crypt|candidate|random|Date|process/i);
  });

  it('unknown-domain message names the domain and the allowed set', () => {
    const err = new ResourceRefError('RESOURCE_REF_DOMAIN_UNKNOWN', 'x', {
      domain: 'databases',
    });
    expect(err.message).toContain('databases');
    expect(err.message).toContain('functions');
    expect(err.message).toContain('queues');
    expect(err.message).toContain('gateways');
  });

  it('env-not-set message names the envVar and the reference', () => {
    const err = new ResourceRefError('RESOURCE_REF_ENV_NOT_SET', 'x', {
      envVar: 'LEGACY_AUTHORIZER_ID',
      reference: '${resources.functions.legacy_authorizer.id}',
    });
    expect(err.message).toContain('LEGACY_AUTHORIZER_ID');
    expect(err.message).toContain('${resources.functions.legacy_authorizer.id}');
  });
});