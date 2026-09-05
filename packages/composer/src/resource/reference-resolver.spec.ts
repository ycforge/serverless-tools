import { describe, expect, it } from 'vitest';

import { parseResourceIndex } from './resource-index.js';
import { validateResourceReference } from './reference-resolver.js';
import type { ResourceIndex } from './types.js';
import { ResourceRefError } from './errors.js';

function inlineIndex(yamlText: string): ResourceIndex {
  return parseResourceIndex(yamlText, '/p/.ycsf/resources.yaml');
}

const INDEX = inlineIndex(`version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
`);

describe('validateResourceReference — T011 (US2/AC1-AC4, FR-005/006, SC-003)', () => {
  it('existing resource → { valid: true, parsed: {domain, name, property} }', () => {
    const result = validateResourceReference('${resources.functions.legacy_authorizer.id}', INDEX);
    expect(result).toEqual({
      valid: true,
      parsed: { domain: 'functions', name: 'legacy_authorizer', property: 'id' },
    });
  });

  it('unknown name → RESOURCE_REF_NOT_DECLARED with domain + name + reference', () => {
    const result = validateResourceReference('${resources.functions.nonexistent.id}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error).toBeInstanceOf(ResourceRefError);
      expect(result.error.code).toBe('RESOURCE_REF_NOT_DECLARED');
      expect(result.error.context).toMatchObject({
        domain: 'functions',
        name: 'nonexistent',
        reference: '${resources.functions.nonexistent.id}',
      });
    }
  });

  it('unknown domain → RESOURCE_REF_DOMAIN_UNKNOWN with reference', () => {
    const result = validateResourceReference('${resources.databases.events.id}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error.code).toBe('RESOURCE_REF_DOMAIN_UNKNOWN');
      expect(result.error.context).toMatchObject({
        domain: 'databases',
        reference: '${resources.databases.events.id}',
      });
    }
  });

  it('invalid property for the domain → RESOURCE_REF_PROPERTY_INVALID with reference', () => {
    const result = validateResourceReference('${resources.queues.events.name}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error.code).toBe('RESOURCE_REF_PROPERTY_INVALID');
      expect(result.error.context).toMatchObject({
        domain: 'queues',
        name: 'events',
        property: 'name',
        reference: '${resources.queues.events.name}',
      });
    }
  });

  it('malformed resources-namespace string (2 segments) → RESOURCE_REF_SYNTAX_INVALID with input + reason', () => {
    const result = validateResourceReference('${resources.functions.legacy_id}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error.code).toBe('RESOURCE_REF_SYNTAX_INVALID');
      expect(result.error.context.input).toBe('functions.legacy_id');
      expect(result.error.context.reason).toBeDefined();
    }
  });

  it('no-reference result is never valid and never reaches the index', () => {
    const result = validateResourceReference('${var.foo}', INDEX);
    expect(result).toEqual({ valid: false, notAReference: true });
  });
});

describe('validateResourceReference — foreign interpolation namespaces (T012, FR-014/019, Edge cases)', () => {
  it('APIGW variables, Terraform exprs, build ENV are NOT 009 references', () => {
    for (const foreign of ['${var.foo}', '${yandex_function.x.id}', '{{$ENV}}', '$${yandex_function.x.id}']) {
      const result = validateResourceReference(foreign, INDEX);
      expect(result.valid, foreign).toBe(false);
      if (!result.valid) {
        expect('notAReference' in result, foreign).toBe(true);
      }
    }
  });

  it('a prefix-less canonical ref is not a template reference (Edge cases §Точки неоднозначности №3)', () => {
    const result = validateResourceReference('functions.legacy_authorizer.id', INDEX);
    expect(result).toEqual({ valid: false, notAReference: true });
  });
});