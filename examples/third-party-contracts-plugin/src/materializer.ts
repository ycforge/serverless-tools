// Reference third-party materializer (User Story 2): implements the
// Materializer contract importing ONLY `@ycforge/pilot/contracts`.
import type {
  Artifact,
  Materializer,
  TerraformResource,
} from '@ycforge/pilot/contracts';

export interface FunctionArtifactValue {
  archivePath: string;
  entryPoint: string;
}

export const functionMaterializer: Materializer<Artifact<FunctionArtifactValue>> = {
  supports(artifact: Artifact): boolean {
    return artifact.type === 'ycforge:function';
  },

  async materialize(artifact: Artifact<FunctionArtifactValue>): Promise<TerraformResource> {
    // The materializer may publish auto-generated outputs; `value` is a
    // Terraform expression WITHOUT the `${...}` wrapper (FR-007).
    return {
      kind: 'resource',
      type: 'yandex_function',
      name: 'user_service',
      configuration: {
        entrypoint: artifact.value.entryPoint,
        artifacts: [{ type: 'zip', path: artifact.value.archivePath }],
      },
    };
  },

  // output.declare is called by C-provided MaterializationContext at
  // materialization time; see the unit test in packages/pilot for the
  // captured-declare behavior.
};
