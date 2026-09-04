export function buildYcsfOpenApi() {
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: 'runner-ok', version: '1.0.0' },
    paths: {},
    'x-env-observed': process.env.SERVERLESS_TOOLS_OPENAPI_BUILD ?? '<unset>',
  });
}