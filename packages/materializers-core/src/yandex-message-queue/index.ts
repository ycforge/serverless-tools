import type { Artifact, MaterializationContext, Materializer, QueueArtifactValue, TerraformResource } from '../types.js';
import { YMT_INVALID_ARTIFACT_VALUE, YMT_INVALID_QUEUE_URL, materializerError } from '../diagnostics.js';

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

    const queuesIdx = parsed.pathname.indexOf('/queues/');
    if (queuesIdx === -1) {
      throw materializerError(YMT_INVALID_QUEUE_URL, `invalid queueUrl format: ${queueUrl}`);
    }

    const afterQueues = parsed.pathname.slice(queuesIdx + '/queues/'.length);
    const queueName = afterQueues.split('/')[0];

    if (!queueName) {
      throw materializerError(YMT_INVALID_QUEUE_URL, `invalid queueUrl format: ${queueUrl}`);
    }

    const name = (artifact as { name?: string }).name ?? 'unknown';

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