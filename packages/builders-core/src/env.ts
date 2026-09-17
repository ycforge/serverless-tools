/**
 * D-3 env guard: residual `{{$...}}` scanning of buildConfig string leaves and
 * all buildEnv values. Builders never interpolate (FR-018); a residual
 * reference means the upstream (spec 012) interpolation contract was violated
 * → fail-fast `BLC_ENV_NOT_RESOLVED` (FR-019). The check is STRICT: ANY
 * residual `{{$...}}` is a violation, even when the referenced name is itself a
 * buildEnv key — after pilot's 012 pass there must be no `{{$` left anywhere
 * (Constitution V: explicit over magic). Other interpolation namespaces
 * (`${...}` Terraform, `${resources...}` B→Materializer) are untouched.
 */

export type EnvScanResult =
  | { clean: true }
  | { clean: false; hits: readonly string[] };

const RESIDUAL_RE = /\{\{\$([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

function referencedEnvNames(value: string): string[] {
  RESIDUAL_RE.lastIndex = 0;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = RESIDUAL_RE.exec(value)) !== null) {
    names.push(match[1]!);
  }
  return names;
}

/** A string leaf that still contains a `{{$...}}` reference (strict, FR-019). */
function isUnresolvedLeaf(value: string): boolean {
  return referencedEnvNames(value).length > 0;
}

function walkConfigLeaves(node: unknown, path: string, hits: string[]): void {
  if (typeof node === 'string') {
    if (isUnresolvedLeaf(node)) {
      hits.push(path);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkConfigLeaves(item, `${path}[${index}]`, hits));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walkConfigLeaves(value, `${path}.${key}`, hits);
    }
  }
}

export function scanBuildInput(
  buildConfig: unknown,
  buildEnv: Record<string, string>,
): EnvScanResult {
  const hits: string[] = [];

  if (buildConfig !== null && typeof buildConfig === 'object' && !Array.isArray(buildConfig)) {
    walkConfigLeaves(buildConfig, 'buildConfig', hits);
  }

  for (const [key, value] of Object.entries(buildEnv)) {
    if (isUnresolvedLeaf(value)) {
      hits.push(`buildEnv.${key}`);
    }
  }

  if (hits.length === 0) {
    return { clean: true };
  }
  return { clean: false, hits: [...new Set(hits)].sort() };
}