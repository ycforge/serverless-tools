/**
 * Current version of the plugin API contracts (FR-018).
 *
 * This is the plugin-API line only: `CONTRACT_VERSION` equals the semver major
 * of the `@ycforge/pilot` package and is bumped on any breaking change of
 * Builder/Materializer/Artifact contracts (major release + migration guide).
 * The `.ycsf/*.yaml` format line (`version: 1`) is versioned independently and
 * is NOT represented here (clarification 2026-09-03).
 */
export const CONTRACT_VERSION = 1 as const;
