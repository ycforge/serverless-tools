/**
 * Shared build preflight (D-2/D-3): a valid build needs a resolvable
 * `sourcePath` (BLC_MISSING_SOURCE, DQ-2) and zero residual `{{$...}}`
 * references (BLC_ENV_NOT_RESOLVED, D-3). The env scan always runs BEFORE
 * any config validation or child process (US5-AC2 docker case).
 */

import { BLC_ENV_NOT_RESOLVED, BLC_MISSING_SOURCE, builderError, type BuilderErrorOptions } from './diagnostics.js';
import { scanBuildInput } from './env.js';
import type { BuildContext } from './types.js';

export function requireSourcePath(context: BuildContext, builderId: string): string {
  if (context.sourcePath === undefined) {
    throw builderError(
      BLC_MISSING_SOURCE,
      `builder '${builderId}' requires sourcePath, got none (${BLC_MISSING_SOURCE})`,
      { builder: builderId },
    );
  }
  return context.sourcePath;
}

export function assertNoResidualEnv(context: BuildContext, builderId: string): void {
  const scan = scanBuildInput(context.buildConfig, context.buildEnv);
  if (scan.clean) return;
  const fields = scan.hits.join(', ');
  const first = scan.hits[0];
  const options: BuilderErrorOptions =
    first === undefined ? { builder: builderId } : { builder: builderId, field: first };
  throw builderError(
    BLC_ENV_NOT_RESOLVED,
    `unresolved env references in ${fields} (${BLC_ENV_NOT_RESOLVED})`,
    options,
  );
}