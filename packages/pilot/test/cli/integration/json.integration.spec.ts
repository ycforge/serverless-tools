import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { createBuildableProject, envWithMockTerraform, removeTempProject, type TempProject } from '../helpers/buildable-project.js';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');
const CANONICAL = resolve(import.meta.dirname, '../../check/fixtures/canonical');

function runCli(root: string, args: string[], env?: Record<string, string>) {
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

describe('--json output (T104)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('AC1: check --json emits pure JSON CLIResult', async () => {
    const result = await runCli(CANONICAL, ['check', '--project-dir', CANONICAL, '--json']);
    expect(result.stderr.trim()).toBe('');
    const json = JSON.parse(result.stdout);
    expect(json.command).toBe('check');
    expect(json.exitCode).toBe(0);
    expect(json.diagnostics).toEqual([]);
    expect(json.summary.total).toBe(0);
  });

  it('AC2: build --json on error → diagnostics with code+message', async () => {
    const result = await runCli(CANONICAL, ['build', '--project-dir', CANONICAL, '--target', 'nope', '--json']);
    const json = JSON.parse(result.stdout);
    expect(json.command).toBe('build');
    expect(json.exitCode).toBe(2);
    expect(json.diagnostics[0].code).toBe('CLI_APP_NOT_FOUND');
    expect(typeof json.diagnostics[0].message).toBe('string');
  });

  it('AC3: plan --json + mock terraform → stdout is pure JSON, tfPlanOutput has plan stdout', async () => {
    project = createBuildableProject();
    const result = await runCli(
      project.root,
      ['plan', '--project-dir', project.root, '--json'],
      envWithMockTerraform(),
    );
    // The whole stdout must decode as a single JSON document (FR-005): a mixed
    // JSON + progress stream would make JSON.parse throw.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const json = JSON.parse(result.stdout) as {
      command: string;
      exitCode: number;
      summary?: { tfPlanOutput?: string };
    };
    expect(json.command).toBe('plan');
    expect(json.exitCode).toBe(0);
    expect(json.summary?.tfPlanOutput).toContain('Terraform plan');
    // progress messages stay out of stdout in JSON mode
    expect(result.stdout).not.toContain('Building apps');
    expect(result.stderr).not.toContain('✓ Build + materialize complete.');
  });
});