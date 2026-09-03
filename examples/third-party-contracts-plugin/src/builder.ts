// Reference third-party builder (User Story 1): implements the Builder
// contract importing ONLY `@ycforge/pilot/contracts` — no other package of
// the serverless-tools monorepo is needed.
import type { Artifact, BuildContext, Builder } from '@ycforge/pilot/contracts';

export interface FunctionArtifactValue {
  archivePath: string;
  entryPoint: string;
}

export const functionBuilder: Builder = {
  async build(context: BuildContext): Promise<Artifact<FunctionArtifactValue>> {
    // A real builder would bundle sources from `context.projectRoot` (or
    // `context.sourcePath` when present) into `context.outputDir`.
    void context;
    return {
      type: 'ycforge:function',
      value: {
        archivePath: `${context.outputDir}/function.zip`,
        entryPoint: 'index.handler',
      },
    };
  },
};
