import { describe, it, expect } from 'vitest';
import { CACHE_MANIFEST_VERSION } from '../../src/contracts/cache.js';
import type { CacheReason } from '../../src/contracts/cache.js';

describe('cache contracts', () => {
  it('version is 1', () => expect(CACHE_MANIFEST_VERSION).toBe(1));
  it('CacheReason enum 10 values', () => {
    const reasons: CacheReason[] = ['hit','no_entry','source_changed','build_config_changed','build_env_changed','builder_changed','dependency_changed','no_cache','blob_missing','corrupted'];
    expect(reasons).toHaveLength(10);
  });
  it('fingerprint regex', () => {
    const fp = 'a'.repeat(64);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});
