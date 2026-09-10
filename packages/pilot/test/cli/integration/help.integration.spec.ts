import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');
const CANONICAL = resolve(import.meta.dirname, '../../check/fixtures/canonical');

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

describe('help & version integration (T110)', () => {
  it('Sc10: --help lists all 6 commands', async () => {
    const result = await runCli(['--help']);
    expect(result.code).toBe(0);
    for (const cmd of ['build', 'materialize', 'check', 'plan', 'apply', 'destroy']) {
      expect(result.stdout).toContain(cmd);
    }
    expect(result.stdout).toContain('--project-dir');
    expect(result.stdout).toContain('--json');
  });

  it('Sc11: build --help shows build flags', async () => {
    const result = await runCli(['build', '--help']);
    expect(result.stdout).toContain('--target');
    expect(result.stdout).toContain('--project-dir');
  });

  it('Sc12: --version prints version string', async () => {
    const result = await runCli(['--version']);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('unknown command → exit 2', async () => {
    const result = await runCli(['frobnicate']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown command');
  });
});