import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readOpenApiArtifact } from './artifacts.js';
import { OpenApiExtractError } from './errors.js';

const VALID_SWAGGER = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'artifact', version: '1.0.0' },
  paths: { '/ping': { get: {} } },
});

const OTHER_OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'artifact-openapi', version: '1.0.0' },
  paths: { '/other': { get: {} } },
});

function tempApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yc-composer-artifacts-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('artifacts', () => {
  it('reads a valid swagger.json', async () => {
    const dir = tempApp({ 'swagger.json': VALID_SWAGGER });
    try {
      const doc = await readOpenApiArtifact(dir);
      expect(doc?.info).toEqual({ title: 'artifact', version: '1.0.0' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers swagger.json over openapi.json when both exist', async () => {
    const dir = tempApp({
      'swagger.json': VALID_SWAGGER,
      'openapi.json': OTHER_OPENAPI,
    });
    try {
      const doc = await readOpenApiArtifact(dir);
      expect(doc?.info).toEqual({ title: 'artifact', version: '1.0.0' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when neither artifact exists', async () => {
    const dir = tempApp({});
    try {
      await expect(readOpenApiArtifact(dir)).resolves.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects with INVALID_ARTIFACT for broken JSON, carrying the file path', async () => {
    const dir = tempApp({ 'swagger.json': '{ not json' });
    try {
      await expect(readOpenApiArtifact(dir)).rejects.toMatchObject({
        code: 'INVALID_ARTIFACT',
        sourcePath: join(dir, 'swagger.json'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects with INVALID_ARTIFACT when JSON is not an OpenAPI shape (string openapi / object paths)', async () => {
    const dir = tempApp({
      'swagger.json': JSON.stringify({ openapi: 42, paths: true }),
    });
    try {
      await expect(readOpenApiArtifact(dir)).rejects.toSatisfy(
        (err: unknown) => err instanceof OpenApiExtractError && err.code === 'INVALID_ARTIFACT',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});