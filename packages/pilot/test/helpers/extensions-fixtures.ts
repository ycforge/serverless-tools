import type {
  ExtensionRule,
  ExtensionsYaml,
  TerraformResource,
} from '../../src/contracts/index.js';
import type { TempProject } from './temp-project.js';

/**
 * Extensions (spec 015) test fixture helper (task T003).
 *
 * Reuses the materialize-fixture conventions: pure in-memory resource
 * factories + YAML text generators for `loadExtensions`/`parseExtensionsYaml`
 * scenarios + parsed `ExtensionsYaml` object builders for `applyExtensions`
 * scenarios. Hermetic, parallel-safe, no `process.env`, never touches real
 * `.ycsf/` files.
 */

export const USER_SERVICE_CONFIGURATION = {
  name: 'user-service',
  runtime: 'nodejs18',
  entrypoint: 'main.handler',
  environment: { NODE_ENV: 'production' },
  execution_timeout: '5s',
} as const;

export const ANALYTICS_CONFIGURATION = {
  name: 'analytics',
  runtime: 'nodejs18',
  entrypoint: 'main.handler',
  environment: { NODE_ENV: 'production' },
  tags: { env: 'prod' },
} as const;

export const OPENAPI_CONFIGURATION = {
  name: 'openapi',
  custom_domains: [{ domain_id: 'd1' }],
} as const;

export const FRONTEND_CONFIGURATION = {
  name: 'frontend',
  image: 'registry.example.com/frontend',
} as const;

export function functionResource(name: string, configuration: Record<string, unknown> = {}): TerraformResource {
  return { kind: 'resource', type: 'yandex_function', name, configuration };
}

export function gatewayResource(name: string, configuration: Record<string, unknown> = {}): TerraformResource {
  return { kind: 'resource', type: 'yandex_api_gateway', name, configuration };
}

export function containerResource(name: string, configuration: Record<string, unknown> = {}): TerraformResource {
  return { kind: 'resource', type: 'yandex_container', name, configuration };
}

/**
 * Canonical quickstart resource set: yandex_function.user_service,
 * yandex_function.analytics, yandex_api_gateway.openapi (all IDL-addressable)
 * plus yandex_container.frontend (type outside IDL_DOMAIN_BY_TF_TYPE — not
 * addressable).
 */
export function canonicalResources(): readonly TerraformResource[] {
  return [
    functionResource('user_service', USER_SERVICE_CONFIGURATION),
    functionResource('analytics', ANALYTICS_CONFIGURATION),
    gatewayResource('openapi', OPENAPI_CONFIGURATION),
    containerResource('frontend', FRONTEND_CONFIGURATION),
  ];
}

/**
 * Assemble a `.ycsf/extensions.yaml` text from an indented rules block.
 * `rulesText` starts at column 2 (direct children of `extensions:`).
 */
export function extensionsYaml(rulesText: string): string {
  return `version: 1\nextensions:\n${rulesText}`;
}

/** Sc1 canonical extensions file: env/timeout/service_account for functions.user_service. */
export function canonicalExtensionsYaml(): string {
  return extensionsYaml(
    '  - target: "functions.user_service"\n' +
      '    patch:\n' +
      '      environment:\n' +
      '        CUSTOM_VAR: "value"\n' +
      '      execution_timeout: "30s"\n' +
      '      service_account_id: "${yandex_iam_service_account.custom.id}"\n',
  );
}

export function writeExtensionsYaml(project: TempProject, yaml: string): void {
  project.write('.ycsf/extensions.yaml', yaml);
}

export function rule(target: string, patch: Record<string, unknown>): ExtensionRule {
  return { target, patch };
}

export function makeExtensions(rules: readonly ExtensionRule[]): ExtensionsYaml {
  return { version: 1, extensions: rules };
}

export function canonicalRules(): readonly ExtensionRule[] {
  return [
    rule('functions.user_service', {
      environment: { CUSTOM_VAR: 'value' },
      execution_timeout: '30s',
      service_account_id: '${yandex_iam_service_account.custom.id}',
    }),
  ];
}

export function canonicalParsedExtensions(): ExtensionsYaml {
  return makeExtensions(canonicalRules());
}