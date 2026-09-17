export default {
  build: async (context) => ({
    type: 'ycforge:function',
    value: { archivePath: context.outputDir, entryPoint: 'index.handler' },
  }),
};