import { describe, it, expect } from 'vitest';
import { computeOwnFingerprint } from '../../src/cache/fingerprint.js';
describe('builder version', () => {
  it('version changes fingerprint', () => {
    const f1 = computeOwnFingerprint({ filesHash: 'a'.repeat(64), buildConfig: {}, buildEnv: {}, builder: 'b@1.0.0' });
    const f2 = computeOwnFingerprint({ filesHash: 'a'.repeat(64), buildConfig: {}, buildEnv: {}, builder: 'b@1.1.0' });
    expect(f1).not.toBe(f2);
  });
});
