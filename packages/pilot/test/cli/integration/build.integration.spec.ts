import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

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

describe('build integration (T051)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('Sc1: build a project with a working builders registry → exit 0', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['build', '--project-dir', project.root]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Building app user_service...');
    expect(result.stderr).toContain('Building app analytics...');
    expect(result.stderr).toContain('✓ Build complete.');
  });

  it('Sc3: build --json → per-app progress suppressed, stdout is pure JSON', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['build', '--project-dir', project.root, '--json']);
    expect(result.stderr).not.toContain('Building app');
    expect(result.stderr).not.toContain('Build complete');
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const json = JSON.parse(result.stdout) as { command: string; exitCode: number };
    expect(json.command).toBe('build');
    expect(json.exitCode).toBe(0);
  });

  it('Sc2: --target unknown_app → exit 2, CLI_APP_NOT_FOUND', async () => {
    const result = await runCli(CANONICAL, ['build', '--project-dir', CANONICAL, '--target', 'unknown_app']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('CLI_APP_NOT_FOUND');
  });
});