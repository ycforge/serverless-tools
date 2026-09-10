import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/cli/prompt.js', () => ({
  confirmDestroy: vi.fn(),
}));
vi.mock('../../../src/cli/pipeline.js', () => ({
  runTerraformInit: vi.fn(),
  runTerraformDestroy: vi.fn(),
}));

import { destroyAction } from '../../../src/cli/destroy.js';
import { confirmDestroy } from '../../../src/cli/prompt.js';
import { runTerraformDestroy } from '../../../src/cli/pipeline.js';
import { ExitCode, DestroyRequiresYesError } from '../../../src/cli/errors.js';

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({ projectDir: '/root', json: true, yes: false, cleanup: false, ...opts }),
  } as never;
}

describe('ycsf destroy action (T100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.mocked(runTerraformDestroy).mockResolvedValue('Destroy complete!');
  });

  it('AC1: destroy --yes → exit 0, terraform destroy called with autoApprove', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ yes: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    expect(runTerraformDestroy).toHaveBeenCalledWith('/root', true, true);
    spy.mockRestore();
  });

  it('AC3: non-TTY → exit 2', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    vi.mocked(confirmDestroy).mockRejectedValue(new DestroyRequiresYesError());
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ yes: false }));
    expect(process.exitCode).toBe(ExitCode.InputError);
    spy.mockRestore();
  });

  it('AC4: --cleanup → cleanup called after destroy', async () => {
    vi.mocked(confirmDestroy).mockResolvedValue(true);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ yes: true, cleanup: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.cleanedUp).toBe(true);
    spy.mockRestore();
  });
});
