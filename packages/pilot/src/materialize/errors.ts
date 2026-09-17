import type { DispatchDiagnostic } from '../contracts/index.js';

/**
 * MTL-diagnostic factory (mirrors `src/model/errors.ts` `diag`).
 * Optional fields are only set when defined — required for
 * `exactOptionalPropertyTypes`. Codes are matched via MTL_* constants.
 */
export interface MtlOptions {
  readonly code: string;
  readonly message: string;
  readonly artifactId?: string;
  readonly materializerIds?: string[];
  readonly materializerId?: string;
  readonly type?: string;
  readonly name?: string;
  readonly outputName?: string;
  readonly filename?: string;
}

export function mtl(opts: MtlOptions): DispatchDiagnostic {
  const diagnostic: {
    code: string;
    message: string;
    artifactId?: string;
    materializerIds?: string[];
    materializerId?: string;
    type?: string;
    name?: string;
    outputName?: string;
    filename?: string;
  } = { code: opts.code, message: opts.message };

  if (opts.artifactId !== undefined) diagnostic.artifactId = opts.artifactId;
  if (opts.materializerIds !== undefined) diagnostic.materializerIds = opts.materializerIds;
  if (opts.materializerId !== undefined) diagnostic.materializerId = opts.materializerId;
  if (opts.type !== undefined) diagnostic.type = opts.type;
  if (opts.name !== undefined) diagnostic.name = opts.name;
  if (opts.outputName !== undefined) diagnostic.outputName = opts.outputName;
  if (opts.filename !== undefined) diagnostic.filename = opts.filename;

  return diagnostic as DispatchDiagnostic;
}