export {
  compose,
  ComposeError,
  COMPOSE_ERROR_CODES,
  mergeDocuments,
  PathOwnership,
  sortRecordKeys,
  walkJsonKeys,
  appIdOf,
  loadOverrideFile,
  parseOverrideFile,
  applyOverrides,
  applyAuth,
} from './compose/index.js';
export type {
  ComposeApp,
  ComposeErrorCode,
  ComposeErrorContext,
  ComposeRequest,
  ComposeResult,
  GatewayDocument,
  MergeParticipant,
  MergeResult,
  OperationIdRef,
  OverrideFile,
  OverrideRule,
  OverrideRuleOp,
  OverrideTarget,
  OverrideTargetKind,
  RouteOwner,
} from './compose/index.js';

export { extractOpenApi, NO_SOURCE_MESSAGE } from './extract.js';
export {
  OpenApiExtractError,
  type ExtractErrorCode,
  type ExtractOptions,
  type ExtractionRequest,
  type OpenApiDocument,
  type OpenApiExtractErrorOptions,
} from './errors.js';
export { validateAuthConfig, validateAuthReferences } from './auth/auth-config.js';
export { AuthConfigError, AUTH_CONFIG_ERROR_CODES } from './auth/auth-errors.js';
export type { AuthConfigErrorCode, AuthConfigErrorContext } from './auth/auth-errors.js';
export type {
  AuthScheme,
  AuthValidationRequest,
  AuthValidationResult,
  AuthYamlDocument,
  FunctionReference,
} from './auth/types.js';

// spec 009 — logical resource references (IDL/IDT/IDR, `${resources...}` template, ENV-only)
export {
  parseResourceReference,
  formatResourceReference,
} from './resource/refs/parser.js';
export type { ParsedResourceReference, ResourceReference } from './resource/refs/parser.js';
export { makeTemplate, TEMPLATE_RE } from './resource/refs/template.js';
export type { TemplateParts } from './resource/refs/template.js';
export { ResourceRefError, RESOURCE_REF_ERROR_CODES } from './resource/errors.js';
export type { ResourceRefErrorCode, ResourceRefErrorContext } from './resource/errors.js';
export {
  DOMAIN_PROPERTIES,
  REFERENCE_BEARER_FIELDS,
  RESOURCE_DOMAINS,
} from './resource/types.js';
export type {
  EnvMapping,
  EnvMappingMode,
  ReferenceBearerField,
  ResourceDomain,
  ResourceIndex,
} from './resource/types.js';
export { emptyResourceIndex, loadResourceIndex, parseResourceIndex } from './resource/resource-index.js';
export { loadEnvMapping, parseEnvMapping, emptyEnvMapping } from './resource/env-mapping.js';
export { resolveReferences, resolveReferencesInValue, validateResourceReference } from './resource/reference-resolver.js';
export type { ResourceReferenceValidation } from './resource/reference-resolver.js';

// spec 010 — CLI public types for external consumers (check/compile contracts)
export type {
  CheckError,
  CheckName,
  CheckOptions,
  CheckResult,
  CheckSummary,
  CheckSummaryCounts,
  CompileOptions,
  GatewayApp,
  Provenance,
  RouteRef,
} from './cli/types.js';