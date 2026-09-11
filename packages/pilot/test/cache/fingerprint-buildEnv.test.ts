import { describe, it, expect } from 'vitest';
import { computeOwnFingerprint } from '../../src/cache/fingerprint.js';
describe('ownFingerprint buildEnv', () => {
  it('different buildEnv -> different fingerprint', () => {
    const fp1 = computeOwnFingerprint({ filesHash: 'a'.repeat(64), buildConfig: {}, buildEnv: { X: '1' }, builder: 'b@1' });
    const fp2 = computeOwnFingerprint({ filesHash: 'a'.repeat(64), buildConfig: {}, buildEnv: { X: '2' }, builder: 'b@1' });
    expect(fp1).not.toBe(fp2);
  });
});
