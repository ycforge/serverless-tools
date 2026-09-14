/**
 * Artifact-type → resource-domain mapping (spec 028, FR-001/FR-002; plan D-1).
 *
 * Canonical home of the mapping consumed by BOTH Project C (identity
 * derivation in `model/resources.ts` and `build/index.ts`) and Project B
 * (composer merged resource index). New additive contract surface — ZERO
 * existing consumers. Frozen — never a second source for this vocabulary.
 */

/** Resource domains of the composition reference model (aligned with composer `RESOURCE_DOMAINS`). */
export type ResourceDomain = 'functions' | 'queues' | 'buckets' | 'containers' | 'gateways';

/** One app-derived resource identity transported C → B (plan D-1, spec 028 US-1). */
export interface AppIdentity {
  readonly appId: string;
  readonly artifactType: string;
}

/**
 * Exactly the four map-form builder keys that derive a resource identity
 * (FR-002): `ycforge:function` → `functions`, `ycforge:docker-image` →
 * `containers`, `ycforge:frontend` → `buckets`, `ycforge:api-gateway` →
 * `gateways`. An app whose builder key is NOT in this map derives no identity
 * (plan D-8 — legacy builders do not collide).
 */
export const ARTIFACT_TYPE_DOMAIN_MAP: Readonly<Record<string, ResourceDomain>> = Object.freeze({
  'ycforge:function': 'functions',
  'ycforge:docker-image': 'containers',
  'ycforge:frontend': 'buckets',
  'ycforge:api-gateway': 'gateways',
});

/** Pure unary mapping: artifact type → resource domain, or `undefined`. Never throws. */
export function artifactTypeToResourceDomain(type: string): ResourceDomain | undefined {
  return ARTIFACT_TYPE_DOMAIN_MAP[type];
}