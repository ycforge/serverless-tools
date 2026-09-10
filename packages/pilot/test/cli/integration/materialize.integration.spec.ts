import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createBuildableProject, removeTempProject, type TempProject } from '../helpers/buildable-project.js';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');
const CANONICAL = resolve(import.meta.dirname, '../../check/fixtures/canonical');

function runCli(cwd: string, args: string[]) {
  return exec('node', [CLI, ...args], {
    cwd,
    env: process.env as Record<string, string>,
    timeout: 15000,
  })
    .then((r: { stdout: string; stderr: string }) => ({ stdout: r.stdout, stderr: r.stderr, code: 0 }))
    .catch((err: { stdout: string; stderr: string; code?: number }) => ({
    stdout: err.stdout,
    stderr: err.stderr,
    code: err.code ?? 1,
  }));
}

describe('materialize integration (T061)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('materialize a project with a working registry → generates .tf.json files', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['materialize', '--project-dir', project.root]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Generated:');
    expect(existsSync(join(project.root, 'infra/user_service.ycsf.tf.json'))).toBe(true);
    expect(existsSync(join(project.root, 'infra/analytics.ycsf.tf.json'))).toBe(true);
  });

  it('--target unknown_app → exit 2, CLI_APP_NOT_FOUND', async () => {
    const result = await runCli(CANONICAL, ['materialize', '--project-dir', CANONICAL, '--target', 'unknown_app']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('CLI_APP_NOT_FOUND');
  });
});