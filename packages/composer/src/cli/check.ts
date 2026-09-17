import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ResourceIndex } from '../resource/types.js';
import type { OpenApiDocument } from '../errors.js';
import type { OverrideRule, OverrideTarget } from '../compose/overrides/override-types.js';
import type { CheckOptions, CheckResult, CheckSummary, CheckError, CheckName } from './types.js';
import { IOError, CLIError } from './errors.js';
import { loadAppsYaml, filterGatewayApps, selectGatewayApp } from './load-config.js';
import { loadBuildConfig } from './load-openapi.js';
import { buildResourceIndex } from './resource-index.js';
import { loadOverrides } from './load-overrides.js';
import { validateAuthConfig } from '../auth/auth-config.js';
import { mergeDocuments } from '../compose/merge.js';
import { PathOwnership } from '../compose/provenance.js';
import { validateResourceReference } from '../resource/reference-resolver.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function skippedResult(check: CheckName): CheckResult {
  return { check, passed: true, details: 'Skipped (ENV-only mode)' };
}

export async function checkCommand(options: CheckOptions): Promise<CheckSummary> {
  const projectRoot = resolve(options.projectDir);
  const results: CheckResult[] = [];
  let hasInputError = false;

  try {
    const appsYamlPath = join(projectRoot, '.ycsf', 'apps.yaml');
    const appsConfig = await loadAppsYaml(appsYamlPath);
    const gatewayApps = filterGatewayApps(appsConfig);
    const selectedApp = selectGatewayApp(gatewayApps, options.app);

    const appPath = resolve(projectRoot, selectedApp.path);

    const { index, envMapping } = await buildResourceIndex(projectRoot);
    const envOnly = options.envOnly ?? (envMapping.mode === 'env-only');

    const check1Result = await checkOpenApiSourcesExist(
      projectRoot,
      appsConfig,
      envOnly,
    );
    results.push(check1Result);
    if (!check1Result.passed) hasInputError = true;

    const check2Result = await checkAuthSchemesValid(
      appPath,
      index,
    );
    results.push(check2Result);

    if (envOnly) {
      results.push(skippedResult('no-path-operationid-conflicts'));
      results.push(skippedResult('resource-refs-resolvable'));
      results.push(skippedResult('overrides-targets-exist'));
    } else {
      results.push(await checkNoPathOperationIdConflicts(appPath));
      results.push(await checkResourceRefsResolvable(appPath, index));
      results.push(await checkOverridesTargetsExist(projectRoot, appPath, selectedApp.id));
    }
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    throw new IOError(
      `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      'CHECK_ERROR',
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const exitCode = hasInputError ? 2 : failed > 0 ? 1 : 0;

  return {
    projectDir: projectRoot,
    timestamp: new Date().toISOString(),
    results,
    summary: { passed, failed, total: results.length },
    exitCode: exitCode as 0 | 1 | 2,
  };
}

async function checkOpenApiSourcesExist(
  projectRoot: string,
  appsConfig: { apps: Array<{ id: string; builder: string; path: string }> },
  envOnly: boolean,
): Promise<CheckResult> {
  if (envOnly) {
    return {
      check: 'openapi-sources-exist',
      passed: true,
      details: 'Skipped (ENV-only mode)',
    };
  }

  const gatewayApps = appsConfig.apps.filter((a) => a.builder === 'yandex-api-gateway');
  const errors: CheckError[] = [];

  for (const app of gatewayApps) {
    try {
      const appPath = resolve(projectRoot, app.path);
      const config = await loadBuildConfig(appPath);
      const entry = config.openapi_entry;
      if (entry !== undefined) {
        const openapiPath = resolve(appPath, entry);
        if (!existsSync(openapiPath)) {
          errors.push({
            code: 'OPENAPI_FILE_MISSING',
            message: `OpenAPI file not found: ${entry}`,
            source: openapiPath,
            apps: [app.id],
          });
        }
      } else if (
        !existsSync(join(appPath, 'openapi.json')) &&
        !existsSync(join(appPath, 'swagger.json')) &&
        !existsSync(join(appPath, 'dist', 'main.js')) &&
        !existsSync(join(appPath, 'dist', 'main'))
      ) {
        errors.push({
          code: 'OPENAPI_SOURCE_MISSING',
          message: 'No OpenAPI source: set openapi_entry in build_config.yaml or add an openapi.json/swagger.json artifact',
          source: appPath,
          apps: [app.id],
        });
      }
    } catch (error) {
      errors.push({
        code: 'BUILD_CONFIG_ERROR',
        message: `Failed to load build_config.yaml for ${app.id}: ${error instanceof Error ? error.message : String(error)}`,
        apps: [app.id],
      });
    }
  }

  return {
    check: 'openapi-sources-exist',
    passed: errors.length === 0,
    details: errors.length === 0 ? 'All OpenAPI sources exist' : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function checkAuthSchemesValid(
  appPath: string,
  index: ResourceIndex,
): Promise<CheckResult> {
  const errors: CheckError[] = [];

  const functions = [...(index.entries.get('functions')?.keys() ?? [])];

  try {
    const { authYaml } = await validateAuthConfig({
      appRoot: appPath,
      openApi: { openapi: '3.1.0', info: { title: '', version: '' }, paths: {} } as OpenApiDocument,
      functions,
    });

    const schemes = authYaml.schemes;

    if (!authYaml.defaultScheme || !(authYaml.defaultScheme in schemes)) {
      errors.push({
        code: 'AUTH_DEFAULT_SCHEME_MISSING',
        message: `Default scheme "${authYaml.defaultScheme}" not found in schemes`,
      });
    }

    for (const [name, scheme] of Object.entries(schemes)) {
      if (scheme.type === 'jwt') {
        if (!scheme.issuer || !scheme.jwksUri || !scheme.audience) {
          errors.push({
            code: 'AUTH_JWT_MISSING_FIELDS',
            message: `JWT scheme "${name}" missing required fields (issuer, jwksUri, audience)`,
            apps: [name],
          });
        }
      } else if (scheme.type === 'function') {
        const refName = scheme.function?.name;
        if (!refName || !index.has('functions', refName)) {
          errors.push({
            code: 'AUTH_FUNCTION_NOT_DECLARED',
            message: `Function "${refName ?? scheme.function?.ref}" not declared in resources.yaml`,
            apps: [name],
          });
        }
      }
    }
  } catch (error) {
    errors.push({
      code: 'AUTH_CONFIG_ERROR',
      message: `Failed to validate auth config: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    check: 'auth-schemes-valid',
    passed: errors.length === 0,
    details: errors.length === 0 ? 'All auth schemes valid' : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function checkNoPathOperationIdConflicts(
  appPath: string,
): Promise<CheckResult> {
  const errors: CheckError[] = [];

  try {
    const { extractOpenApi } = await import('../extract.js');
    const doc = await extractOpenApi({ appRoot: appPath });

    const operationRefs = new Map<string, Array<{ path: string; method: string }>>();

    for (const [path, pathItem] of Object.entries(doc.paths)) {
      if (pathItem !== null && typeof pathItem === 'object') {
        for (const [method, operation] of Object.entries(pathItem as Record<string, unknown>)) {
          if (HTTP_METHODS.has(method)) {
            const op = operation as Record<string, unknown>;
            if (typeof op.operationId === 'string' && op.operationId) {
              const refs = operationRefs.get(op.operationId) ?? [];
              refs.push({ path, method });
              operationRefs.set(op.operationId, refs);
            }
          }
        }
      }
    }

    for (const [operationId, refs] of operationRefs) {
      if (refs.length > 1) {
        errors.push({
          code: 'DUPLICATE_OPERATION_ID',
          message: `Duplicate operationId "${operationId}"`,
          routes: refs.map((r) => ({ path: r.path, method: r.method, operationId })),
        });
      }
    }
  } catch (error) {
    errors.push({
      code: 'OPENAPI_LOAD_ERROR',
      message: `Failed to load OpenAPI for conflict check: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    check: 'no-path-operationid-conflicts',
    passed: errors.length === 0,
    details: errors.length === 0 ? 'No conflicts found' : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function checkResourceRefsResolvable(
  appPath: string,
  index: ResourceIndex,
): Promise<CheckResult> {
  const errors: CheckError[] = [];
  let totalRefs = 0;
  let resolvedRefs = 0;

  try {
    const { extractOpenApi } = await import('../extract.js');
    const doc = await extractOpenApi({ appRoot: appPath });

    const refs = findAllResourceRefs(doc);
    totalRefs = refs.length;

    for (const ref of refs) {
      const validation = validateResourceReference(ref.value, index);
      if (validation.valid) {
        resolvedRefs++;
      } else if (!validation.valid && 'error' in validation) {
        errors.push({
          code: 'UNRESOLVED_RESOURCE_REF',
          message: validation.error.message,
          source: ref.location,
        });
      }
    }
  } catch (error) {
    errors.push({
      code: 'OPENAPI_LOAD_ERROR',
      message: `Failed to load OpenAPI for resource ref check: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    check: 'resource-refs-resolvable',
    passed: errors.length === 0,
    details: `${resolvedRefs}/${totalRefs} refs resolved`,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function findAllResourceRefs(doc: OpenApiDocument): Array<{ value: string; location: string }> {
  const refs: Array<{ value: string; location: string }> = [];

  function walk(obj: unknown, path: string[] = []): void {
    if (typeof obj === 'string') {
      if (obj.startsWith('${resources.') && obj.endsWith('}')) {
        refs.push({ value: obj, location: path.join('.') });
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => walk(item, [...path, String(index)]));
    } else if (obj !== null && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        walk(value, [...path, key]);
      }
    }
  }

  walk(doc);
  return refs;
}

async function checkOverridesTargetsExist(
  projectRoot: string,
  appPath: string,
  appId: string,
): Promise<CheckResult> {
  const errors: CheckError[] = [];
  let totalTargets = 0;
  let existingTargets = 0;

  try {
    const { extractOpenApi } = await import('../extract.js');

    const doc = await extractOpenApi({ appRoot: appPath });

    const overrides = await loadOverrides(projectRoot, appPath);

    const merged = mergeDocuments([{ appId, doc }]);
    const ownership = new PathOwnership([{ appId, paths: doc.paths }]);

    const fileEntries: Array<{ filePath: string; rules: readonly OverrideRule[]; scope: string }> =
      [];
    if (overrides.global !== null) {
      fileEntries.push({
        filePath: overrides.global.sourcePath,
        rules: overrides.global.rules,
        scope: 'Global',
      });
    }
    if (overrides.app !== null) {
      fileEntries.push({
        filePath: overrides.app.sourcePath,
        rules: overrides.app.rules,
        scope: 'App',
      });
    }

    for (const entry of fileEntries) {
      for (const rule of entry.rules) {
        totalTargets++;
        if (checkOverrideTarget(merged, ownership, rule.target)) {
          existingTargets++;
        } else {
          errors.push({
            code: 'OVERRIDE_TARGET_MISSING',
            message: `${entry.scope} override target not found: ${describeTarget(rule.target)}`,
            source: entry.filePath,
          });
        }
      }
    }
  } catch (error) {
    errors.push({
      code: 'OVERRIDES_CHECK_ERROR',
      message: `Failed to check overrides: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    check: 'overrides-targets-exist',
    passed: errors.length === 0,
    details: `${existingTargets}/${totalTargets} override targets exist`,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function describeTarget(target: OverrideTarget): string {
  switch (target.kind) {
    case 'info': return 'info';
    case 'path': return `path ${target.path}`;
    case 'operation': return `${target.method?.toUpperCase()} ${target.path}`;
    case 'operationId': return `operationId ${target.operationId}`;
    case 'component': return `component ${target.name}`;
    default: return 'unknown';
  }
}

function checkOverrideTarget(
  merged: { paths: Record<string, unknown>; components: Record<string, unknown> },
  ownership: PathOwnership,
  target: OverrideTarget,
): boolean {
  switch (target.kind) {
    case 'info':
      return true;
    case 'path': {
      return target.path !== undefined && target.path in merged.paths;
    }
    case 'operation': {
      if (!target.path || !target.method) return false;
      const pathItem = merged.paths[target.path];
      if (pathItem === null || typeof pathItem !== 'object' || Array.isArray(pathItem)) {
        return false;
      }
      return target.method in pathItem;
    }
    case 'operationId': {
      const ref = ownership.resolveOperation(target.operationId ?? '');
      return ref !== undefined;
    }
    case 'component': {
      if (!target.name) return false;
      for (const comp of Object.values(merged.components)) {
        if (comp !== null && typeof comp === 'object' && target.name in comp) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}