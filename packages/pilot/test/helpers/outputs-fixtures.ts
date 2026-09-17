import type { TerraformResource } from '../../src/contracts/index.js';
import {
  ANALYTICS_CONFIGURATION,
  FRONTEND_CONFIGURATION,
  OPENAPI_CONFIGURATION,
  USER_SERVICE_CONFIGURATION,
} from './extensions-fixtures.js';
import type { TempProject } from './temp-project.js';

/**
 * Outputs (spec 016) test fixture helper (task T003).
 *
 * Reuses the extensions-fixtures/materialize-fixtures conventions: pure
 * in-memory resource factories + `.ycsf/outputs.yaml` text generators for
 * `loadOutputs`/`parseOutputsYaml` scenarios + parsed `OutputsYaml`-object
 * builders for pure `buildOutputs` scenarios. Hermetic, parallel-safe, no
 * `process.env`, never touches real `.ycsf/` files.
 */

/** One output rule shape ({ value, description? } — OutputValue-compatible). */
export interface OutputFixtureEntry {
  readonly value: string;
  readonly description?: string;
}

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
 * addressable). IDL index: functions.user_service, functions.analytics,
 * gateways.openapi.
 */
export function canonicalResources(): readonly TerraformResource[] {
  return [
    functionResource('user_service', USER_SERVICE_CONFIGURATION),
    functionResource('analytics', ANALYTICS_CONFIGURATION),
    gatewayResource('openapi', OPENAPI_CONFIGURATION),
    containerResource('frontend', FRONTEND_CONFIGURATION),
  ];
}

/** Assemble `version: 1` + `outputs:` from an indented outputs block. */
export function outputsYamlText(outputsBlock: string): string {
  return `version: 1\noutputs:\n${outputsBlock}`;
}

/** Sc1 canonical `.ycsf/outputs.yaml`: frontend_api_url + user_service_function_id. */
export function canonicalOutputsYamlText(): string {
  return outputsYamlText(
    '  frontend_api_url:\n' +
      '    value: "gateways.openapi.domain"\n' +
      '    description: "Public API endpoint"\n' +
      '  user_service_function_id:\n' +
      '    value: "functions.user_service.id"\n' +
      '    description: "Cloud function ID"\n',
  );
}

/** Structurally compatible with the public `OutputsYaml` contract. */
export interface OutputsYamlFixture {
  readonly version: 1;
  readonly outputs: Record<string, OutputFixtureEntry>;
}

export function makeOutputsYaml(outputs: Record<string, OutputFixtureEntry>): OutputsYamlFixture {
  return { version: 1, outputs };
}

export function canonicalOutputsYaml(): OutputsYamlFixture {
  return makeOutputsYaml({
    frontend_api_url: { value: 'gateways.openapi.domain', description: 'Public API endpoint' },
    user_service_function_id: { value: 'functions.user_service.id', description: 'Cloud function ID' },
  });
}

/** Write `.ycsf/outputs.yaml` into an existing TempProject. */
export function writeOutputsYaml(project: TempProject, yaml: string): void {
  project.write('.ycsf/outputs.yaml', yaml);
}