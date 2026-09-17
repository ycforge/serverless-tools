import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/cli/pipeline.js', () => ({
  runBuildAndMaterialize: vi.fn(),
  runTerraformInit: vi.fn(),
  runTerraformPlan: vi.fn(),
  runTerraformApply: vi.fn(),
}));

import { applyAction } from '../../../src/cli/apply.js';
import { runBuildAndMaterialize, runTerraformInit, runTerraformPlan, runTerraformApply } from '../../../src/cli/pipeline.js';
import { ExitCode } from '../../../src/cli/errors.js';

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({ projectDir: '/root', json: true, ...opts }),
  } as never;
}

describe('ycsf apply action (T090)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.mocked(runTerraformApply).mockResolvedValue('Apply complete!');
  });

  it('AC1: apply succeeds → exit 0, JSON with tfApplyOutput', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await applyAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.tfApplyOutput).toBe('Apply complete!');
    spy.mockRestore();
  });

  it('AC2: build fails → terraform NOT called', async () => {
    vi.mocked(runBuildAndMaterialize).mockRejectedValue(new Error('build failed'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await applyAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Error);
    expect(runTerraformApply).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('AC3: pipeline order: build → init → plan → apply', async () => {
    const calls: string[] = [];
    vi.mocked(runBuildAndMaterialize).mockImplementation(async () => { calls.push('build'); });
    vi.mocked(runTerraformInit).mockImplementation(async () => { calls.push('init'); });
    vi.mocked(runTerraformPlan).mockImplementation(async () => { calls.push('plan'); return ''; });
    vi.mocked(runTerraformApply).mockImplementation(async () => { calls.push('apply'); return ''; });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await applyAction(fakeCmd());
    expect(calls).toEqual(['build', 'init', 'plan', 'apply']);
    spy.mockRestore();
  });
});
