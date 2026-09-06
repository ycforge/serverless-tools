import {
  PML_IDENTITY_COLLISION,
  PML_INVALID,
  type App,
  type ProjectModelDiagnostic,
  type Resource,
} from '../contracts/index.js';

import { diag } from './errors.js';
import { isRecord } from './types.js';

/**
 * resources.yaml → domain-grouped Resource records (US-1 AC2, FR-002/FR-013).
 * External, reference only (Constitution VI). Unknown top-level domains are
 * kept as generic groups (research decision 11, forward-compat spec 019).
 */
export type ResourcesResult =
  | { kind: 'ok'; resources: Map<string, Map<string, Resource>> }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

export function extractResources(data: unknown, file: string): ResourcesResult {
  if (!isRecord(data)) {
    return {
      kind: 'invalid',
      errors: [diag({ code: PML_INVALID, message: `${file} must be a mapping`, file })],
    };
  }

  const errors: ProjectModelDiagnostic[] = [];
  const resources = new Map<string, Map<string, Resource>>();

  for (const [domain, rawEntries] of Object.entries(data)) {
    if (domain === 'version') continue;
    if (!isRecord(rawEntries)) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `domain '${domain}' must map resource_id → resource definition`,
          file,
          field: domain,
        }),
      );
      continue;
    }
    const group = new Map<string, Resource>();
    for (const [resourceId, rawProperties] of Object.entries(rawEntries)) {
      if (!isRecord(rawProperties)) {
        errors.push(
          diag({
            code: PML_INVALID,
            message: `resource '${domain}.${resourceId}' must be an object`,
            file,
            field: `${domain}.${resourceId}`,
          }),
        );
        continue;
      }
      group.set(resourceId, { domain, resource_id: resourceId, properties: rawProperties });
    }
    resources.set(domain, group);
  }

  if (errors.length > 0) {
    return { kind: 'invalid', errors };
  }
  return { kind: 'ok', resources };
}

/**
 * apps ↔ resources identity collision (plan Q1 decision, data-model.md):
 * a `functions`-domain `resource_id` matching an `app_id` is the same logical
 * identity under the `functions.<id>` artifact family — rejected fail-fast
 * (Constitution V + VI, FR-008 / US-3).
 */
export function checkIdentityCollision(
  apps: ReadonlyMap<string, App>,
  resources: ReadonlyMap<string, ReadonlyMap<string, Resource>>,
): readonly ProjectModelDiagnostic[] {
  const functionsDomain = resources.get('functions');
  if (!functionsDomain) {
    return [];
  }
  const diagnostics: ProjectModelDiagnostic[] = [];
  for (const resourceId of functionsDomain.keys()) {
    if (!apps.has(resourceId)) continue;
    const identity = `functions.${resourceId}`;
    diagnostics.push(
      diag({
        code: PML_IDENTITY_COLLISION,
        message: `identity '${identity}' exists in both apps.yaml and resources.yaml`,
        file: '.ycsf/apps.yaml',
        app: resourceId,
        identity,
      }),
    );
  }
  return diagnostics;
}