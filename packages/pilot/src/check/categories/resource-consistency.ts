// spec 020 ycsf-check — C4: resource consistency (resources.yaml refs → generated TF addresses).
import type { ProjectModel, TerraformResource } from '../../contracts/index.js';
import { IDL_DOMAIN_BY_TF_TYPE } from '../../extensions/idl.js';
import { YCK_REF_UNRESOLVED, type YckDiagnostic } from '../../contracts/check.js';
import { yck } from '../errors.js';

export function checkResourceConsistency(
  projectModel: ProjectModel,
  generatedResources: readonly TerraformResource[],
): readonly YckDiagnostic[] {
  const diagnostics: YckDiagnostic[] = [];

  // Build reverse mapping: domain → tfType
  const domainToTfType = new Map<string, string>();
  for (const [tfType, domain] of Object.entries(IDL_DOMAIN_BY_TF_TYPE)) {
    domainToTfType.set(domain, tfType);
  }

  for (const [domain, resourceIdMap] of projectModel.resources) {
    const tfType = domainToTfType.get(domain);
    if (tfType === undefined) continue;

    for (const resourceId of resourceIdMap.keys()) {
      const found = generatedResources.some(
        (r) => r.type === tfType && r.name === resourceId,
      );
      if (!found) {
        diagnostics.push(
          yck({
            code: YCK_REF_UNRESOLVED,
            message: `resource reference '${domain}.${resourceId}' has no matching generated Terraform resource (YCK_REF_UNRESOLVED)`,
            resourceRef: `${domain}.${resourceId}`,
            file: '.ycsf/resources.yaml',
          }),
        );
      }
    }
  }

  return diagnostics;
}
