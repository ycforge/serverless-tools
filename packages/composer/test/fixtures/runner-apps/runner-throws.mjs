export function buildYcsfOpenApi() {
  process.stderr.write('user app: SERVERLESS_TOOLS_RUNNER:LOAD is just a string I log\n');
  process.stderr.write('SERVERLESS_TOOLS_RUNNER:INVALID\n');
  return Promise.reject(new Error('boom: provider init failed with token=Bearer SUPER-SECRET-xyz'));
}