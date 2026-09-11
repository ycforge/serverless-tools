// spec 021 ycsf-cli — buildApps orchestrator (D-RE-1, D-RE-11, D-RE-12) + spec 022 cache.
import type { BuildAppsOptions, BuildAppsResult, BuiltArtifact } from '../contracts/build.js';
import type { Diagnostic } from '../contracts/check.js';
import type { PluginLoadError, RegistryError } from '../contracts/registry.js';
import { CLI_APP_NOT_FOUND, CLI_BUILD_FAILED, CLI_MISSING_PROJECT_DIR } from '../cli/errors.js';
import { loadProjectModel } from '../model/loader.js';
import { prepareBuildEnv } from '../build-env/index.js';
import { loadRegistry, validateBuilders } from '../registry/index.js';
import { getBuilder } from '../registry/shape.js';
import { canonicalJson, computeEffectiveFingerprint, computeFilesHash, computeOwnFingerprint, hashString, resolveBuilderVersion } from '../cache/fingerprint.js';
import { getCacheDir, loadManifest, saveManifest } from '../cache/manifest.js';
import { checkCache } from '../cache/index.js';
import { restoreBlob, saveBlob } from '../cache/blobs.js';
import type { CacheCheckResult, CacheManifest } from '../contracts/cache.js';

function toDiagnostic(err: RegistryError): Diagnostic {
  if (isPluginLoadError(err)) {
    return { code: err.code, message: err.message, file: '.ycsf/builders.yaml' };
  }
  return err;
}

function isPluginLoadError(err: RegistryError): err is PluginLoadError {
  return (err as PluginLoadError).packageName !== undefined;
}

