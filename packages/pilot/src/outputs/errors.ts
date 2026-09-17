// spec 016 outputs — diagnostic factory for the pure build phase.
import type { OutputsDiagnostic } from '../contracts/index.js';

/**
 * OUT-diagnostic factory (mirrors `src/materialize/errors.ts` `mtl`,
 * `src/extensions/errors.ts` `ext` and `src/model/errors.ts` `diag`).
 * Optional fields are only set when defined — required for
 * `exactOptionalPropertyTypes`. `file`/`line`/`column` are NOT populated by
 * the pure build phase (loader fills them, pattern 015). Codes are matched
 * via OUT_* constants.
 */
export interface OutOptions {
  readonly code: string;
  readonly message: string;
  readonly name?: string;
  readonly file?: string;
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
  readonly availableIdls?: readonly string[];
}

export function out(opts: OutOptions): OutputsDiagnostic {
  const diagnostic: {
    code: string;
    message: string;
    name?: string;
    file?: string;
    field?: string;
    line?: number;
    column?: number;
    availableIdls?: readonly string[];
  } = { code: opts.code, message: opts.message };

  if (opts.name !== undefined) diagnostic.name = opts.name;
  if (opts.file !== undefined) diagnostic.file = opts.file;
  if (opts.field !== undefined) diagnostic.field = opts.field;
  if (opts.line !== undefined) diagnostic.line = opts.line;
  if (opts.column !== undefined) diagnostic.column = opts.column;
  if (opts.availableIdls !== undefined) diagnostic.availableIdls = opts.availableIdls;

  return diagnostic as OutputsDiagnostic;
}