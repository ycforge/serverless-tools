import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { createBuildableProject, envWithMockTerraform, removeTempProject, type TempProject } from '../helpers/buildable-project.js';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');
const CANONICAL = resolve(import.meta.dirname, '../../check/fixtures/canonical');

function runCli(root: string, args: string[], env: Record<string, string>) {
  const opts = {
    cwd: root,
    env,
    timeout: 20000,
    input: '',
  };
  return exec(process.execPath, [CLI, ...args], opts)
    .then((r: { stdout: string; stderr: string }) => ({ stdout: r.stdout, stderr: r.stderr, code: 0 }))
    .catch(
      (err: { stdout: string; stderr: string; code?: number }) => ({
        stdout: err.stdout,
        stderr: err.stderr,
        code: err.code ?? 1,
      }),
    );
}

describe('destroy integration (T101)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('Sc8: destroy without --yes in non-TTY → exit 2, CLI_DESTROY_REQUIRES_YES', async () => {
    const result = await runCli(CANONICAL, ['destroy', '--project-dir', CANONICAL], process.env as Record<string, string>);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('CLI_DESTROY_REQUIRES_YES');
  });

  it('Sc9: destroy --yes + mock terraform → exit 0, destroy output', async () => {
    project = createBuildableProject();
    const result = await runCli(
      project.root,
      ['destroy', '--project-dir', project.root, '--yes'],
      envWithMockTerraform(),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Running terraform destroy...');
    expect(result.stderr).toContain('Terraform destroy complete');
  });
});