import { createDocument } from './create-document.js';

export function buildYcsfOpenApi() {
  console.log(`user app: building openapi in ${process.cwd()} (mode=${process.env.SERVERLESS_TOOLS_OPENAPI_BUILD})`);
  process.stderr.write('user app: trivial warning\n');
  return Promise.resolve({
    ...createDocument(),
    'x-yc-env-observed': process.env.SERVERLESS_TOOLS_OPENAPI_BUILD ?? '<unset>',
  });
}