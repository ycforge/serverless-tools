/**
 * docker builder (FR-009..FR-013): shells out to the Docker CLI
 * (build → push → digest), returns the immutable digest-form Artifact.
 */

import { assertNoResidualEnv, requireSourcePath } from '../preflight.js';
import type { Artifact, Builder, BuildContext, DockerArtifactValue } from '../types.js';
import { buildAndPush } from './cli.js';
import { parseDockerConfig } from './config.js';

const builder = {
  async build(context: BuildContext): Promise<Artifact<DockerArtifactValue>> {
    const sourcePath = requireSourcePath(context, 'docker');
    assertNoResidualEnv(context, 'docker');
    const config = parseDockerConfig(context.buildConfig);
    const digest = await buildAndPush({
      sourcePath,
      repository: config.repository,
      tag: config.tag,
      dockerfile: config.dockerfile,
    });
    return { type: 'ycforge:docker-image', value: { image: `${config.repository}@${digest}` } };
  },
} satisfies Builder;

export default builder;