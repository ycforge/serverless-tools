/**
 * D-3 env guard: residual `{{$...}}` scanning of buildConfig string leaves and
 * all buildEnv values. Builders never interpolate (FR-018); a residual
 * reference means the upstream (spec 012) interpolation contract was violated
 * → fail-fast `BLC_ENV_NOT_RESOLVED` (FR-019). Other interpolation namespaces
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

/** A string leaf with a ref that is NOT satisfied by buildEnv keys. */
function isUnresolvedLeaf(value: string, envKeys: ReadonlySet<string>): boolean {
  const names = referencedEnvNames(value);
  return names.length > 0 && names.some((name) => !envKeys.has(name));
}

function walkConfigLeaves(node: unknown, path: string, envKeys: ReadonlySet<string>, hits: string[]): void {
  if (typeof node === 'string') {
    if (isUnresolvedLeaf(node, envKeys)) {
      hits.push(path);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkConfigLeaves(item, `${path}[${index}]`, envKeys, hits));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walkConfigLeaves(value, `${path}.${key}`, envKeys, hits);
    }
  }
}

export function scanBuildInput(
  buildConfig: unknown,
  buildEnv: Record<string, string>,
): EnvScanResult {
  const hits: string[] = [];
  const envKeys = new Set(Object.keys(buildEnv));

  if (buildConfig !== null && typeof buildConfig === 'object' && !Array.isArray(buildConfig)) {
    walkConfigLeaves(buildConfig, 'buildConfig', envKeys, hits);
  }

  for (const [key, value] of Object.entries(buildEnv)) {
    if (isUnresolvedLeaf(value, envKeys)) {
      hits.push(`buildEnv.${key}`);
    }
  }

  if (hits.length === 0) {
    return { clean: true };
  }
  return { clean: false, hits: [...new Set(hits)].sort() };
}