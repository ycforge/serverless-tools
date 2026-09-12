import { mkdir, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import type { Artifact, BuildContext } from '@ycforge/pilot/contracts';

import { compileComposition, type CompileSource } from '../compile-core.js';
import { OPENAPI_BUILD_FILENAME, ARTIFACT_TYPE, collectResourceReferences } from './artifact.js';
import type { ApiGatewayArtifactValue } from './artifact.js';
import { BuilderError, toBuilderError, type BuilderErrorContext } from './errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contextOf(outputDir: string, sourcePath: string): BuilderErrorContext {
  return {
    appId: basename(resolve(outputDir)),
    sourcePath,
    artifactType: ARTIFACT_TYPE,
  };
}

/**
 * Wrapper-first normalization of the app build configuration (T023/T066 note):
 * pilot passes the project-model record directly (inner `{ openapi_entry }`),
 * while the pilot wrapper form carries `{ build_config: { openapi_entry } }`.
 * Both are honored; a non-string entry fails fast.
 */
function resolveOpenapiEntry(buildConfig: unknown): string | undefined {
  if (!isRecord(buildConfig)) {
    return undefined;
  }
  const inner = isRecord(buildConfig.build_config) ? buildConfig.build_config : buildConfig;
  const entry = inner.openapi_entry;
  if (entry === undefined) {
    return undefined;
  }
  if (typeof entry !== 'string') {
    throw new BuilderError('OPENAPI_ENTRY_INVALID', 'openapi_entry must be a string', {
      appId: '',
      sourcePath: '',
      artifactType: ARTIFACT_TYPE,
    });
  }
  return entry;
}

export function deriveCompileSource(context: BuildContext): CompileSource {
  const appId = basename(resolve(context.outputDir));
  const appDir = context.sourcePath === undefined ? undefined : resolve(context.sourcePath);
  if (appDir === undefined) {
    throw new BuilderError(
      'SOURCE_PATH_MISSING',
      'sourcePath is required for ycforge:api-gateway builds',
      contextOf(context.outputDir, ''),
    );
  }
  return {
    appId,
    appName: appId,
    appDir,
    openapiEntry: resolveOpenapiEntry(context.buildConfig),
  };
}

async function ensureSourceDirectory(sourcePath: string, context: BuildContext): Promise<void> {
  try {
    const info = await stat(sourcePath);
    if (!info.isDirectory()) {
      throw new BuilderError(
        'SOURCE_PATH_INVALID',
        `sourcePath is not a directory: ${sourcePath}`,
        contextOf(context.outputDir, sourcePath),
      );
    }
  } catch (error) {
    if (error instanceof BuilderError) {
      throw error;
    }
    throw new BuilderError(
      'SOURCE_PATH_INVALID',
      `sourcePath does not exist: ${sourcePath}`,
      contextOf(context.outputDir, sourcePath),
    );
  }
}

export async function build(context: BuildContext): Promise<Artifact<ApiGatewayArtifactValue>> {
  const source = deriveCompileSource(context);
  await ensureSourceDirectory(source.appDir, context);

  try {
    const { document } = await compileComposition(source, context.projectRoot);
    const resourceReferences = collectResourceReferences(document);

    const outputDir = isAbsolute(context.outputDir) ? context.outputDir : resolve(context.outputDir);
    await mkdir(outputDir, { recursive: true });
    const specPath = resolve(outputDir, OPENAPI_BUILD_FILENAME);
    await writeFile(specPath, JSON.stringify(document, null, 2), 'utf8');

    return { type: ARTIFACT_TYPE, value: { specPath, resourceReferences } };
  } catch (error) {
    throw toBuilderError(error, contextOf(context.outputDir, source.appDir));
  }
}

const builder = { build };

export default builder;