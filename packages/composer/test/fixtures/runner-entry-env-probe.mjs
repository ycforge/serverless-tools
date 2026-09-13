export function buildYcsfOpenApi() {
  const observed = process.env.SERVERLESS_TOOLS_OPENAPI_BUILD ?? '<unset>';
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: `runner-entry-env-probe-${observed}`, version: '1.0.0' },
    paths: {},
  });
}