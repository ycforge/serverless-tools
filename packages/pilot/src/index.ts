// Internal entry point of @ycforge/pilot (Project C orchestration runtime).
// Not part of the public contract — plugin authors must use
// `@ycforge/pilot/contracts` only.

export { loadProjectModel } from './model/loader.js';
export type { ProjectModelLoadResult } from './contracts/index.js';
