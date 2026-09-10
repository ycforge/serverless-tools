import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/check/index.js', () => ({
  check: vi.fn(),
}));

import { checkAction } from '../../../src/cli/check.js';
import { check } from '../../../src/check/index.js';
import { ExitCode } from '../../../src/cli/errors.js';

const mockCheck = vi.mocked(check);

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({
      projectDir: '/test/root',
      json: false,
      ...opts,
    }),
  } as never;
}

describe('ycsf check CLI action (T070)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
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
    expect(mockCheck).toHaveBeenCalledWith('/test/root', { validateTf: true });
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
});
