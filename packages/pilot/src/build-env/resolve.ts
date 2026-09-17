/**
 * build_env resolution (spec 012, US-2/FR-004/005/002/006, research
 * decision 3): each ENV_NAME → string | null entry resolved in declaration
 * order into an effective `Record<string,string>` (no null, no `{{$…}}`):
 * - `null` → `envSnapshot[ENV_NAME]` (empty/unset → `PML_ENV_UNRESOLVED`);
 * - literal (no `{{$…}}`) → as-is (FR-005, no requirement);
 * - interpolated → substitute via `interpolateString` (FR-002).
 */

import { PML_ENV_UNRESOLVED, type ProjectModelDiagnostic } from '../contracts/index.js';
import { diag } from '../model/errors.js';
import { interpolateString, type InterpolateContext } from './interpolate.js';

/** Result of resolving one `build_env` map: string-only env + diagnostics. */
export interface ResolvedBuildEnv {
  readonly resolvedEnv: Record<string, string>;
  readonly errors: readonly ProjectModelDiagnostic[];
  /** Env names that could not be resolved (deduplicated). */
  readonly unresolved: readonly string[];
}

export function resolveBuildEnv(
  buildEnv: Record<string, string | null>,
  context: InterpolateContext,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedBuildEnv {
  const resolvedEnv: Record<string, string> = {};
  const errors: ProjectModelDiagnostic[] = [];
  const unresolved = new Set<string>();

  for (const [name, value] of Object.entries(buildEnv)) {
    if (value === null) {
      const resolved = env[name];
      if (resolved === undefined || resolved === '') {
        unresolved.add(name);
        errors.push(
          diag({
            code: PML_ENV_UNRESOLVED,
            message: `ENV '${name}' is unresolved (${name} for app '${context.appId}')`,
            file: context.file,
            app: context.appId,
            field: name,
          }),
        );
      } else {
        resolvedEnv[name] = resolved;
      }
      continue;
    }
    const result = interpolateString(value, context, name, env);
    errors.push(...result.errors);
    for (const ref of result.unresolved) unresolved.add(ref);
    resolvedEnv[name] = result.value;
  }

  return { resolvedEnv, errors, unresolved: [...unresolved] };
}