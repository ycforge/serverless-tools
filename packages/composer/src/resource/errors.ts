export const RESOURCE_REF_ERROR_CODES = [
  'RESOURCE_REF_VERSION_UNSUPPORTED',
  'RESOURCE_REF_INVALID_YAML',
  'RESOURCE_REF_DOMAIN_UNKNOWN',
  'RESOURCE_REF_PROPERTY_INVALID',
  'RESOURCE_REF_IDENTITY_COLLISION',
  'RESOURCE_REF_NOT_DECLARED',
  'RESOURCE_REF_SYNTAX_INVALID',
  'RESOURCE_REF_ENV_NOT_SET',
  'RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED',
  'RESOURCE_REF_ENV_UNDECLARED_RESOURCE',
  'RESOURCE_REF_COLLISION_APPS_RESOURCES',
] as const;

export type ResourceRefErrorCode = (typeof RESOURCE_REF_ERROR_CODES)[number];

export interface ResourceRefErrorContext {
  filePath?: string;
  version?: string;
  domain?: string;
  name?: string;
  property?: string;
  allowedProperties?: readonly string[];
  input?: string;
  reason?: string;
  reference?: string;
  envVar?: string;
}

const ALLOWED_DOMAINS = 'functions, queues, buckets, containers, gateways';

const RESOURCE_REF_ERROR_MESSAGE_BY_CODE: Record<
  ResourceRefErrorCode,
  (c: ResourceRefErrorContext) => string
> = {
  RESOURCE_REF_VERSION_UNSUPPORTED: (c) =>
    `resource reference file version must be 1 (unsupported version: ${c.version ?? '<unknown>'} in ${c.filePath ?? '<unknown>'})`,
  RESOURCE_REF_INVALID_YAML: (c) =>
    `resource reference file is not a valid YAML map: ${c.filePath ?? '<unknown>'}`,
  RESOURCE_REF_DOMAIN_UNKNOWN: (c) =>
    `unknown resource domain: ${c.domain ?? '<unknown>'}. Allowed: ${ALLOWED_DOMAINS}`,
  RESOURCE_REF_PROPERTY_INVALID: (c) =>
    `invalid property "${c.property ?? '<unknown>'}" for resource ${
      c.domain && c.name ? `${c.domain}.${c.name}` : c.domain ?? '<unknown>'
    }: allowed ${(c.allowedProperties ?? []).join(', ') || '<unknown>'}`,
  RESOURCE_REF_IDENTITY_COLLISION: (c) =>
    `resource identity "${
      c.domain ? `${c.domain}.${c.name ?? '<unknown>'}` : c.name ?? '<unknown>'
    }" is declared more than once`,
  RESOURCE_REF_NOT_DECLARED: (c) =>
    `resource "${
      c.domain ? `${c.domain}.${c.name ?? '<unknown>'}` : c.name ?? '<unknown>'
    }" is not declared in resources.yaml (reference: ${c.reference ?? '<unknown>'})`,
  RESOURCE_REF_SYNTAX_INVALID: (c) =>
    `malformed resource reference ${JSON.stringify(c.input ?? '<unknown>')}: ${
      c.reason ?? 'invalid syntax'
    }`,
  RESOURCE_REF_ENV_NOT_SET: (c) =>
    `environment variable ${c.envVar ?? '<unknown>'} not set for reference ${
      c.reference ?? '<unknown>'
    }`,
  RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED: (c) =>
    `env.yaml default: field is not supported (resource ${
      c.domain && c.name ? `${c.domain}.${c.name}` : c.domain ?? '<unknown>'
    }, property ${c.property ?? '<unknown>'}; value comes from the environment only)`,
  RESOURCE_REF_ENV_UNDECLARED_RESOURCE: (c) =>
    `env.yaml references resource "${
      c.domain && c.name ? `${c.domain}.${c.name}` : c.domain ?? '<unknown>'
    }" (property ${c.property ?? '<unknown>'}) which is not declared in resources.yaml`,
  RESOURCE_REF_COLLISION_APPS_RESOURCES: (c) =>
    `identity "${c.domain}.${c.name ?? '<unknown>'}" is declared both as an app and as an external resource (checked by ycsf check, spec 011 — not by the composer)`,
};

/**
 * Deterministic fail-fast for resource-reference declarations and references.
 * Messages are English and built ONLY from the supplied context (no document
 * content, no non-deterministic data) — SC-002/003, Constitution V.
 */
export class ResourceRefError extends Error {
  readonly code: ResourceRefErrorCode;
  readonly context: Readonly<ResourceRefErrorContext>;
  readonly filePath?: string;
  readonly version?: string;
  readonly domain?: string;
  readonly property?: string;
  readonly allowedProperties?: readonly string[];
  readonly input?: string;
  readonly reason?: string;
  readonly reference?: string;
  readonly envVar?: string;

  constructor(
    code: ResourceRefErrorCode,
    messageOrContext: string | ResourceRefErrorContext = {},
    context: ResourceRefErrorContext = {},
  ) {
    const ctx = typeof messageOrContext === 'string' ? context : messageOrContext;
    super(RESOURCE_REF_ERROR_MESSAGE_BY_CODE[code](ctx));
    this.name = 'ResourceRefError';
    this.code = code;
    this.context = ctx;
    this.filePath = ctx.filePath;
    this.version = ctx.version;
    this.domain = ctx.domain;
    this.property = ctx.property;
    this.allowedProperties = ctx.allowedProperties;
    this.input = ctx.input;
    this.reason = ctx.reason;
    this.reference = ctx.reference;
    this.envVar = ctx.envVar;
  }
}