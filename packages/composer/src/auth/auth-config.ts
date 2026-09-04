import type { OpenApiDocument } from '../errors.js';
import type { AuthValidationRequest, AuthValidationResult, AuthYamlDocument } from './types.js';
import { loadAuthYaml, parseAuthYaml } from './auth-yaml.js';
import { validateFunctionReferences } from './function-ref.js';
import { validateSecurityReferences } from './auth-security.js';

export async function validateAuthConfig(
  request: AuthValidationRequest,
): Promise<AuthValidationResult> {
  const { appRoot, openApi, functions } = request;
  const { text, sourcePath } = await loadAuthYaml(appRoot);
  const parsed = parseAuthYaml(text, sourcePath);
  const authYaml = validateFunctionReferences(parsed, functions);
  validateSecurityReferences(openApi, authYaml);
  return { authYaml };
}

export function validateAuthReferences(
  openApi: OpenApiDocument,
  authYaml: AuthYamlDocument,
): AuthValidationResult {
  validateSecurityReferences(openApi, authYaml);
  return { authYaml };
}