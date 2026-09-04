export function buildYcsfOpenApi() {
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: 'app-convention', version: '1.0.0' },
    paths: {
      '/search': {
        get: { responses: { '200': { description: 'ok' } } },
      },
    },
    'x-yc-env-observed': process.env.SERVERLESS_TOOLS_OPENAPI_BUILD ?? '<unset>',
  });
}