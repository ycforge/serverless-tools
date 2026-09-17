// Committed CLI E2E builder fixture: a minimal healthy Builder that never
// touches the filesystem, so CLI integration tests can run the whole
// build → materialize → terraform pipeline hermetically (spec 021).
export default {
  build: async (context) => ({
    type: 'nestjs-function',
    name: context.sourcePath,
    value: { archivePath: `dist/${context.sourcePath}.zip`, entryPoint: 'index.handler' },
  }),
};