import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { createBuildableProject, envWithMockTerraform, removeTempProject, type TempProject } from '../helpers/buildable-project.js';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');

function runCli(root: string, args: string[]) {
  return exec(process.execPath, [CLI, ...args], {
    cwd: root,
    env: envWithMockTerraform(),
    timeout: 20000,
  })
    .then((r: { stdout: string; stderr: string }) => ({ stdout: r.stdout, stderr: r.stderr, code: 0 }))
    .catch((err: { stdout: string; stderr: string; code?: number }) => ({
    stdout: err.stdout,
    stderr: err.stderr,
    code: err.code ?? 1,
  }));
}

describe('apply integration (T091)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('apply with mock terraform → full pipeline completes, exit 0', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['apply', '--project-dir', project.root]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Running terraform plan...');
    expect(result.stderr).toContain('Running terraform apply...');
    expect(result.stderr).toContain('Terraform apply complete');
  });

  it('T149: non-project dir → exit 2, CLI_MISSING_PROJECT_DIR', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['apply', '--project-dir', resolve(project.root, '..')]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('CLI_MISSING_PROJECT_DIR');
  });
});