/**
 * Public plugin contracts of `@ycforge/pilot` (Project C).
 *
 * This barrel is the SINGLE public entry point of the contracts module
 * (FR-020). Anything not re-exported here is an internal module of the pilot
 * package and not part of the public contract.
 */
export * from './diagnostic.js';
export * from './version.js';
export * from './builder.js';
export * from './terraform.js';
export * from './materializer.js';
export * from './artifact-type.js';
export * from './resource-reference.js';
export * from './project-model.js';
export * from './build-env.js';
export * from './registry.js';
