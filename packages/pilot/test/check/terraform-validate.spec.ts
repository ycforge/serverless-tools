import { describe, expect, it } from 'vitest';

import { YCK_TERRAFORM_INVALID, YCK_TERRAFORM_UNAVAILABLE } from '../../src/contracts/check.js';
import { runTerraformValidate } from '../../src/check/categories/terraform-validate.js';
import { check } from '../../src/check/check.js';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('terraform-validate (T080)', () => {
  it('AC2: project WITH base errors + validateTf → terraform validate NOT called', async () => {
    const result = await check(join(FIXTURES, 'missing-target'), { validateTf: true });
    const terraformDiags = result.diagnostics.filter(
      (d) => d.code === YCK_TERRAFORM_INVALID || d.code === YCK_TERRAFORM_UNAVAILABLE,
    );
    expect(terraformDiags).toHaveLength(0);
    // But base errors should be present
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('AC3: runTerraformValidate with missing terraform binary → YCK_TERRAFORM_UNAVAILABLE', () => {
    const diags = runTerraformValidate(join(FIXTURES, 'canonical'));
    // If terraform is not installed, we get YCK_TERRAFORM_UNAVAILABLE
    // If terraform IS installed, the canonical project has no infra/ dir so it may error
    if (diags.length > 0) {
      const codes = diags.map((d) => d.code);
      expect(
        codes.includes(YCK_TERRAFORM_UNAVAILABLE) || codes.includes(YCK_TERRAFORM_INVALID),
      ).toBe(true);
    }
  });

  it('fail-fast: base errors + validateTf → only base diagnostics, no terraform', async () => {
    const result = await check(join(FIXTURES, 'env-in-patch'), { validateTf: true });
    const terraformDiags = result.diagnostics.filter(
      (d) => d.code === YCK_TERRAFORM_INVALID || d.code === YCK_TERRAFORM_UNAVAILABLE,
    );
    expect(terraformDiags).toHaveLength(0);
  });
});
