import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PML_ENV_NOT_SET } from '../../src/contracts/index.js';
import { check } from '../../src/check/check.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('build-env integration (T051)', () => {
  it('canonical fixture without missing ENV → 0 PML_ENV_NOT_SET', async () => {
    const result = await check(join(FIXTURES, 'canonical'));
    const envErrors = result.diagnostics.filter((d) => d.code === PML_ENV_NOT_SET);
    expect(envErrors).toHaveLength(0);
  });
});
