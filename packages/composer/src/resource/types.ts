export type ResourceDomain = 'functions' | 'queues' | 'buckets' | 'containers' | 'gateways';

/**
 * Fixed per contract 009 (clarify Q1 — Variant A). 019 extends additively.
 */
export const RESOURCE_DOMAINS: readonly ResourceDomain[] = [
  'functions',
  'queues',
  'buckets',
  'containers',
  'gateways',
];

/**
 * Allowed property per resource domain (FR-004). Empty object declaration in
 * resources.yaml = all properties of the domain available.
 */
export const DOMAIN_PROPERTIES: ReadonlyMap<ResourceDomain, ReadonlySet<string>> = new Map([
  ['functions', new Set(['id'])],
  ['queues', new Set(['qurl'])],
  ['buckets', new Set(['name'])],
  ['containers', new Set(['id'])],
  ['gateways', new Set(['id'])],
]);

/**
 * Immutable build-time index of external resources (built from validated
 * `resources.yaml`). Empty index when `resources.yaml` is absent (FR-001).
 */
export interface ResourceIndex {
  readonly domains: ReadonlySet<ResourceDomain>;
  readonly resources: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  readonly entries: ReadonlyMap<ResourceDomain, ReadonlyMap<string, ReadonlySet<string>>>;

  has(domain: string, name: string): boolean;
  getProperties(domain: string, name: string): ReadonlySet<string> | undefined;
  validateProperty(domain: string, name: string, property: string): boolean;
  isValidProperty(domain: string, property: string): boolean;
}

/**
 * Build-time mapping of `domain.name.property → env var name` (from validated
 * `env.yaml`). Empty when `env.yaml` is absent.
 * `mode` (spec 010 extension of the 009 contract, additive/optional): `env-only`
 * tells the CLI to auto-enable ENV-only processing when `--env-only` is not set.
 */
export type EnvMappingMode = 'compose' | 'env-only';

export interface EnvMapping {
  readonly mode: EnvMappingMode;
  readonly entries: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, string>>>;

  getEnvVar(domain: string, name: string, property: string): string | undefined;
  hasEntry(domain: string, name: string, property: string): boolean;
}

/**
 * A reference-bearing field of the gateway artifact. `*` in path matches any
 * object key segment (e.g. securityScheme name). ENV-resolution applies ONLY
 * to fields listed in {@link REFERENCE_BEARER_FIELDS} (FR-019; clarify Q3 —
 * Variant B targeted).
 */
export interface ReferenceBearerField {
  readonly path: readonly (string | number)[];
  readonly domain: ResourceDomain;
  readonly property: string;
}

export const REFERENCE_BEARER_FIELDS: readonly ReferenceBearerField[] = [
  {
    path: ['components', 'securitySchemes', '*', 'x-yc-apigateway-authorizer', 'function_id'],
    domain: 'functions',
    property: 'id',
  },
];