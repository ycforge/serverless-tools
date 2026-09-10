// spec 020 ycsf-check — C1: override targets (extension target → generated resource existence).
import type { ExtensionsYaml, TerraformResource } from '../../contracts/index.js';
import { createIdlIndex } from '../../extensions/idl.js';
import { YCK_MISSING_TARGET, type YckDiagnostic } from '../../contracts/check.js';
import { yck } from '../errors.js';

export function checkOverrideTargets(
  extensions: ExtensionsYaml,
  generatedResources: readonly TerraformResource[],
): readonly YckDiagnostic[] {
  const diagnostics: YckDiagnostic[] = [];
  const idlIndex = createIdlIndex(generatedResources);

  for (const rule of extensions.extensions) {
    if (!idlIndex.byIdl.has(rule.target)) {
      diagnostics.push(
        yck({
          code: YCK_MISSING_TARGET,
          message: `extension target '${rule.target}' does not exist in generated model (YCK_MISSING_TARGET); available IDLs: ${idlIndex.availableIdls.join(', ')}`,
          target: rule.target,
          availableIdls: idlIndex.availableIdls,
        }),
      );
    }
  }

  return diagnostics;
}
