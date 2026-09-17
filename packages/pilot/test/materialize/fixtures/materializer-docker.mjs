// Committed materializer fixture: supports `docker`, returns `yandex_container`.
export default {
  supports: (a) => a.type === 'docker',
  materialize: async (a) => ({
    kind: 'resource',
    type: 'yandex_container',
    name: a.id,
    configuration: { name: a.id, image: `registry.example.com/${a.id}` },
  }),
};