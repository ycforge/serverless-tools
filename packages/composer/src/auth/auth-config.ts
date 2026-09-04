import type { AuthValidationRequest, AuthValidationResult, AuthYamlDocument } from './types.js';
import { loadAuthYaml, parseAuthYaml } from './auth-yaml.js';

export async function validateAuthConfig(
  request: AuthValidationRequest,
): Promise<AuthValidationResult> {
  const { appRoot, openApi } = request;
  const { text, sourcePath } = await loadAuthYaml(appRoot);
  const parsed = parseAuthYaml(text, sourcePath);
  void openApi;
  return { authYaml: parsed as unknown as AuthYamlDocument };
}