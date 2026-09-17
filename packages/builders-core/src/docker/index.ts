/**
 * docker builder (FR-009..FR-013): shells out to the Docker CLI
 * (build → push → digest), returns the immutable digest-form Artifact.
 *
 * spec 028 dev-modes: `image.mode: 'registry-ref'` short-circuits BEFORE any
 * source path / docker subprocess / env scan — the configured immutable ref is
 * the artifact verbatim (no daemon required, no credentials read). `remote`
 * forwards image.host as DOCKER_HOST and digests via {{.Id}} on that daemon.
 */

import { isAbsolute, resolve } from 'node:path';

import { assertNoResidualEnv, requireSourcePath } from '../preflight.js';
import type { Artifact, Builder, BuildContext, DockerArtifactValue } from '../types.js';
import { buildAndPush } from './cli.js';
import { parseDockerConfig } from './config.js';

const builder = {
  async build(context: BuildContext): Promise<Artifact<DockerArtifactValue>> {
    const config = parseDockerConfig(context.buildConfig);
    if (config.mode === 'registry-ref') {
      // spec 028: zero docker subprocess calls, no source path, no env scan.
      return { type: 'ycforge:docker-image', value: { image: config.ref as string } };
    }
    const sourcePath = requireSourcePath(context, 'docker');
    assertNoResidualEnv(context, 'docker');
    // sourcePath may arrive relative to projectRoot (pilot passes it verbatim);
    // resolve it before use — the docker CLI runs with cwd = sourcePath, so a
    // relative context would double up (D10: apps/x/apps/x).
    const absoluteSourcePath = isAbsolute(sourcePath) ? sourcePath : resolve(context.projectRoot, sourcePath);
    const digest = await buildAndPush({
      sourcePath: absoluteSourcePath,
      repository: config.repository as string,
      tag: config.tag as string,
      dockerfile: config.dockerfile as string,
      noPush: config.noPush,
      ...(config.mode === 'remote' ? { host: config.host as string } : {}),
    });
    return { type: 'ycforge:docker-image', value: { image: `${config.repository}@${digest}` } };
  },
} satisfies Builder;

export default builder;