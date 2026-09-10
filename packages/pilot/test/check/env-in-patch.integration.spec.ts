import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { YckDiagnostic } from '../../src/contracts/check.js';
import { YCK_ENV_IN_PATCH } from '../../src/contracts/check.js';
import { check } from '../../src/check/check.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('env-in-patch integration (T041)', () => {
  it('env-in-patch fixture → YCK_ENV_IN_PATCH with correct target and field', async () => {
    const result = await check(join(FIXTURES, 'env-in-patch'));
    const envDiags = result.diagnostics.filter((d) => d.code === YCK_ENV_IN_PATCH) as YckDiagnostic[];
    expect(envDiags).toHaveLength(1);
    expect(envDiags[0]?.target).toBe('functions.user_service');
    expect(envDiags[0]?.field).toBe('environment.API_KEY');
  });
});
