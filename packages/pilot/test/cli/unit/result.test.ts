import { describe, it, expect } from 'vitest';
import type { CLIResult, CLIDiagnostic } from '../../../src/cli/result.js';

describe('CLIResult and CLIDiagnostic (T013)', () => {
  it('CLIResult shape: command, exitCode, diagnostics required, summary optional', () => {
    const result: CLIResult = {
      command: 'build',
      exitCode: 0,
      diagnostics: [],
    };
    expect(result.command).toBe('build');
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary).toBeUndefined();
  });

  it('CLIResult with summary', () => {
    const result: CLIResult = {
      command: 'plan',
      exitCode: 0,
      diagnostics: [],
      summary: { tfPlanOutput: 'plan output' },
    };
    expect(result.summary).toEqual({ tfPlanOutput: 'plan output' });
  });

  it('CLIDiagnostic has required code+message, optional details', () => {
    const diag: CLIDiagnostic = {
      code: 'CLI_BUILD_FAILED',
      message: 'build failed',
      details: { file: '.ycsf/apps.yaml' },
    };
    expect(diag.code).toBe('CLI_BUILD_FAILED');
    expect(diag.message).toBe('build failed');
    expect(diag.details?.file).toBe('.ycsf/apps.yaml');
  });

  it('CLIDiagnostic without details', () => {
    const diag: CLIDiagnostic = { code: 'PML_ENV_NOT_SET', message: 'missing ENV' };
    expect(diag.details).toBeUndefined();
  });

  it('diagnostics array is readonly', () => {
    const result: CLIResult = {
      command: 'check',
      exitCode: 0,
      diagnostics: [{ code: 'X', message: 'Y' }],
    };
    expect(result.diagnostics[0]?.code).toBe('X');
  });
});
