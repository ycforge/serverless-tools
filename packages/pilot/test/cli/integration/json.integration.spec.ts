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

describe('--json output (T104)', () => {
  it('AC1: check --json emits pure JSON CLIResult', async () => {
    const result = await runCli(['check', '--project-dir', CANONICAL, '--json']);
    expect(result.stderr.trim()).toBe('');
    const json = JSON.parse(result.stdout);
    expect(json.command).toBe('check');
    expect(json.exitCode).toBe(0);
    expect(json.diagnostics).toEqual([]);
    expect(json.summary.total).toBe(0);
  });

  it('AC2: build --json on error → diagnostics with code+message', async () => {
    const result = await runCli(['build', '--project-dir', CANONICAL, '--target', 'nope', '--json']);
    const json = JSON.parse(result.stdout);
    expect(json.command).toBe('build');
    expect(json.exitCode).toBe(2);
    expect(json.diagnostics[0].code).toBe('CLI_APP_NOT_FOUND');
    expect(typeof json.diagnostics[0].message).toBe('string');
  });
});