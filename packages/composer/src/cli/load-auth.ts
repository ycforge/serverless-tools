import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAuthYaml } from '../auth/auth-yaml.js';
import { validateAuthConfig } from '../auth/auth-config.js';
import type { AuthYamlDocument } from '../auth/types.js';
import type { OpenApiDocument } from '../errors.js';
import { IOError, CLIError } from './errors.js';

export async function loadAuthConfig(
  appPath: string,
  openApi: OpenApiDocument,
  functions?: readonly string[],
): Promise<AuthYamlDocument> {
  try {
    const { authYaml } = await validateAuthConfig({
      appRoot: appPath,
      openApi,
      functions,
    });
    return authYaml;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    throw new IOError(
      `Failed to load auth config: ${error instanceof Error ? error.message : String(error)}`,
      'AUTH_CONFIG_LOAD_ERROR',
    );
  }
}

export async function loadAuthYamlRaw(appPath: string): Promise<{ text: string; sourcePath: string }> {
  const authPath = join(appPath, 'auth.yaml');
  try {
    const text = await readFile(authPath, 'utf8');
    return { text, sourcePath: authPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new IOError(`auth.yaml not found: ${authPath}`, 'AUTH_YAML_NOT_FOUND');
    }
    throw new IOError(`Failed to read auth.yaml: ${error instanceof Error ? error.message : String(error)}`, 'AUTH_YAML_READ_ERROR');
  }
}

export function parseAuthYamlConfig(text: string, sourcePath: string): AuthYamlDocument {
  try {
    const parsed = parseAuthYaml(text, sourcePath);
    return parsed as unknown as AuthYamlDocument;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    throw new IOError(`Failed to parse auth.yaml: ${error instanceof Error ? error.message : String(error)}`, 'AUTH_YAML_PARSE_ERROR');
  }
}