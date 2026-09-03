/**
 * Artifact type convention (FR-004; IDEA §8).
 *
 * Artifact types follow `<package-scope>:<kind>` (e.g. `ycforge:function`,
 * `ycforge:api-gateway`) so third-party plugins do not conflict over global
 * strings. The contracts module documents the convention and provides a
 * pure predicate; ENFORCEMENT (error on violation at `ycsf check` or
 * dispatch time) is Project C's zone.
 */

/**
 * Grammar: lowercase npm-scope-style segment, colon, lowercase kind segment.
 * Hyphens are allowed (`api-gateway`), underscores and uppercase are not.
 */
export const ARTIFACT_TYPE_PATTERN: RegExp = Object.freeze(
  /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/,
);

/**
 * Pure predicate: does `value` follow the `<package-scope>:<kind>`
 * convention? Never throws.
 */
export function isArtifactType(value: string): boolean {
  return ARTIFACT_TYPE_PATTERN.test(value);
}