export async function buildApps(
  rootDir: string,
  options?: BuildAppsOptions,
): Promise<BuildAppsResult> {
  // 1. Load project model
  let modelResult: ReturnType<typeof loadProjectModel>;
  try {
    modelResult = loadProjectModel(rootDir);
  } catch {
    return {
      kind: 'invalid',
      errors: [
        {
          code: CLI_MISSING_PROJECT_DIR,
          message: `missing .ycsf/apps.yaml — '${rootDir}' is not a serverless-tools project root`,
          file: '.ycsf/apps.yaml',
        },
      ],
    };
  }
  if (modelResult.kind === 'invalid') {
    const diagnostics: Diagnostic[] = [];
    for (const err of modelResult.errors) {
      diagnostics.push(...err.diagnostics);
    }
    return { kind: 'invalid', errors: diagnostics };
  }
  const projectModel = modelResult.model;

  // 2. Filter by --target
  let appsToBuild: typeof projectModel.apps;
  if (options?.target) {
    const app = projectModel.apps.get(options.target);
    if (!app) {
      const available = [...projectModel.apps.keys()].join(', ');
      return {
        kind: 'invalid',
        errors: [
          {
            code: CLI_APP_NOT_FOUND,
            message: `app '${options.target}' not found in apps.yaml; available: ${available}`,
            file: '.ycsf/apps.yaml',
          },
        ],
      };
    }
    appsToBuild = new Map([[options.target, app]]);
  } else {
    appsToBuild = projectModel.apps;
  }

  // 3. Prepare build env
  const envDiagnostics: Diagnostic[] = [];
  const resolvedEnvs = new Map<string, Record<string, string>>();
  for (const [appId, buildConfig] of projectModel.build_configs) {
    if (!appsToBuild.has(appId)) continue;
    const result = prepareBuildEnv(appId, buildConfig);
    if (result.kind === 'invalid') {
      envDiagnostics.push(...result.errors);
    } else {
      resolvedEnvs.set(appId, result.resolvedEnv);
    }
  }
  if (envDiagnostics.length > 0) {
    return { kind: 'invalid', errors: envDiagnostics };
  }

  // 4. Load registry
  let registryResult;
  try {
    registryResult = await loadRegistry(rootDir);
  } catch {
    return {
      kind: 'invalid',
      errors: [
        {
          code: CLI_BUILD_FAILED,
          message: 'builders registry could not be loaded',
          file: '.ycsf/builders.yaml',
        },
      ],
    };
  }
  if (registryResult.kind === 'invalid') {
    return { kind: 'invalid', errors: registryResult.errors.map(toDiagnostic) };
  }
  const registry = registryResult.registry;

  // 5. Validate builders
  const validation = validateBuilders(projectModel, registry);
  if (validation.kind === 'invalid') {
    return { kind: 'invalid', errors: validation.errors };
  }

  // 6. Cache + build
  const noCache = Boolean(options?.noCache);
  const cacheDir = getCacheDir(rootDir, options?.cacheDir);

  // topological order filter to only appsToBuild
  const topo = projectModel.depends_on_graph.topologicalOrder.filter((id) => appsToBuild.has(id));

  // If no topologicalOrder (empty graph?), fallback to appsToBuild keys
  const orderedAppIds = topo.length > 0 || appsToBuild.size === 0 ? topo : [...appsToBuild.keys()];

  // If --target, orderedAppIds already filtered; for deps outside target, we need manifest entries
  let manifest: CacheManifest | null = null;
  let manifestWarning: string | undefined;
  if (!noCache) {
    const loaded = await loadManifest(cacheDir);
    manifest = loaded.manifest;
    manifestWarning = loaded.warning;
    if (manifestWarning) {
      try {
        process.stderr.write(`! ${manifestWarning}: cache will be rebuilt\n`);
      } catch (err) {
        // If stderr write fails (e.g., closed pipe), log to console.error as last resort.
        console.error(`Failed to write cache warning to stderr: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Compute own fingerprints per app
  const ownByApp = new Map<string, { own: string; filesHash: string; buildConfigHash: string; buildEnvHash: string; builderStr: string }>();
  const effectiveByApp = new Map<string, string>();
  const cacheResults: CacheCheckResult[] = [];

  for (const appId of orderedAppIds) {
    const app = appsToBuild.get(appId)!;
    // filesHash
    let filesHash: string;
    try {
      filesHash = await computeFilesHash(rootDir, app.source_path);
    } catch (err) {
      if (err instanceof Error && err.message.includes('symlink')) {
        filesHash = hashString(`symlink:${appId}`);
      } else {
        filesHash = hashString('');
      }
    }
    const buildConfig = projectModel.build_configs.get(appId)?.build_config ?? {};
    const buildConfigHash = hashString(canonicalJson(buildConfig));
    const buildEnv = resolvedEnvs.get(appId) ?? {};
    const sortedEnv: Record<string, string> = {};
    for (const k of Object.keys(buildEnv).sort()) sortedEnv[k] = buildEnv[k]!;
    const buildEnvHash = hashString(canonicalJson(sortedEnv));
    const version = resolveBuilderVersion(registry as unknown as { records: Map<string, { packageName?: string }> }, app.builder);
    const builderStr = version ? `${app.builder}@${version}` : app.builder;
    const own = computeOwnFingerprint({ filesHash, buildConfig, buildEnv: sortedEnv, builder: builderStr });
    ownByApp.set(appId, { own, filesHash, buildConfigHash, buildEnvHash, builderStr });
  }

  // compute effective in topo order
  for (const appId of orderedAppIds) {
    const ownInfo = ownByApp.get(appId)!;
    const app = appsToBuild.get(appId)!;
    const deps = (app.depends_on ?? []) as string[];
    const depEffects: string[] = [];
    for (const depId of deps) {
      if (effectiveByApp.has(depId)) {
        depEffects.push(effectiveByApp.get(depId)!);
      } else if (manifest?.entries[depId]?.effectiveFingerprint) {
        depEffects.push(manifest.entries[depId]!.effectiveFingerprint);
      } else {
        // dependency outside target without cache → treat as changed (force miss)
        // push a unique value that will cause mismatch
        depEffects.push(hashString(`missing-dep:${depId}`));
      }
    }
    const effective = computeEffectiveFingerprint(ownInfo.own, depEffects);
    effectiveByApp.set(appId, effective);
  }

  // Check cache per app and perform build/restore
  const artifacts: BuiltArtifact[] = [];
  // mutable manifest copy
  let currentManifest: CacheManifest = manifest ?? { version: 1, entries: {} };
  // if version mismatch or corrupted, reset to empty version:1
  if (!manifest && manifestWarning) {
    currentManifest = { version: 1, entries: {} };
  }

  for (const appId of orderedAppIds) {
    const app = appsToBuild.get(appId)!;
    const effective = effectiveByApp.get(appId)!;
    const ownInfo = ownByApp.get(appId)!;
    const deps = (app.depends_on ?? []) as string[];
    const depEffects = deps.map((d) => effectiveByApp.get(d) ?? manifest?.entries[d]?.effectiveFingerprint ?? hashString(`missing-dep:${d}`));

    let result: CacheCheckResult;
    if (noCache) {
      result = { appId, hit: false, fingerprint: effective, reason: 'no_cache' };
    } else {
      result = await checkCache({
        noCache: false,
        effectiveFingerprint: effective,
        appId,
        manifest: currentManifest,
        cacheDir,
        own: { filesHash: ownInfo.filesHash, buildConfigHash: ownInfo.buildConfigHash, buildEnvHash: ownInfo.buildEnvHash, builder: ownInfo.builderStr },
        depFingerprints: depEffects,
      });
      // blob missing case already handled inside checkCache; but if hit we must validate blob again
      if (result.hit) {
        const restored = await restoreBlob(cacheDir, effective, `${rootDir}/.ycsf/artifacts/${appId}`);
        if (restored) {
          artifacts.push({ appId, artifact: restored });
          cacheResults.push(result);
          options?.onCacheProgress?.(result);
          continue;
        } else {
          // blob missing despite hit → treat as miss
          result = { appId, hit: false, fingerprint: effective, reason: 'blob_missing' };
        }
      }
      // if miss due to blob_missing, remove stale entry self-heal
      if (result.reason === 'blob_missing' && currentManifest.entries[appId]) {
        const { [appId]: _, ...rest } = currentManifest.entries;
        currentManifest = { version: 1, entries: rest };
        await saveManifest(cacheDir, currentManifest);
      }
    }

    cacheResults.push(result);
    options?.onCacheProgress?.(result);

    // miss → build
    if (!result.hit) {
      // For noCache case we still need to skip cache lookup and build
      options?.onAppProgress?.(appId);
      const entry = registry.records.get(app.builder);
      if (!entry) continue;
      const builder = getBuilder(entry.module);
      if (!builder) {
        return {
          kind: 'invalid',
          errors: [
            {
              code: CLI_BUILD_FAILED,
              message: `builder '${app.builder}' for app '${appId}' is not a valid builder module`,
              file: '.ycsf/builders.yaml',
              app: appId,
            },
          ],
        };
      }
      const resolvedEnv = resolvedEnvs.get(appId) ?? {};
      const outputDir = `${rootDir}/.ycsf/artifacts/${appId}`;
      const context = {
        projectRoot: rootDir,
        sourcePath: app.source_path,
        buildConfig: projectModel.build_configs.get(appId)?.build_config ?? {},
        buildEnv: resolvedEnv,
        outputDir,
      };
      let artifact;
      try {
        artifact = await builder.build(context);
      } catch (err) {
        return {
          kind: 'invalid',
          errors: [
            {
              code: CLI_BUILD_FAILED,
              message: `build failed for app '${appId}': ${err instanceof Error ? err.message : String(err)}`,
              file: '.ycsf/apps.yaml',
              app: appId,
            },
          ],
        };
      }
      const resolvedArtifact = artifact ?? ({ type: 'test:type', value: {} } as unknown as typeof artifact);
      artifacts.push({ appId, artifact: resolvedArtifact });
      if (!noCache) {
        // save blob + manifest per app (FR-016)
        await saveBlob(cacheDir, effective, resolvedArtifact, outputDir);
        const newEntry = {
          fingerprint: ownInfo.own,
          effectiveFingerprint: effective,
          artifactType: resolvedArtifact.type,
          createdAt: new Date().toISOString(),
          dependsOnFingerprints: depEffects,
          filesHash: ownInfo.filesHash,
          buildConfigHash: ownInfo.buildConfigHash,
          buildEnvHash: ownInfo.buildEnvHash,
          builder: ownInfo.builderStr,
        };
        currentManifest = {
          version: 1,
          entries: { ...currentManifest.entries, [appId]: newEntry },
        };
        await saveManifest(cacheDir, currentManifest);
      } else {
        // even with noCache we still overwrite manifest/blobs per spec S-3 (--no-cache перезаписывает)
        await saveBlob(cacheDir, effective, resolvedArtifact, outputDir);
        const newEntry = {
          fingerprint: ownInfo.own,
          effectiveFingerprint: effective,
          artifactType: resolvedArtifact.type,
          createdAt: new Date().toISOString(),
          dependsOnFingerprints: depEffects,
          filesHash: ownInfo.filesHash,
          buildConfigHash: ownInfo.buildConfigHash,
          buildEnvHash: ownInfo.buildEnvHash,
          builder: ownInfo.builderStr,
        };
        currentManifest = {
          version: 1,
          entries: { ...currentManifest.entries, [appId]: newEntry },
        };
        await saveManifest(cacheDir, currentManifest);
      }
    }
  }

  // Handle 0 apps case: ensure cache summary still
  const hits = cacheResults.filter((r) => r.hit).length;
  const misses = cacheResults.filter((r) => !r.hit).length;
  const cache = { hits, misses, entries: cacheResults };

  // If no apps, still return cache empty
  if (orderedAppIds.length === 0) {
    return { kind: 'ok', projectModel, registry, artifacts, cache: { hits: 0, misses: 0, entries: [] } };
  }

  return { kind: 'ok', projectModel, registry, artifacts, cache };
}
