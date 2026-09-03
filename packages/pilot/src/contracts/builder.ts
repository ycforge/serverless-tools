/**
 * Builder contract (FR-001..FR-004, IDEA §7).
 *
 * A builder turns one app source unit into exactly one {@link Artifact} per
 * `build` invocation. It must not know any Project C internals (FR-015): the
 * context carries only plain data, and `buildConfig` stays opaque to C.
 */

/**
 * Input of a single build invocation.
 *
 * - `projectRoot` — root of the user project (a builder reads its own
 *   configuration, e.g. `.ycsf/apps.yaml`, from here; IDEA §9).
 * - `sourcePath` — optional path of the app source; a builder must work
 *   without it, reading configuration from `projectRoot`.
 * - `buildConfig` — app-level build configuration; opaque to C.
 * - `buildEnv` — resolved build-time environment variables.
 * - `outputDir` — directory the builder writes build output into.
 */
export interface BuildContext {
  readonly projectRoot: string;
  readonly sourcePath?: string;
  readonly buildConfig: unknown;
  readonly buildEnv: Record<string, string>;
  readonly outputDir: string;
}

/**
 * Typed build result. `type` is the dispatch key for materializers and must
 * follow the `<package-scope>:<kind>` convention (see {@link isArtifactType});
 * `value` is opaque to C (FR-003) — only the matching materializer
 * interprets it.
 */
export interface Artifact<T = unknown> {
  readonly type: string;
  readonly value: T;
}

/**
 * A single `build` invocation returns exactly one Artifact (FR-001).
 * Returning multiple artifacts requires multiple invocations.
 */
export interface Builder {
  build(context: BuildContext): Promise<Artifact>;
}
