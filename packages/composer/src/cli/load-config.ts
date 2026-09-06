import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, isMap, isAlias, type YAMLParseError } from 'yaml';

import type { GatewayApp } from './types.js';
import { InputError, IOError, CLIError } from './errors.js';

export interface AppConfig {
  version: number;
  apps: Array<{
    id: string;
    name: string;
    builder: string;
    path: string;
  }>;
}

export async function loadAppsYaml(appsYamlPath: string): Promise<AppConfig> {
  try {
    const text = await readFile(appsYamlPath, 'utf8');
    const doc = parseDocument(text, { uniqueKeys: true });
    const firstError = doc.errors[0] as YAMLParseError | undefined;
    if (firstError) {
      throw new IOError(`Failed to parse apps.yaml: ${firstError.message}`, 'APPS_YAML_PARSE_ERROR');
    }
    if (!isMap(doc.contents) || isAlias(doc.contents)) {
      throw new IOError('apps.yaml: document is not a mapping', 'APPS_YAML_INVALID_FORMAT');
    }
    const config = doc.toJS() as AppConfig;
    if (config.version !== 1) {
      throw new InputError(`Unsupported apps.yaml version: ${config.version}`, 'APPS_YAML_VERSION_UNSUPPORTED');
    }
    if (!Array.isArray(config.apps)) {
      throw new InputError('apps.yaml: "apps" must be an array', 'APPS_YAML_INVALID_FORMAT');
    }
    return config;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new IOError(`apps.yaml not found: ${appsYamlPath}`, 'APPS_YAML_NOT_FOUND');
    }
    throw new IOError(`Failed to read apps.yaml: ${error instanceof Error ? error.message : String(error)}`, 'APPS_YAML_READ_ERROR');
  }
}

export function filterGatewayApps(config: AppConfig): GatewayApp[] {
  return config.apps
    .filter((app) => app.builder === 'yandex-api-gateway')
    .map((app) => ({
      id: app.id,
      name: app.name,
      builder: 'yandex-api-gateway' as const,
      path: app.path,
      openapiEntry: '',
      authPath: join(app.path, 'auth.yaml'),
      overridesPath: join(app.path, 'overrides.yaml'),
    }));
}

export function selectGatewayApp(
  gatewayApps: GatewayApp[],
  appId?: string,
): GatewayApp {
  if (gatewayApps.length === 0) {
    throw new InputError(
      'No yandex-api-gateway apps found in .ycsf/apps.yaml',
      'NO_GATEWAY_APPS',
    );
  }
  if (gatewayApps.length > 1 && !appId) {
    const names = gatewayApps.map((a) => a.id).join(', ');
    throw new InputError(
      `Multiple gateway apps found: ${names}. Use --app <appId> to select one.`,
      'MULTIPLE_GATEWAY_APPS',
    );
  }
  if (appId) {
    const app = gatewayApps.find((a) => a.id === appId);
    if (!app) {
      throw new InputError(
        `Gateway app "${appId}" not found. Available: ${gatewayApps.map((a) => a.id).join(', ')}`,
        'GATEWAY_APP_NOT_FOUND',
      );
    }
    return app;
  }
  const firstApp = gatewayApps[0];
  if (!firstApp) {
    throw new InputError(
      'No yandex-api-gateway apps found in .ycsf/apps.yaml',
      'NO_GATEWAY_APPS',
    );
  }
  return firstApp;
}