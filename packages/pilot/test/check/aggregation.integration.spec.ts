import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { check } from '../../src/check/check.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('aggregation integration (T071)', () => {
  it('canonical fixture → 0 diagnostics', async () => {
    const result = await check(join(FIXTURES, 'canonical'));
    expect(result.diagnostics).toHaveLength(0);
  });

  it('missing-target fixture → diagnostics contains YCK_MISSING_TARGET + EXT_UNRESOLVED_TARGET', async () => {
    const result = await check(join(FIXTURES, 'missing-target'));
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('YCK_MISSING_TARGET');
    expect(codes).toContain('EXT_UNRESOLVED_TARGET');
  });
});
