import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { OpenApiExtractError, type OpenApiDocument } from './errors.js';

export function isOpenApiDocument(value: unknown): value is OpenApiDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const doc = value as Record<string, unknown>;
  return (
    typeof doc['openapi'] === 'string' &&
    (doc['openapi'] as string).length > 0 &&
    typeof doc['paths'] === 'object' &&
    doc['paths'] !== null &&
    !Array.isArray(doc['paths'])
  );
}

export async function readOpenApiArtifact(appRoot: string): Promise<OpenApiDocument | null> {
  for (const name of ['swagger.json', 'openapi.json']) {
    const file = join(appRoot, name);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw new OpenApiExtractError('INVALID_ARTIFACT', `Artifact ${file} exists but could not be read`, {
        sourcePath: file,
        cause: err,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new OpenApiExtractError('INVALID_ARTIFACT', `Artifact ${file} is not valid JSON`, {
        sourcePath: file,
        cause: err,
      });
    }
    if (!isOpenApiDocument(parsed)) {
      throw new OpenApiExtractError(
        'INVALID_ARTIFACT',
        `Artifact ${file} is not an OpenAPI document (expected object with string 'openapi' and object 'paths')`,
        { sourcePath: file },
      );
    }
    return parsed;
  }
  return null;
}