import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FrontendArtifactValue, MaterializationContext, Materializer, TerraformResource } from '../types.js';
import { YMT_EMPTY_DIRECTORY, YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { isTfAddress, sanitizeFilename } from '../helpers/filename.js';

function listFilesRecursive(dir: string, base = ''): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = base === '' ? entry.name : `${base}/${entry.name}`;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

const materializer: Materializer = {
  supports(artifact, _context: MaterializationContext): boolean {
    return artifact.type === 'ycforge:frontend';
  },
  async materialize(artifact, context) {
    const value = artifact.value as FrontendArtifactValue;
    const { directory } = value;

    if (!directory) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: directory');
    }

    const resolvedDir = resolve(directory);
    const relativeFiles = listFilesRecursive(resolvedDir).sort();

    if (typeof artifact.name !== 'string' || !isTfAddress(artifact.name)) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: name (stable app identity)');
    }
    const name = artifact.name;
    const resources: TerraformResource[] = [];

    resources.push({
      kind: 'resource',
      type: 'yandex_storage_bucket',
      name,
      configuration: {
        bucket: name,
        acl: 'public-read',
      },
    });

    if (relativeFiles.length === 0) {
      context.output.declare(`${name}_bucket_id`, {
        value: `yandex_storage_bucket.${name}.id`,
        description: YMT_EMPTY_DIRECTORY,
      });
      return resources;
    }

    for (const relativePath of relativeFiles) {
      const sanitized = sanitizeFilename(relativePath);
      resources.push({
        kind: 'resource',
        type: 'yandex_storage_object',
        name: `${name}_${sanitized}`,
        configuration: {
          bucket: `yandex_storage_bucket.${name}.id`,
          key: relativePath,
          source: join(resolvedDir, relativePath),
        },
      });
    }

    context.output.declare(`${name}_bucket_id`, {
      value: `yandex_storage_bucket.${name}.id`,
    });

    return resources;
  },
};

export default materializer;