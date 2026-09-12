import type { DispatchDiagnostic, GeneratedTfFile, TerraformResource } from '../contracts/index.js';
import { MTL_FILENAME_COLLISION, MTL_INVALID_TERRAFORM_ADDRESS, MTL_OUTPUT_NAME_COLLISION } from '../contracts/index.js';
import { mtl } from './errors.js';

/**
 * Deterministic `.tf.json` serialization (FR-009, research 5).
 * JSON keys are emitted lexicographically at every object level; input key
 * order is irrelevant (SC-003, US-8). Pure in-memory — no I/O here (FR-015).
 */

/** One declared output (OutputBuilder.declare value shape). */
export interface OutputValue {
  readonly value: string;
  readonly description?: string;
}

const SORTED_KEY_REPLACER = (_key: string, value: unknown): unknown => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return value;
};

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, SORTED_KEY_REPLACER, 2);
}

/** Serialize one resource into `{ resource: { [type]: { [name]: cfg } } }`. */
export function serializeResource(resource: TerraformResource): string {
  return serializeJson({ resource: { [resource.type]: { [resource.name]: resource.configuration } } });
}

/**
 * Serialize several resources (possibly different types from one artifact,
 * e.g. a bucket plus its objects) into a single merged
 * `{ resource: { [type]: { [name]: cfg } … } }` document. Keys stay
 * lexicographically sorted at every level (FR-009); type collisions across
 * resources of one app are impossible (one `name` per type, spec 011).
 */
export function serializeResources(resources: readonly TerraformResource[]): string {
  const byType: Record<string, Record<string, unknown>> = {};
  for (const resource of resources) {
    const byName: Record<string, unknown> = byType[resource.type] ?? {};
    byName[resource.name] = resource.configuration;
    byType[resource.type] = byName;
  }
  return serializeJson({ resource: byType });
}

/** Terraform identifier grammar `[a-zA-Z_][a-zA-Z0-9_]*` (FR-011). */
const ADDRESS_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate a `TerraformResource` address (`type` and `name`). Returns a
 * single `MTL_INVALID_TERRAFORM_ADDRESS` diagnostic (first offending
 * component) or `null`. Both components are always reported on failure so
 * the diagnostic carries complete `type`/`name` data.
 */
export function validateAddress(type: string, name: string): DispatchDiagnostic | null {
  const target = ADDRESS_RE.test(type) ? name : type;
  if (ADDRESS_RE.test(target)) return null;
  return mtl({
    code: MTL_INVALID_TERRAFORM_ADDRESS,
    message: `invalid Terraform address component '${target}' (must match [a-zA-Z_][a-zA-Z0-9_]*) (MTL_INVALID_TERRAFORM_ADDRESS)`,
    type,
    name,
  });
}

/** Per-app generated filename (data-model, research 6). */
export function computeFilename(appId: string): string {
  return `${appId}.ycsf.tf.json`;
}

/** Ownership/validity glob for generated files. */
const FILENAME_RE = /^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/;

export interface NamedGeneratedFile {
  readonly appId: string;
  readonly filename: string;
}

/**
 * Defensive collision check: two artifacts computing the same filename
 * (prevented by app_id uniqueness in spec 011; FR-010).
 */
export function detectFilenameCollision(files: readonly NamedGeneratedFile[]): DispatchDiagnostic[] {
  const byFilename = new Map<string, string[]>();
  for (const file of files) {
    const ids = byFilename.get(file.filename) ?? [];
    if (!ids.includes(file.appId)) ids.push(file.appId);
    byFilename.set(file.filename, ids);
  }

  const diagnostics: DispatchDiagnostic[] = [];
  for (const [filename, appIds] of byFilename) {
    if (appIds.length > 1) {
      const firstAppId = appIds[0] as string;
      diagnostics.push(
        mtl({
          code: MTL_FILENAME_COLLISION,
          message: `filename '${filename}' collides across apps '${appIds.join("', '")}' (MTL_FILENAME_COLLISION)`,
          filename,
          artifactId: firstAppId,
        }),
      );
    }
  }
  return diagnostics;
}

export type SerializeResourceFileResult =
  | { readonly kind: 'ok'; readonly file: GeneratedTfFile }
  | { readonly kind: 'invalid'; readonly errors: readonly DispatchDiagnostic[] };

/** Address guard + per-app filename → one GeneratedTfFile. */
export function serializeResourceFile(appId: string, resource: TerraformResource): SerializeResourceFileResult {
  const addressError = validateAddress(resource.type, resource.name);
  if (addressError !== null) {
    return { kind: 'invalid', errors: [addressError] };
  }
  const filename = computeFilename(appId);
  if (!FILENAME_RE.test(filename)) {
    return {
      kind: 'invalid',
      errors: [
        mtl({
          code: MTL_INVALID_TERRAFORM_ADDRESS,
          message: `app id '${appId}' produces unsafe filename '${filename}' (MTL_INVALID_TERRAFORM_ADDRESS)`,
          name: appId,
        }),
      ],
    };
  }
  return { kind: 'ok', file: { filename, content: serializeResource(resource) } };
}

/**
 * Per-app file builder for the dispatch serialize stage: validates the
 * address of EVERY resource yielded by the app's artifact (one artifact may
 * produce several resources, spec 019 materializers) and merges them into
 * the app's single `{appId}.ycsf.tf.json`. Single-resource apps get exactly
 * the same bytes as `serializeResourceFile`.
 */
export function serializeAppFile(appId: string, resources: readonly TerraformResource[]): SerializeResourceFileResult {
  for (const resource of resources) {
    const addressError = validateAddress(resource.type, resource.name);
    if (addressError !== null) {
      return { kind: 'invalid', errors: [addressError] };
    }
  }
  const filename = computeFilename(appId);
  if (!FILENAME_RE.test(filename)) {
    return {
      kind: 'invalid',
      errors: [
        mtl({
          code: MTL_INVALID_TERRAFORM_ADDRESS,
          message: `app id '${appId}' produces unsafe filename '${filename}' (MTL_INVALID_TERRAFORM_ADDRESS)`,
          name: appId,
        }),
      ],
    };
  }
  return { kind: 'ok', file: { filename, content: serializeResources(resources) } };
}

/** Duplicate declared output names → MTL_OUTPUT_NAME_COLLISION (FR-013). */
export function outputCollisionDiagnostics(duplicateNames: readonly string[]): DispatchDiagnostic[] {
  return duplicateNames.map((name) =>
    mtl({
      code: MTL_OUTPUT_NAME_COLLISION,
      message: `output name '${name}' declared more than once (MTL_OUTPUT_NAME_COLLISION)`,
      outputName: name,
    }),
  );
}