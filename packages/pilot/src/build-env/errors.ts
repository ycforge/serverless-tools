/**
 * EnvUnresolvedError (spec 012, FR-015 / contracts/build-env.json
 * #/definitions/unresolvedDiagnostic): aggregates one or more
 * `PML_ENV_UNRESOLVED` diagnostics. `prepareBuildEnv` itself never throws for
 * an unresolved variable (research decision 7) — this type exists for callers
 * that want to aggregate/re-raise the removed errors.
 */

import {
  PML_ENV_UNRESOLVED,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';

export class EnvUnresolvedError extends Error {
  readonly code: 'PML_ENV_UNRESOLVED' = PML_ENV_UNRESOLVED;
  readonly diagnostics: readonly ProjectModelDiagnostic[];

  constructor(diagnostics: readonly ProjectModelDiagnostic[]) {
    super(diagnostics.map((d) => d.message).join('\n'));
    this.name = 'EnvUnresolvedError';
    this.diagnostics = diagnostics;
  }
}