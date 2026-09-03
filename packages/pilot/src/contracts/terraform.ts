/**
 * Terraform model (FR-008, FR-009; IDEA §23).
 *
 * Minimal generic representation of the blocks C may generate into
 * `.tf.json`. The contracts module deliberately does NOT model the Terraform
 * provider schema — `configuration` is opaque and only the materializer
 * knows its shape (Constitution IV).
 *
 * Every block carries a `kind` discriminant so C can type-safely serialize
 * the union (decision R-05, research.md).
 */

/** A managed `resource` block. */
export interface TerraformResource<T = unknown> {
  readonly kind: 'resource';
  /** Provider resource type (e.g. `yandex_function`) — known to the materializer only. */
  readonly type: string;
  readonly name: string;
  /** Provider-specific schema — opaque to C and to the contracts module. */
  readonly configuration: T;
}

/** A Terraform `moved` block (`.ycsf/moved.yaml` support, specs 017). */
export interface TerraformMoved {
  readonly kind: 'moved';
  readonly from: string;
  readonly to: string;
}

/** A Terraform `variable` block. */
export interface TerraformVariable {
  readonly kind: 'variable';
  readonly name: string;
  readonly configuration?: unknown;
}

/** A Terraform `data` block. */
export interface TerraformData {
  readonly kind: 'data';
  readonly type: string;
  readonly name: string;
  readonly configuration: unknown;
}

/** A generated Terraform `output` block (not to be confused with the
 * {@link OutputBuilder} declaration channel). */
export interface TerraformOutput {
  readonly kind: 'output';
  readonly name: string;
  /** Terraform expression string. */
  readonly value: string;
  readonly description?: string;
}

/**
 * The full set of blocks a materializer/C may emit. Provider schema is not
 * modeled (FR-009, Constitution IV).
 */
export type TerraformBlock =
  | TerraformResource
  | TerraformMoved
  | TerraformVariable
  | TerraformData
  | TerraformOutput;
