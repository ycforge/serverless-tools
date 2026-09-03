import { describe, expect, it } from 'vitest';

import {
  formatResourceReference,
  parseResourceReference,
} from '../../src/contracts/index.js';

// SC-004: 100% of canonical examples from IDEA.md §15 pass with lossless
// round-trip.

const CANONICAL_IDEA_15 = [
  'functions.user_service.id',
  'containers.analytics.id',
  'queues.events.qurl',
  'buckets.frontend.name',
] as const;

describe('SC-004: canonical examples from IDEA.md §15', () => {
  it.each(CANONICAL_IDEA_15.map((r) => [r] as const))('%s parses and round-trips', (ref) => {
    const parsed = parseResourceReference(ref);
    expect(formatResourceReference(parsed)).toBe(ref);
  });

  it('covers all four canonical examples', () => {
    expect(CANONICAL_IDEA_15).toHaveLength(4);
    for (const ref of CANONICAL_IDEA_15) {
      expect(() => parseResourceReference(ref)).not.toThrow();
    }
  });
});
