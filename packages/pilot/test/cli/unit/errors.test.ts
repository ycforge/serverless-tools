import { describe, it, expect } from 'vitest';
import {
  CLIError,
  InputError,
  RuntimeError,
  DestroyRequiresYesError,
  ExitCode,
  CLI_UNKNOWN_COMMAND,
  CLI_MISSING_PROJECT_DIR,
  CLI_APP_NOT_FOUND,
  CLI_BUILD_FAILED,
  CLI_TERRAFORM_FAILED,
  CLI_TERRAFORM_NOT_FOUND,
  CLI_DESTROY_REQUIRES_YES,
  CLI_UNEXPECTED_ERROR,
} from '../../../src/cli/errors.js';

describe('CLI errors (T011)', () => {
  it('InputError has exitCode 2', () => {
    const err = new InputError('test', CLI_MISSING_PROJECT_DIR);
    expect(err.exitCode).toBe(2);
    expect(err.code).toBe(CLI_MISSING_PROJECT_DIR);
    expect(err).toBeInstanceOf(CLIError);
  });

  it('RuntimeError has exitCode 1', () => {
    const err = new RuntimeError('test', CLI_BUILD_FAILED);
    expect(err.exitCode).toBe(1);
    expect(err.code).toBe(CLI_BUILD_FAILED);
  });

  it('DestroyRequiresYesError has exitCode 2 and CLI_DESTROY_REQUIRES_YES', () => {
    const err = new DestroyRequiresYesError();
    expect(err.exitCode).toBe(2);
    expect(err.code).toBe(CLI_DESTROY_REQUIRES_YES);
    expect(err).toBeInstanceOf(InputError);
  });

  it('CLIError base has correct exitCode', () => {
    const err = new CLIError('msg', CLI_TERRAFORM_FAILED, 1);
    expect(err.exitCode).toBe(1);
    expect(err.code).toBe(CLI_TERRAFORM_FAILED);
  });

  it('all 8 CLI_* constants are exported', () => {
    expect(CLI_UNKNOWN_COMMAND).toBe('CLI_UNKNOWN_COMMAND');
    expect(CLI_MISSING_PROJECT_DIR).toBe('CLI_MISSING_PROJECT_DIR');
    expect(CLI_APP_NOT_FOUND).toBe('CLI_APP_NOT_FOUND');
    expect(CLI_BUILD_FAILED).toBe('CLI_BUILD_FAILED');
    expect(CLI_TERRAFORM_FAILED).toBe('CLI_TERRAFORM_FAILED');
    expect(CLI_TERRAFORM_NOT_FOUND).toBe('CLI_TERRAFORM_NOT_FOUND');
    expect(CLI_DESTROY_REQUIRES_YES).toBe('CLI_DESTROY_REQUIRES_YES');
    expect(CLI_UNEXPECTED_ERROR).toBe('CLI_UNEXPECTED_ERROR');
  });

  it('ExitCode enum values', () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.Error).toBe(1);
    expect(ExitCode.InputError).toBe(2);
  });
});
