import { createDocument } from './create-document.js';

export function buildYcsfOpenApi() {
  return Promise.resolve({
    ...createDocument(),
    'x-yc-env-observed': process.env.SERVERLESS_TOOLS_OPENAPI_BUILD ?? '<unset>',
  });
}