import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { YckDiagnostic } from '../../src/contracts/check.js';
import { YCK_MISSING_TARGET } from '../../src/contracts/check.js';
import { check } from '../../src/check/check.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('override-targets integration (T031)', () => {
  it('missing-target fixture → YCK_MISSING_TARGET with correct target and availableIdls', async () => {
    const result = await check(join(FIXTURES, 'missing-target'));
    const missing = result.diagnostics.filter((d) => d.code === YCK_MISSING_TARGET) as YckDiagnostic[];
    expect(missing).toHaveLength(1);
    expect(missing[0]?.target).toBe('functions.user_service');
    expect(missing[0]?.availableIdls).toEqual(['functions.analytics']);
  });

  it('canonical fixture → 0 YCK_MISSING_TARGET', async () => {
    const result = await check(join(FIXTURES, 'canonical'));
    const missing = result.diagnostics.filter((d) => d.code === YCK_MISSING_TARGET);
    expect(missing).toHaveLength(0);
  });
});
