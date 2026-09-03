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
 */
export interface MaterializationContext {
  readonly output: OutputBuilder;
}

/**
 * Translates artifacts of the type selected by `supports` into Terraform.
 * `materialize` returns {@link TerraformResource} directly — there is no
 * intermediate abstraction layer (IDEA §22).
 */
export interface Materializer<A extends Artifact = Artifact> {
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
