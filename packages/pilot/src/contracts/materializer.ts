import type { Artifact } from './builder.js';
import type { TerraformResource } from './terraform.js';

/**
 * Materializer contract (FR-005..FR-007; IDEA §22).
 *
 * A materializer translates exactly the artifacts it selects via
 * {@link Materializer.supports} into Terraform resources. Dispatch and
 * collision detection live in Project C — the contract only requires a
 * synchronous boolean `supports` so C can detect collisions (two
 * materializers claiming the same artifact type) BEFORE calling
 * `materialize` (FR-014).
 */

/**
 * Channel for auto-generated outputs (IDEA §26).
 *
 * `value` is a Terraform expression string WITHOUT the `${...}` wrapper;
 * wrapping during `.tf.json` serialization is Project C's responsibility.
 *
 * Documented collision semantics (enforcement is implemented by C): an
 * output name is declared exactly once — a duplicate `declare` is an error,
 * never a silent merge (FR-007, Constitution V).
 */
export interface OutputBuilder {
  declare(name: string, output: { value: string; description?: string }): void;
}

/**
 * Context of materialization. Clarified 2026-09-03: the context contains
 * ONLY `output` — a materializer is a pure translation artifact →
 * TerraformResource and reads nothing from the project itself.
 *
 * Spec 028 (plan D-2): `projectRoot` is an additive/optional root of the
 * pipeline run. Materializers that write companion files next to the
 * infrastructure (e.g. the api-gateway OpenAPI companion) use it to make the
 * write root-relative (`<rootDir>/infra/generated/`) instead of
 * cwd-dependent. Legacy materializers that receive none keep their
 * historical behavior.
 */
export interface MaterializationContext {
  readonly output: OutputBuilder;
  readonly projectRoot?: string;
}

/**
 * Translates artifacts of the type selected by `supports` into Terraform.
 * `materialize` returns {@link TerraformResource} directly — there is no
 * intermediate abstraction layer (IDEA §22).
 */
export interface Materializer<A = Artifact> {
  /**
   * Synchronous selection by `artifact.type` (and anything else the
   * materializer considers). Must stay pure and cheap: C calls it for every
   * registered materializer per artifact.
   */
  supports(artifact: A, context: MaterializationContext): boolean;

  /**
   * Translates the artifact into a Terraform resource. May declare
   * auto-generated outputs via `context.output`.
   */
  materialize(artifact: A, context: MaterializationContext): Promise<TerraformResource>;
}
