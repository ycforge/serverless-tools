// spec 015 extensions — diagnostic factory + shared model diag.
import type { ProjectModelDiagnostic } from '../contracts/index.js';
import type { ExtensionsDiagnostic } from '../contracts/index.js';

export { diag } from '../model/errors.js';

/**
 * EXT-diagnostic factory (mirrors `src/materialize/errors.ts` `mtl` and
 * `src/model/errors.ts` `diag`). Optional fields are only set when defined —
 * required for `exactOptionalPropertyTypes`. Codes are matched via EXT_*
 * constants.
 */
export interface ExtOptions {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly availableIdls?: readonly string[];
}

export function ext(opts: ExtOptions): ExtensionsDiagnostic {
  const diagnostic: {
    code: string;
    message: string;
    target?: string;
    availableIdls?: readonly string[];
  } = { code: opts.code, message: opts.message };

  if (opts.target !== undefined) diagnostic.target = opts.target;
  if (opts.availableIdls !== undefined) diagnostic.availableIdls = opts.availableIdls;

  return diagnostic as ExtensionsDiagnostic;
}

export type { ProjectModelDiagnostic };