// Committed CLI E2E materializer fixture: supports the `nodejs-builder`
// artifact type used by the canonical check fixture, so the CLI integration
// and quickstart scenarios can exercise dispatch hermetically (spec 021).
export default {
  supports: (a) => a.type === 'nodejs-builder',
  materialize: async (a) => ({
    kind: 'resource',
    type: 'yandex_function',
    name: a.id,
    configuration: {
      name: a.id,
      runtime: 'nodejs22',
      content: { zip_filename: `dist/${a.id}.zip` },
    },
  }),
};