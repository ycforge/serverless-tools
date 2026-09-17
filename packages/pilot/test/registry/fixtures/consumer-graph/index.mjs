export default {
  supports: () => false,
  materialize: async () => {
    throw new Error('unused');
  },
};