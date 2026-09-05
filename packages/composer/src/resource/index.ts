export { parseResourceReference, formatResourceReference } from './refs/parser.js';
export type { ParsedResourceReference, ResourceReference } from './refs/parser.js';
export { makeTemplate, TEMPLATE_RE, TEMPLATE_PREFIX, TEMPLATE_SUFFIX } from './refs/template.js';
export type { TemplateParts } from './refs/template.js';
export { ResourceRefError, RESOURCE_REF_ERROR_CODES } from './errors.js';
export type { ResourceRefErrorCode, ResourceRefErrorContext } from './errors.js';
export {
  DOMAIN_PROPERTIES,
  REFERENCE_BEARER_FIELDS,
  RESOURCE_DOMAINS,
} from './types.js';
export type {
  EnvMapping,
  ReferenceBearerField,
  ResourceDomain,
  ResourceIndex,
} from './types.js';
export { emptyResourceIndex, loadResourceIndex, parseResourceIndex } from './resource-index.js';
export { parseEnvMapping, loadEnvMapping, emptyEnvMapping } from './env-mapping.js';
export { resolveReferences, validateResourceReference } from './reference-resolver.js';
export type { ResourceReferenceValidation } from './reference-resolver.js';