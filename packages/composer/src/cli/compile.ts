import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { applyAuth } from '../compose/auth-apply.js';
import { applyOverrides } from '../compose/overrides/apply.js';
import { mergeDocuments, sortRecordKeys } from '../compose/merge.js';
import { resolveReferences, REFERENCE_BEARER_FIELDS } from '../resource/index.js';
import { ResourceRefError } from '../resource/errors.js';
import type { GatewayDocument } from '../compose/types.js';
import type { CompileOptions, Provenance } from './types.js';
import { loadAppsYaml, filterGatewayApps, selectGatewayApp } from './load-config.js';
import { loadOpenApiSource } from './load-openapi.js';
import { loadAuthConfig } from './load-auth.js';
import { loadOverrides, resolveOverrideValues } from './load-overrides.js';
import { buildResourceIndex } from './resource-index.js';
import { CLIError, CompileError, IOError } from './errors.js';

process.env.SERVERLESS_TOOLS_OPENAPI_BUILD = '1';

export interface CompileResult {
  document: Record<string, unknown>;
  provenance: Map<string, Provenance>;
}

export async function compileCommand(options: CompileOptions): Promise<CompileResult> {
  const projectRoot = resolve(options.projectDir);

  const appsConfig = await loadAppsYaml(join(projectRoot, '.ycsf', 'apps.yaml'));
  const gatewayApps = filterGatewayApps(appsConfig);
  const selectedApp = selectGatewayApp(gatewayApps, options.app);
  const appPath = resolve(projectRoot, selectedApp.path);

  const { index, envMapping } = await buildResourceIndex(projectRoot);
  const functions = [...(index.entries.get('functions')?.keys() ?? [])];
  const envOnly = options.envOnly ?? (envMapping.mode === 'env-only');

  const openApi = await loadOpenApiSource(selectedApp, projectRoot, envOnly);
  const authYaml = await loadAuthConfig(appPath, openApi, functions);

  const merged = mergeDocuments([{ appId: selectedApp.id, doc: openApi }]);
  const document: GatewayDocument = {
    openapi: merged.openapi,
    info:
      openApi.info !== undefined && typeof openApi.info === 'object' && openApi.info !== null
        ? (openApi.info as Record<string, unknown>)
        : undefined,
    paths: merged.paths,
    components: merged.components,
  };

  try {
    applyAuth(document, authYaml, index);

    const resolvedOverrides = resolveOverrideValues(
      await loadOverrides(projectRoot, appPath),
      envMapping,
      index,
    );

    const localOverrides =
      resolvedOverrides.app !== null
        ? [{ appId: selectedApp.id, file: resolvedOverrides.app }]
        : [];
    applyOverrides(document, merged.ownership, resolvedOverrides.global, localOverrides);

    document.paths = sortRecordKeys(document.paths);
    if (document.components !== undefined) {
      for (const [key, value] of Object.entries(document.components)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          (document.components as Record<string, unknown>)[key] = sortRecordKeys(
            value as Record<string, unknown>,
          );
        }
      }
      document.components = sortRecordKeys(document.components as Record<string, unknown>);
    }

    const resolved = resolveReferences(
      document as unknown as Record<string, unknown>,
      envMapping,
      REFERENCE_BEARER_FIELDS,
      index,
    );

    const provenanceMap = new Map<string, Provenance>();
    for (const [path, appId] of merged.ownership.ownerByPath) {
      provenanceMap.set(path, { sourceApp: appId, sourceFile: '' });
    }

    const output = JSON.stringify(resolved, null, 2);

    if (options.output !== undefined) {
      const outputPath = resolve(options.output);
      await writeFile(outputPath, output, 'utf8');
    } else {
      process.stdout.write(output + '\n');
    }

    return { document: resolved, provenance: provenanceMap };
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ResourceRefError) {
      throw new CompileError(message, 'UNRESOLVED_RESOURCE_REF', 1);
    }
    throw new IOError(`Compile failed: ${message}`, 'COMPILE_ERROR');
  }
}