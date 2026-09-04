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