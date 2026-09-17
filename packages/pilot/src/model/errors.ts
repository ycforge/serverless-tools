import type { ProjectModelDiagnostic } from '../contracts/index.js';

/**
 * Model-layer diagnostic factory. Carries FR-015 fields
 * (code/message/file + optional app/identity/field/line/column).
 */
export interface DiagnosticOptions {
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly app?: string;
  readonly identity?: string;
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
}

export function diag(opts: DiagnosticOptions): ProjectModelDiagnostic {
  const diagnostic: {
    code: string;
    message: string;
    file: string;
    app?: string;
    identity?: string;
    field?: string;
    line?: number;
    column?: number;
  } = { code: opts.code, message: opts.message, file: opts.file };
  if (opts.app !== undefined) diagnostic.app = opts.app;
  if (opts.identity !== undefined) diagnostic.identity = opts.identity;
  if (opts.field !== undefined) diagnostic.field = opts.field;
  if (opts.line !== undefined) diagnostic.line = opts.line;
  if (opts.column !== undefined) diagnostic.column = opts.column;
  return diagnostic as ProjectModelDiagnostic;
}