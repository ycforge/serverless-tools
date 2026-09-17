// Committed materializer fixture: supports `vite`, materialize always throws.
export default {
  supports: (a) => a.type === 'vite',
  materialize: async () => {
    throw new Error('plugin crashed');
  },
};