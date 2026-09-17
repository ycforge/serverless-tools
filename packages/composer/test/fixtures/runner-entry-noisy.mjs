process.stdout.write('NOISY-MARKER-STDOUT\n');
process.stderr.write('NOISY-MARKER-STDERR\n');

export function buildYcsfOpenApi() {
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: 'runner-entry-noisy', version: '1.0.0' },
    paths: {},
    'x-markers': 'present',
  });
}