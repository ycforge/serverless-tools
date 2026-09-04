import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { OpenApiExtractError, type ExtractOptions, type ExtractionRequest, type OpenApiDocument } from './errors.js';
import { readOpenApiArtifact } from './artifacts.js';
import { spawnRunner } from './runner/spawn-runner.js';

export const NO_SOURCE_MESSAGE =
  'Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.';

export async function extractOpenApi(
  request: ExtractionRequest,
  options?: ExtractOptions,
): Promise<OpenApiDocument> {
  const timeoutMs = options?.timeoutMs ?? 30000;
  const appRoot = resolve(request.appRoot);

  if (request.openapiEntry !== undefined) {
    const entryPath = resolve(appRoot, request.openapiEntry);
    return spawnRunner(appRoot, entryPath, timeoutMs);
  }

  const artifact = await readOpenApiArtifact(appRoot);
  if (artifact !== null) {
    return artifact;
  }

  const conventionEntry = join(appRoot, 'dist', 'main');
  if (existsSync(conventionEntry)) {
    return spawnRunner(appRoot, conventionEntry, timeoutMs);
  }

  throw new OpenApiExtractError('NO_SOURCE', NO_SOURCE_MESSAGE);
}