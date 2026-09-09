import { isAbsolute } from 'node:path';
import type { Artifact, FunctionArtifactValue, MaterializationContext, Materializer, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { sha256Hex } from './hash.js';

const materializer: Materializer = {
  supports(artifact, _context: MaterializationContext): boolean {
    return artifact.type === 'ycforge:function';
  },
  async materialize(artifact, context) {
    const value = artifact.value as FunctionArtifactValue;
    const { archivePath, entryPoint } = value;

    if (!archivePath || !entryPoint) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: archivePath or entryPoint');
    }

    if (isAbsolute(archivePath)) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'archivePath must be relative, not absolute');
    }

    const userHash = await sha256Hex(archivePath);

    const name = (artifact as { name?: string }).name ?? 'unknown';

    const resource: TerraformResource = {
      kind: 'resource',
      type: 'yandex_function',
      name,
      configuration: {
        runtime: 'nodejs22',
        entrypoint: entryPoint,
        user_hash: userHash,
        content: {
          zip_filename: archivePath,
        },
      },
    };

    context.output.declare(`${name}_function_id`, {
      value: `yandex_function.${name}.id`,
    });

    return resource;
  },
};

export default materializer;