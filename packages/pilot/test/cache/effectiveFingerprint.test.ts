import { describe, it, expect } from 'vitest';
import { computeEffectiveFingerprint } from '../../src/cache/fingerprint.js';
describe('effective', () => {
  it('transitive', () => {
    const a = 'a'.repeat(64);
    const bEff = computeEffectiveFingerprint('b'.repeat(64), [a]);
    const cEff = computeEffectiveFingerprint('c'.repeat(64), [bEff]);
    expect(cEff).not.toBe('c'.repeat(64));
  });
});
