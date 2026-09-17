import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/cli/pipeline.js', () => ({
  runBuildAndMaterialize: vi.fn(),
  runTerraformInit: vi.fn(),
  runTerraformPlan: vi.fn(),
  runTerraformApply: vi.fn(),
  runTerraformDestroy: vi.fn(),
}));

import { planAction } from '../../../src/cli/plan.js';
import { runBuildAndMaterialize, runTerraformInit, runTerraformPlan } from '../../../src/cli/pipeline.js';
import { ExitCode } from '../../../src/cli/errors.js';

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({ projectDir: '/root', json: true, ...opts }),
  } as never;
}

describe('ycsf plan action (T080)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.mocked(runTerraformPlan).mockResolvedValue('Plan: 0 to add.');
  });

  it('AC1: plan succeeds → exit 0, JSON with tfPlanOutput', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await planAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.command).toBe('plan');
    expect(json.summary?.tfPlanOutput).toBe('Plan: 0 to add.');
    spy.mockRestore();
  });

  it('AC2: build fails → exit 1, terraform NOT called', async () => {
    vi.mocked(runBuildAndMaterialize).mockRejectedValue(new Error('build failed'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await planAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Error);
    expect(runTerraformInit).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
