import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Artifact, FrontendArtifactValue, MaterializationContext, Materializer, TerraformResource } from '../types.js';
import { YMT_EMPTY_DIRECTORY, YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { sanitizeFilename } from '../helpers/filename.js';

function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
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
    const allFiles = listFilesRecursive(resolvedDir).sort();

    const name = (artifact as { name?: string }).name ?? 'unknown';
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

    if (allFiles.length === 0) {
      context.output.declare(`${name}_bucket_id`, {
        value: `yandex_storage_bucket.${name}.id`,
        description: YMT_EMPTY_DIRECTORY,
      });
      return resources;
    }

    for (const filePath of allFiles) {
      const basename = filePath.split('/').pop()!;
      const sanitized = sanitizeFilename(basename);
      resources.push({
        kind: 'resource',
        type: 'yandex_storage_object',
        name: `${name}_${sanitized}`,
        configuration: {
          bucket: `yandex_storage_bucket.${name}.id`,
          key: basename,
          source: filePath,
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