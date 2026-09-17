import { describe, it, expect } from 'vitest';
import type { BuildAppsOptions } from '../../src/contracts/build.js';
describe('BuildAppsOptions', () => {
  it('shape', () => {
    const opts: BuildAppsOptions = { noCache: false, cacheDir: '/tmp/x', onCacheProgress: () => {}, target: 'a' };
    expect(opts.noCache).toBe(false);
  });
});
