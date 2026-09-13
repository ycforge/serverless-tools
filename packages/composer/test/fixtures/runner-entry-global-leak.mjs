globalThis['__YCSF_PARENT_LEAK__'] = 'leaked';

export function buildYcsfOpenApi() {
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: 'runner-entry-global-leak', version: '1.0.0' },
    paths: {},
  });
}