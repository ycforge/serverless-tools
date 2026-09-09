/**
 * Standalone structural types for @ycforge/materializers-core (spec 019).
 *
 * These are structural replicas of the spec 002 contract shapes
 * (`@ycforge/pilot/contracts/materializer.ts`, `terraform.ts`, `builder.ts`)
 * with ZERO value-position imports from pilot (D-2 / Constitution I).
 * Structural conformance is pinned by the compile-time conformance test
 * `packages/pilot/test/types/materializers-core-contract.test-d.ts`.
 */

/** Channel for auto-generated outputs (IDEA §26; spec 002 structural replica). */
export interface OutputBuilder {
  declare(name: string, output: { value: string; description?: string }): void;
}

/** Context handed to every `supports`/`materialize` invocation. Contains only `output`. */
export interface MaterializationContext {
  readonly output: OutputBuilder;
}

/** A generated Terraform `resource` block (spec 002 / spec 019 D-RE-5). */
export interface TerraformResource<T = unknown> {
  readonly kind: 'resource';
  /** Provider resource type (e.g. `yandex_function`) — known to the materializer only. */
  readonly type: string;
  readonly name: string;
  /** Provider-specific schema — opaque to C and to the contracts module. */
  readonly configuration: T;
}

/** Typed artifact; `type` follows `<package-scope>:<kind>` (spec 002). */
export interface Artifact<T = unknown> {
  readonly type: string;
  readonly value: T;
}

/**
 * Materializer contract (spec 002 structural replica).
 *
 * `supports` must stay pure and cheap (selection key of dispatch phase 1).
 * `materialize` may return a single {@link TerraformResource} OR a readonly
 * array — multi-resource return is an additive contract extension (spec 019
 * research D-RE-5, e.g. bucket + storage objects).
 */
export interface Materializer<A = Artifact> {
  supports(artifact: A, context: MaterializationContext): boolean;
  materialize(artifact: A, context: MaterializationContext): Promise<TerraformResource | readonly TerraformResource[]>;
}

/** `Artifact.value` of `ycforge:function` (spec 018). */
export interface FunctionArtifactValue {
  /** Archive path relative to `infra/` (spec 019 tasks DQ-2); absolute paths are rejected. */
  readonly archivePath: string;
  readonly entryPoint: string;
}

/** `Artifact.value` of `ycforge:docker-image` — immutable digest form (spec 018). */
export interface DockerArtifactValue {
  readonly image: string; // "<repository>@sha256:<hex64>" — never a mutable tag
}

/** `Artifact.value` of `ycforge:frontend` — static build output directory (spec 018). */
export interface FrontendArtifactValue {
  readonly directory: string;
}

/** Resource reference (IDEA §33; forward contract, spec 019 D-3). */
export interface ResourceReference {
  /** Logical reference id, e.g. `functions.user_service`. */
  readonly logical: string;
  /** Terraform resource type, e.g. `yandex_function`. */
  readonly terraformType: string;
}

/** `Artifact.value` of `ycforge:api-gateway` (spec 019 D-3, forward contract; producer = Project B). */
export interface ApiGatewayArtifactValue {
  readonly specPath: string;
  readonly resourceReferences: readonly ResourceReference[];
}

/** `Artifact.value` of `ycforge:queue` (spec 019 D-3, forward contract; producer = explicit configuration). */
export interface QueueArtifactValue {
  readonly queueUrl: string;
}