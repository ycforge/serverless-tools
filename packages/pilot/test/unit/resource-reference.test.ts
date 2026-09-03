import { describe, expect, it } from 'vitest';

import {
  ContractError,
  Diagnostics,
  formatResourceReference,
  parseResourceReference,
} from '../../src/contracts/index.js';

// FR-010..FR-012: ResourceReference parser/formatter. Canonical grammar:
// exactly three segments `domain.name.property`, segment = [a-z][a-z0-9_]*.
// Round-trip is lossless; invalid input throws ContractError — never
// undefined (Constitution V).

const VALID = [
  { ref: 'functions.user_service.id', domain: 'functions', name: 'user_service', property: 'id' },
  { ref: 'containers.analytics.id', domain: 'containers', name: 'analytics', property: 'id' },
  { ref: 'queues.events.qurl', domain: 'queues', name: 'events', property: 'qurl' },
  { ref: 'buckets.frontend.name', domain: 'buckets', name: 'frontend', property: 'name' },
] as const;

const INVALID = [
  'functions.user_service', // two-segment IDL form is NOT a ResourceReference (clarify 2026-09-03)
  'functions..id',
  'Functions.user_service.id',
  'functions.user-service.id', // hyphen not allowed in segments
  'functions.user_service.id.extra',
  '',
  'a.b',
  'a.b.c.d',
] as const;

describe('parseResourceReference (FR-011, FR-012)', () => {
  it.each(VALID.map((v) => [v.ref, v] as const))('parses %s into domain/name/property', (ref, expected) => {
    expect(parseResourceReference(ref)).toEqual({
      domain: expected.domain,
      name: expected.name,
      property: expected.property,
    });
  });

  it.each(INVALID.map((r) => [r] as const))('rejects %j with a typed ContractError', (ref) => {
    let caught: unknown;
    try {
      parseResourceReference(ref);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContractError);
    expect((caught as ContractError).code).toBe(Diagnostics.InvalidResourceReference);
    expect((caught as ContractError).message.length).toBeGreaterThan(0);
    expect((caught as ContractError).message).toContain(ref);
  });

  it('never degrades silently: always throws, never returns undefined', () => {
    for (const ref of INVALID) {
      expect(() => parseResourceReference(ref)).toThrow(ContractError);
    }
  });
});

describe('formatResourceReference (round-trip)', () => {
  it.each(VALID.map((v) => [v.ref] as const))('round-trips %s without loss', (ref) => {
    expect(formatResourceReference(parseResourceReference(ref))).toBe(ref);
  });

  it('is the inverse of parse for every canonical example', () => {
    for (const { ref } of VALID) {
      const parsed = parseResourceReference(ref);
      expect(formatResourceReference(parsed)).toBe(ref);
    }
  });
});
