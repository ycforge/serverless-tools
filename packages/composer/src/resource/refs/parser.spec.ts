import { describe, expect, it } from 'vitest';

import { formatResourceReference, parseResourceReference } from './parser.js';

describe('parser — 002 re-export (T006, FR-005, SC-003)', () => {
  it('round-trips canonical references: format(parse(x)) === x', () => {
    const refs = [
      'functions.legacy_authorizer.id',
      'functions.internal_authorizer.id',
      'queues.events.qurl',
      'buckets.frontend.name',
      'containers.worker.id',
      'gateways.main.id',
    ];
    for (const ref of refs) {
      expect(formatResourceReference(parseResourceReference(ref))).toBe(ref);
    }
  });

  it('parses a reference into { domain, name, property }', () => {
    const parsed = parseResourceReference('queues.events.qurl');
    expect(parsed).toEqual({ domain: 'queues', name: 'events', property: 'qurl' });
  });

  it('rejects malformed refs with the 002 ContractError (hyphen, 2 segments, uppercase)', () => {
    for (const malformed of ['functions.internal-authorizer.id', 'functions.auth', 'Queues.events.qurl']) {
      expect(() => parseResourceReference(malformed)).toThrowError(
        expect.objectContaining({ name: 'ContractError', code: 'INVALID_RESOURCE_REFERENCE' }),
      );
    }
  });
});