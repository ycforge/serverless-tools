// spec 015 extensions — internal runtime barrel. Public API re-export happens
// from `src/index.ts`, NOT package.json subpaths.

export * from './errors.js';
export * from './idl.js';
export * from './deep-merge.js';
export * from './extensions-yaml.js';
export * from './apply.js';
export * from './loader.js';