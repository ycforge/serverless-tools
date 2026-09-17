export function buildYcsfOpenApi() {
  console.log('user app: loading cached data');
  process.stderr.write('user app: brief warning\n');
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: 'runner-console-log', version: '1.0.0' },
    paths: {},
  });
}