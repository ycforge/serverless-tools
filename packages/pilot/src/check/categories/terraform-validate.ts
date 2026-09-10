// spec 020 ycsf-check — C13: optional terraform validate spawn.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { YCK_TERRAFORM_INVALID, YCK_TERRAFORM_UNAVAILABLE, type YckDiagnostic } from '../../contracts/check.js';
import { yck } from '../errors.js';

export function runTerraformValidate(rootDir: string): readonly YckDiagnostic[] {
  const infraDir = join(rootDir, 'infra');

  const result = spawnSync('terraform', ['validate', '-no-color'], {
    cwd: infraDir,
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return [
      yck({
        code: YCK_TERRAFORM_UNAVAILABLE,
        message: 'terraform binary not found in PATH (YCK_TERRAFORM_UNAVAILABLE)',
      }),
    ];
  }

  if (result.status !== 0) {
    const output = (result.stderr ?? result.stdout ?? '').trim();
    return [
      yck({
        code: YCK_TERRAFORM_INVALID,
        message: `terraform validate failed: ${output}`,
      }),
    ];
  }

  return [];
}
