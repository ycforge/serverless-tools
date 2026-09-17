import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { YckDiagnostic } from '../../src/contracts/check.js';
import { YCK_REF_UNRESOLVED } from '../../src/contracts/check.js';
import { check } from '../../src/check/check.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('resource-consistency integration (T061)', () => {
  it('unresolved-ref fixture → YCK_REF_UNRESOLVED with correct resourceRef', async () => {
    const result = await check(join(FIXTURES, 'unresolved-ref'));
    const unresolved = result.diagnostics.filter((d) => d.code === YCK_REF_UNRESOLVED) as YckDiagnostic[];
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.resourceRef).toBe('functions.external_svc');
    expect(unresolved[0]?.file).toBe('.ycsf/resources.yaml');
  });
});
