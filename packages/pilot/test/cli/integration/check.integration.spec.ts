import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');
const CANONICAL = resolve(import.meta.dirname, '../../check/fixtures/canonical');
const MISSING_TARGET = resolve(import.meta.dirname, '../../check/fixtures/missing-target');

function runCli(args: string[]) {
  return exec('node', [CLI, ...args], {
    cwd: CANONICAL,
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

describe('check integration (T071)', () => {
  it('Sc3: canonical → exit 0, "All checks passed."', async () => {
    const result = await runCli(['check', '--project-dir', CANONICAL]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('All checks passed');
  });

  it('Sc4: missing-target → exit 1, YCK_MISSING_TARGET', async () => {
    const result = await runCli(['check', '--project-dir', MISSING_TARGET]);
    expect(result.code).toBe(1);
    expect(result.stderr + result.stdout).toContain('YCK_MISSING_TARGET');
  });

  it('Sc5: --json flag → valid JSON stdout', async () => {
    const result = await runCli(['check', '--project-dir', CANONICAL, '--json']);
    const json = JSON.parse(result.stdout);
    expect(json.command).toBe('check');
    expect(json.exitCode).toBe(0);
    expect(Array.isArray(json.diagnostics)).toBe(true);
  });
});