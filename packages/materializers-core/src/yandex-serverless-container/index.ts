import type { DockerArtifactValue, MaterializationContext, Materializer, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { isTfAddress } from '../helpers/filename.js';

const materializer: Materializer = {
  supports(artifact, _context: MaterializationContext): boolean {
    return artifact.type === 'ycforge:docker-image';
  },
  async materialize(artifact, context) {
    const value = artifact.value as DockerArtifactValue;
    const { image } = value;

    if (!image) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: image');
    }

    if (typeof artifact.name !== 'string' || !isTfAddress(artifact.name)) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: name (stable app identity)');
    }
    const name = artifact.name;

    const resource: TerraformResource = {
      kind: 'resource',
      type: 'yandex_serverless_container',
      name,
      configuration: {
        image,
        name,
      },
    };

    context.output.declare(`${name}_container_id`, {
      value: `yandex_serverless_container.${name}.id`,
    });

    return resource;
  },
};

export default materializer;