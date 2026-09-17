// spec 020 ycsf-check — C7: deep-scan extension patch for {{$ENV}} references.
import type { ExtensionsYaml } from '../../contracts/index.js';
import { YCK_ENV_IN_PATCH, type YckDiagnostic } from '../../contracts/check.js';
import { yck } from '../errors.js';

const ENV_REF_RE = /\{\{\$([A-Z0-9_]+)\}\}/;
const ENV_MARKER = '{{$ENV}}';

export function scanPatchForEnvRefs(extensions: ExtensionsYaml): readonly YckDiagnostic[] {
  const diagnostics: YckDiagnostic[] = [];

  for (const rule of extensions.extensions) {
    scanObject(rule.patch, rule.target, [], diagnostics);
  }

  return diagnostics;
}

function scanObject(
  value: unknown,
  target: string,
  path: readonly string[],
  diagnostics: YckDiagnostic[],
): void {
  if (typeof value === 'string') {
    if (ENV_REF_RE.test(value)) {
      diagnostics.push(
        yck({
          code: YCK_ENV_IN_PATCH,
          message: `extension patch for '${target}' contains ${ENV_MARKER} reference at '${path.join('.')}' (YCK_ENV_IN_PATCH); extensions use Terraform expressions, not build env`,
          target,
          field: path.join('.'),
        }),
      );
    }
    return;
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      scanObject(child, target, [...path, key], diagnostics);
    }
  }
}
