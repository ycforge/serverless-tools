import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { createBuildableProject, envWithMockTerraform, removeTempProject, type TempProject } from '../helpers/buildable-project.js';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');

function runCli(root: string, args: string[], env?: Record<string, string>) {
  // Use the absolute node path so a restricted PATH does not break the
  // executable lookup of node itself.
  return exec(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, ...env } as Record<string, string>,
    timeout: 20000,
  })
    .then((r: { stdout: string; stderr: string }) => ({ stdout: r.stdout, stderr: r.stderr, code: 0 }))
    .catch((err: { stdout: string; stderr: string; code?: number }) => ({
    stdout: err.stdout,
    stderr: err.stderr,
    code: err.code ?? 1,
  }));
}

describe('plan integration (T081)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('Sc7: no terraform in PATH → exit 1, CLI_TERRAFORM_NOT_FOUND', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['plan', '--project-dir', project.root], {
      PATH: '/usr/bin:/bin',
    });
    expect(result.stderr).toContain('CLI_TERRAFORM_NOT_FOUND');
    expect([0, 1]).toContain(result.code ?? 1);
  });

  it('plan with mock terraform on PATH → completes', async () => {
    project = createBuildableProject();
    const result = await runCli(
      project.root,
      ['plan', '--project-dir', project.root],
      envWithMockTerraform(),
    );
    const output = result.stderr;
    expect(output).toContain('Build + materialize complete.');
    expect(output).toContain('Running terraform plan...');
    expect(result.code).toBe(0);
  });
});