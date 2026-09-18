// spec 021 ycsf-cli — map TerraformResource[] → MoveEndpoint[] for buildMoves.
import type { MoveEndpoint, TerraformResource } from '../contracts/index.js';
import { IDL_DOMAIN_BY_TF_TYPE } from '../extensions/idl.js';

/**
 * Derive the current-resources endpoints from dispatched generated resources.
 *
 * `idt` is the Terraform address (`<type>.<name>`); `idl` is the logical IDL
 * (`<domain>.<name>`) for the domains that are IDL-addressable
 * (`functions`/`gateways`/`containers`). `.ycsf/moved.yaml` spells endpoints as
 * `{ idl, idt }`, so both must line up for the chain terminal to resolve.
 * Types without an IDL domain fall back to the Terraform address on both sides.
 */
export function moveEndpointsFromResources(
  resources: readonly TerraformResource[],
): readonly MoveEndpoint[] {
  return resources.map((resource) => {
    const idt = `${resource.type}.${resource.name}`;
    const domain = IDL_DOMAIN_BY_TF_TYPE[resource.type];
    return {
      idl: domain !== undefined ? `${domain}.${resource.name}` : idt,
      idt,
    };
  });
}
