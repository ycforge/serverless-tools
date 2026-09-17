export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

export class CompileError extends CLIError {
  constructor(message: string, code: string, exitCode: 1 | 2 | 3 = 1) {
    super(message, code, exitCode);
    this.name = 'CompileError';
  }
}

export class CheckError extends CLIError {
  constructor(message: string, code: string, exitCode: 1 | 2 = 1) {
    super(message, code, exitCode);
    this.name = 'CheckError';
  }
}

export class InputError extends CLIError {
  constructor(message: string, code: string) {
    super(message, code, 2);
    this.name = 'InputError';
  }
}

export class IOError extends CLIError {
  constructor(message: string, code: string) {
    super(message, code, 3);
    this.name = 'IOError';
  }
}