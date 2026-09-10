// spec 020 ycsf-check — YCK_* constants + diagnostic factory.
// Mirrors src/extensions/errors.ts `ext()` pattern: optional fields only set when
// defined — required for `exactOptionalPropertyTypes`.
import {
  YCK_ENV_IN_PATCH,
  YCK_MISSING_TARGET,
  YCK_REF_UNRESOLVED,
  YCK_TERRAFORM_INVALID,
  YCK_TERRAFORM_UNAVAILABLE,
  type YckDiagnostic,
} from '../contracts/check.js';

export { YCK_MISSING_TARGET, YCK_ENV_IN_PATCH, YCK_REF_UNRESOLVED, YCK_TERRAFORM_INVALID, YCK_TERRAFORM_UNAVAILABLE };

export interface YckOptions {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly resourceRef?: string;
  readonly field?: string;
  readonly file?: string;
  readonly availableIdls?: readonly string[];
}

export function yck(opts: YckOptions): YckDiagnostic {
  const diagnostic: {
    code: string;
    message: string;
    target?: string;
    resourceRef?: string;
    field?: string;
    file?: string;
    availableIdls?: readonly string[];
  } = { code: opts.code, message: opts.message };

  if (opts.target !== undefined) diagnostic.target = opts.target;
  if (opts.resourceRef !== undefined) diagnostic.resourceRef = opts.resourceRef;
  if (opts.field !== undefined) diagnostic.field = opts.field;
  if (opts.file !== undefined) diagnostic.file = opts.file;
  if (opts.availableIdls !== undefined) diagnostic.availableIdls = opts.availableIdls;

  return diagnostic as YckDiagnostic;
}
