import type { MaterializationContext, Materializer, QueueArtifactValue, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, YMT_INVALID_QUEUE_URL, materializerError } from '../diagnostics.js';
import { isTfAddress } from '../helpers/filename.js';

const materializer: Materializer = {
  supports(artifact, _context: MaterializationContext): boolean {
    return artifact.type === 'ycforge:queue';
  },
  async materialize(artifact, context) {
    const value = artifact.value as QueueArtifactValue;
    const { queueUrl } = value;

    if (!queueUrl) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: queueUrl');
    }

    let parsed: URL;
    try {
      parsed = new URL(queueUrl);
    } catch {
      throw materializerError(YMT_INVALID_QUEUE_URL, `invalid queueUrl format: ${queueUrl}`);
    }

    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const queuesIdx = segments.lastIndexOf('queues');
    const queueName =
      queuesIdx !== -1 && queuesIdx < segments.length - 1
        ? segments[queuesIdx + 1]
        : segments.length >= 2
          ? segments[segments.length - 1]
          : undefined;

    if (!queueName) {
      throw materializerError(YMT_INVALID_QUEUE_URL, `invalid queueUrl format: ${queueUrl}`);
    }

    if (typeof artifact.name !== 'string' || !isTfAddress(artifact.name)) {
      throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing required field: name (stable app identity)');
    }
    const name = artifact.name;

    const resource: TerraformResource = {
      kind: 'resource',
      type: 'yandex_message_queue',
      name,
      configuration: {
        queue_name: queueName,
        region: 'ru-central1',
      },
    };

    context.output.declare(`${name}_queue_id`, {
      value: `yandex_message_queue.${name}.id`,
    });

    return resource;
  },
};

export default materializer;