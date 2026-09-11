// spec 021 ycsf-cli — CLIError hierarchy + CLI_* constants + ExitCode enum.
// Codes compared via these constants, never string literals (Constitution V).

export const CLI_UNKNOWN_COMMAND = 'CLI_UNKNOWN_COMMAND' as const;
export const CLI_MISSING_PROJECT_DIR = 'CLI_MISSING_PROJECT_DIR' as const;
export const CLI_APP_NOT_FOUND = 'CLI_APP_NOT_FOUND' as const;
export const CLI_BUILD_FAILED = 'CLI_BUILD_FAILED' as const;
export const CLI_TERRAFORM_FAILED = 'CLI_TERRAFORM_FAILED' as const;
export const CLI_TERRAFORM_NOT_FOUND = 'CLI_TERRAFORM_NOT_FOUND' as const;
export const CLI_DESTROY_REQUIRES_YES = 'CLI_DESTROY_REQUIRES_YES' as const;
export const CLI_UNEXPECTED_ERROR = 'CLI_UNEXPECTED_ERROR' as const;

export const CACHE_CORRUPTED = 'CACHE_CORRUPTED' as const;
export const CACHE_BLOB_MISSING = 'CACHE_BLOB_MISSING' as const;
export const CACHE_WRITE_FAILED = 'CACHE_WRITE_FAILED' as const;
export const CACHE_VERSION_MISMATCH = 'CACHE_VERSION_MISMATCH' as const;

export enum ExitCode {
  Success = 0,
  Error = 1,
  InputError = 2,
}

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: 1 | 2,
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

export class InputError extends CLIError {
  constructor(message: string, code: string) {
    super(message, code, 2);
    this.name = 'InputError';
  }
}

export class RuntimeError extends CLIError {
  constructor(message: string, code: string) {
    super(message, code, 1);
    this.name = 'RuntimeError';
  }
}

export class DestroyRequiresYesError extends InputError {
  constructor() {
    super(
      'destroy requires --yes flag in non-interactive mode (CLI_DESTROY_REQUIRES_YES)',
      CLI_DESTROY_REQUIRES_YES,
    );
    this.name = 'DestroyRequiresYesError';
  }
}
