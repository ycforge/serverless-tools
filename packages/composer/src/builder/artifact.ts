import {
  REFERENCE_BEARER_FIELDS,
  RESOURCE_DOMAINS,
  collectLeafPositions,
} from '../resource/index.js';
import { TEMPLATE_RE } from '../resource/refs/template.js';
import type { ReferenceBearerField, ResourceDomain } from '../resource/types.js';

export const ARTIFACT_TYPE = 'ycforge:api-gateway';

export const OPENAPI_BUILD_FILENAME = 'openapi.json';

export interface ResourceReferenceValue {
  readonly logical: string;
  readonly terraformType: string;
}

export interface ApiGatewayArtifactValue {
  readonly specPath: string;
  readonly resourceReferences: readonly ResourceReferenceValue[];
}

/**
 * D-4: the ONLY Terraform knowledge Project B holds — the artifact-type →
 * Terraform resource address table. Frozen; additive-only. Verified against
 * materializers-core (spec 019).
 */
export const RESOURCE_DOMAIN_TERRAFORM_TYPES: Readonly<Record<ResourceDomain, string>> =
  Object.freeze({
    functions: 'yandex_function',
    queues: 'yandex_message_queue',
    buckets: 'yandex_storage_bucket',
    containers: 'yandex_serverless_container',
    gateways: 'yandex_api_gateway',
  });

const DOMAIN_RANK = new Map(RESOURCE_DOMAINS.map((domain, index) => [domain, index]));

/**
 * Collects `${resources.<domain>.<name>.<property>}` references from the final
 * artifact, restricted to the contracted reference-bearing fields, de-duplicated
 * by `logical` (`<domain>.<name>`), and ordered D-7: by domain appearance in
 * {@link RESOURCE_DOMAINS}, then alphabetically by name (FR-009/D-4/D-7).
 */
export function collectResourceReferences(
  document: Record<string, unknown>,
  fields: readonly ReferenceBearerField[] = REFERENCE_BEARER_FIELDS,
): ResourceReferenceValue[] {
  const byLogical = new Map<string, { domain: ResourceDomain; name: string }>();
  for (const field of fields) {
    for (const { parent, key } of collectLeafPositions(document, field.path)) {
      const value = parent[key];
      if (typeof value !== 'string') {
        continue;
      }
      const match = TEMPLATE_RE.exec(value);
      if (match === null) {
        continue;
      }
      const [, domain = '', name = '', property = ''] = match;
      if ((domain as ResourceDomain) !== field.domain || property !== field.property) {
        continue;
      }
      const logical = `${domain}.${name}`;
      if (!byLogical.has(logical)) {
        byLogical.set(logical, { domain: domain as ResourceDomain, name });
      }
    }
  }
  return [...byLogical.entries()]
    .sort(([, a], [, b]) => {
      const rankA = DOMAIN_RANK.get(a.domain) ?? 0;
      const rankB = DOMAIN_RANK.get(b.domain) ?? 0;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return a.name.localeCompare(b.name);
    })
    .map(([logical, { domain }]) => ({
      logical,
      terraformType: RESOURCE_DOMAIN_TERRAFORM_TYPES[domain],
    }));
}