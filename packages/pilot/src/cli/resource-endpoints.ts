// spec 021 ycsf-cli — map TerraformResource[] → MoveEndpoint[] for buildMoves.
import type { MoveEndpoint, TerraformResource } from '../contracts/index.js';

/**
 * Derive the current-resources endpoints from dispatched generated resources.
 * idl uses the `<type>.<name>` address, idt mirrors it (moved.yaml addresses
 * are Terraform addresses; type+name are the stable key).
 */
export function moveEndpointsFromResources(resources: readonly TerraformResource[]): readonly MoveEndpoint[] {
  return resources.map((resource) => ({
    idl: `${resource.type}.${resource.name}`,
    idt: `${resource.type}.${resource.name}`,
  }));
}