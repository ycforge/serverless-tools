// Committed materializer fixture: supports `nestjs-function` and declares
// output `url` via `context.output.declare` (quickstart Sc12).
export default {
  supports: (a) => a.type === 'nestjs-function',
  materialize: async (a, ctx) => {
    ctx.output.declare('url', { value: `function_url(${a.id})`, description: 'URL' });
    return { kind: 'resource', type: 'yandex_function', name: a.id, configuration: { name: a.id } };
  },
};