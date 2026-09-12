import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { check } from '../../src/check/check.js';
import type { YckDiagnostic } from '../../src/contracts/check.js';

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

  it('suspicious-keys fixture → YCK_SUSPICIOUS_KEY for apps.yaml and build_config.yaml (SC-005/SC-006)', async () => {
    const result = await check(join(FIXTURES, 'suspicious-keys'));
    const suspicious = result.diagnostics.filter(
      (d): d is YckDiagnostic => d.code === 'YCK_SUSPICIOUS_KEY',
    );
    expect(suspicious.length).toBeGreaterThanOrEqual(2);

    const byKey = new Map(suspicious.map((d) => [`${d.file}:${d.field}`, d]));
    const appsHit = byKey.get('.ycsf/apps.yaml:api_key');
    expect(appsHit).toBeDefined();
    expect(appsHit?.key).toBe('api_key');
    expect(appsHit?.reason).toBe('exact-match:apikey');

    const buildHit = byKey.get('user_service/build_config.yaml:build_config.DB_TOKEN');
    expect(buildHit).toBeDefined();
    expect(buildHit?.key).toBe('DB_TOKEN');
    expect(buildHit?.reason).toBe('suffix-match:token');
  });
});
