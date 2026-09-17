export default {
  supports: (descriptor) => descriptor.type === 'ycforge:queue',
  materialize: async (artifact) => ({
    kind: 'resource',
    type: 'yandex_message_queue',
    name: artifact.name,
    configuration: { queue_url: 'https://queue.api.cloud.yandex.net/b1/queues/q' },
  }),
};