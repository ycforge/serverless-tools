// Committed materializer fixture: supports `nestjs-function`, returns a
// canned `yandex_function` (quickstart matMockNest analogue).
export default {
  supports: (a) => a.type === 'nestjs-function',
  materialize: async (a) => ({
    kind: 'resource',
    type: 'yandex_function',
    name: a.id,
    configuration: { name: a.id, runtime: 'nodejs20', content: { source: `dist/${a.id}.zip` } },
  }),
};