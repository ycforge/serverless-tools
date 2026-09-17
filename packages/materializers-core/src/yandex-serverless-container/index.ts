import type { DockerArtifactValue, MaterializationContext, Materializer, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, materializerError } from '../diagnostics.js';
import { isTfAddress, toYcResourceName } from '../helpers/filename.js';

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

    // YC Serverless Containers require memory >= 128 MB (aligned to 128 MB;
    // the provider rejects anything below 134217728 bytes).
    const resource: TerraformResource = {
      kind: 'resource',
      type: 'yandex_serverless_container',
      name,
      configuration: {
        image: [{ url: image }],
        name: toYcResourceName(name),
        memory: 128,
      },
    };

    context.output.declare(`${name}_container_id`, {
      value: `yandex_serverless_container.${name}.id`,
    });

    return resource;
  },
};

export default materializer;