import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../src/check/index.js', () => ({
  check: vi.fn(),
}));

import { checkAction } from '../../../src/cli/check.js';
import { check } from '../../../src/check/index.js';
import { ExitCode } from '../../../src/cli/errors.js';

const mockCheck = vi.mocked(check);

let projectDir: string;
let nonProjectDir: string;

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({
      projectDir,
      json: false,
      ...opts,
    }),
  } as never;
}

describe('ycsf check CLI action (T070)', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pilot-check-ucli-'));
    mkdirSync(join(projectDir, '.ycsf'), { recursive: true });
    writeFileSync(join(projectDir, '.ycsf', 'apps.yaml'), 'version: 1\napps: []\n');
    nonProjectDir = mkdtempSync(join(tmpdir(), 'pilot-check-nonproj-'));
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(nonProjectDir, { recursive: true, force: true });
  });

  it('AC1: check clean → exit 0, stdout "All checks passed."', async () => {
    mockCheck.mockResolvedValue({ diagnostics: [] });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
    await checkAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Success);
    expect(spy).toHaveBeenCalledWith('All checks passed.\n');
    spy.mockRestore();
  });

  it('AC2: check with errors → exit 1, formatted diagnostics', async () => {
    mockCheck.mockResolvedValue({
      diagnostics: [
        { code: 'YCK_MISSING_TARGET', message: 'target not found', target: 'foo' },
      ],
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
    await checkAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Error);
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('YCK_MISSING_TARGET');
    spy.mockRestore();
  });

  it('AC3: --validate-tf → check called with validateTf:true', async () => {
    mockCheck.mockResolvedValue({ diagnostics: [] });
    await checkAction(fakeCmd({ validateTf: true }));
    expect(mockCheck).toHaveBeenCalledWith(projectDir, { validateTf: true });
  });

  it('AC4: base errors + --validate-tf → exit 1, only base diagnostics (no terraform token)', async () => {
    mockCheck.mockResolvedValue({
      diagnostics: [
        { code: 'PML_ENV_NOT_SET', message: 'env not set', file: '.ycsf/apps.yaml' },
      ],
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await checkAction(fakeCmd({ validateTf: true }));
    expect(process.exitCode).toBe(ExitCode.Error);
    expect(mockCheck).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('PML_ENV_NOT_SET');
    expect(output).not.toContain('terraform');
    spy.mockRestore();
  });

  it('AC5: --json → valid JSON output', async () => {
    mockCheck.mockResolvedValue({ diagnostics: [] });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await checkAction(fakeCmd({ json: true }));
    expect(spy).toHaveBeenCalled();
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.command).toBe('check');
    expect(json.exitCode).toBe(0);
    expect(json.diagnostics).toEqual([]);
    spy.mockRestore();
  });

  it('T148: missing .ycsf/apps.yaml → exit 2, CLI_MISSING_PROJECT_DIR, check not called', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await checkAction(fakeCmd({ projectDir: nonProjectDir }));
    expect(process.exitCode).toBe(ExitCode.InputError);
    expect(mockCheck).not.toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('CLI_MISSING_PROJECT_DIR');
    spy.mockRestore();
  });

  it('T148: --json on missing .ycsf/apps.yaml → exit 2 JSON diagnostic', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await checkAction(fakeCmd({ projectDir: nonProjectDir, json: true }));
    expect(process.exitCode).toBe(ExitCode.InputError);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.exitCode).toBe(2);
    expect(json.diagnostics[0].code).toBe('CLI_MISSING_PROJECT_DIR');
    spy.mockRestore();
  });
});