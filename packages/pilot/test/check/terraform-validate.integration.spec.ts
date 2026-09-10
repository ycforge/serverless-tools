import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YCK_TERRAFORM_INVALID } from '../../src/contracts/check.js';

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as unknown as string;
  }
});

describe('terraform-validate integration (T081)', () => {
  it('mocked spawnSync with error → YCK_TERRAFORM_INVALID', async () => {
    tempDir = join(tmpdir(), 'pilot-check-tf-fail-');
    mkdirSync(join(tempDir, '.ycsf'), { recursive: true });
    writeFileSync(
      join(tempDir, '.ycsf', 'apps.yaml'),
      'version: 1\napps:\n  user_service:\n    source_path: src\n    builder: nodejs-builder\n',
      'utf8',
    );
    writeFileSync(
      join(tempDir, '.ycsf', 'outputs.yaml'),
      'version: 1\noutputs: {}\n',
      'utf8',
    );

    vi.doMock('node:child_process', () => ({
      spawnSync: () => ({
        status: 1,
        stdout: '',
        stderr: 'Error: Missing required argument',
        error: undefined,
      }),
    }));

    try {
      const { check: mockedCheck } = await import('../../src/check/check.js');
      const result = await mockedCheck(tempDir, { validateTf: true });
      const tfDiags = result.diagnostics.filter((d) => d.code === YCK_TERRAFORM_INVALID);
      expect(tfDiags).toHaveLength(1);
      expect(tfDiags[0]?.message).toContain('terraform validate failed');
    } finally {
      vi.doUnmock('node:child_process');
    }
  });
});
