import { describe, it, expect } from 'vitest';
import { CACHE_CORRUPTED, CACHE_BLOB_MISSING, CACHE_WRITE_FAILED, CACHE_VERSION_MISMATCH } from '../../src/cli/errors.js';
describe('CACHE constants', () => {
  it('4 constants', () => {
    expect(CACHE_CORRUPTED).toBe('CACHE_CORRUPTED');
    expect(CACHE_BLOB_MISSING).toBe('CACHE_BLOB_MISSING');
    expect(CACHE_WRITE_FAILED).toBe('CACHE_WRITE_FAILED');
    expect(CACHE_VERSION_MISMATCH).toBe('CACHE_VERSION_MISMATCH');
  });
});
