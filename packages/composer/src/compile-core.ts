import type { Provenance } from './cli/types.js';
import { buildResourceIndex } from './cli/resource-index.js';
import { loadBuildConfig, loadOpenApiSourceDirect } from './cli/load-openapi.js';
import { loadAuthConfig } from './cli/load-auth.js';
import { applyAuth } from './compose/auth-apply.js';
import { applyOverrides } from './compose/overrides/apply.js';
import { mergeDocuments, sortRecordKeys } from './compose/merge.js';
import { resolveReferences, REFERENCE_BEARER_FIELDS } from './resource/index.js';
import { loadOverrides, resolveOverrideValues } from './cli/load-overrides.js';
import type { GatewayDocument } from './compose/types.js';

export interface CompileSource {
  appId: string;
  appName: string;
  appDir: string;
  openapiEntry?: string;
  envOnly?: boolean;
}

export interface CompileResult {
  document: Record<string, unknown>;
  provenance: Map<string, Provenance>;
}

let envScopeDepth = 0;
let envScopeWasSetBefore = false;

function enterEnvScope(): void {
  if (envScopeDepth === 0) {
    envScopeWasSetBefore = process.env.SERVERLESS_TOOLS_OPENAPI_BUILD === '1';
  }
  envScopeDepth += 1;
  process.env.SERVERLESS_TOOLS_OPENAPI_BUILD = '1';
}

function leaveEnvScope(): void {
  envScopeDepth -= 1;
  if (envScopeDepth > 0) {
    return;
  }
  if (envScopeWasSetBefore) {
    process.env.SERVERLESS_TOOLS_OPENAPI_BUILD = '1';
  } else {
    delete process.env.SERVERLESS_TOOLS_OPENAPI_BUILD;
  }
}

export async function compileComposition(
  source: CompileSource,
  projectRoot: string,
): Promise<CompileResult> {
  enterEnvScope();
  try {
    return await compileCompositionInner(source, projectRoot);
  } finally {
    leaveEnvScope();
  }
}

async function compileCompositionInner(
  source: CompileSource,
  projectRoot: string,
): Promise<CompileResult> {
  const { index, envMapping } = await buildResourceIndex(projectRoot);
  const functions = [...(index.entries.get('functions')?.keys() ?? [])];
  const envOnly = source.envOnly ?? (envMapping.mode === 'env-only');
  const openapiEntry =
    source.openapiEntry ?? (envOnly ? undefined : (await loadBuildConfig(source.appDir)).openapi_entry);

  const openApi = await loadOpenApiSourceDirect({
    appDir: source.appDir,
    appName: source.appName,
    envOnly,
    openapiEntry,
  });
  const authYaml = await loadAuthConfig(source.appDir, openApi, functions);

  const merged = mergeDocuments([{ appId: source.appId, doc: openApi }]);
  const document: GatewayDocument = {
    openapi: merged.openapi,
    info:
      openApi.info !== undefined && typeof openApi.info === 'object' && openApi.info !== null
        ? (openApi.info as Record<string, unknown>)
        : undefined,
    paths: merged.paths,
    components: merged.components,
  };

  applyAuth(document, authYaml, index);

  const resolvedOverrides = resolveOverrideValues(
    await loadOverrides(projectRoot, source.appDir),
    envMapping,
    index,
  );
  const localOverrides =
    resolvedOverrides.app !== null
      ? [{ appId: source.appId, file: resolvedOverrides.app }]
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

  return { document: resolved, provenance: provenanceMap };
}
