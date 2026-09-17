/**
 * vite builder (FR-014..FR-017, FR-020): runs the configured `command`
 * in the app root with buildEnv overlaid, copies the static output from
 * `<root>/<out_dir>` into `outputDir` (absolute artifact directory).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { BLC_BUILD_FAILED, builderError } from '../diagnostics.js';
import { assertNoResidualEnv, requireSourcePath } from '../preflight.js';
import type { Artifact, Builder, BuildContext, FrontendArtifactValue } from '../types.js';
import { parseViteConfig } from './config.js';
import { runViteBuild } from './run.js';
import { bucketNameFor } from './slug.js';

function copyDirContents(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(from, to);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      copyFileSync(from, to);
    }
  }
}

const builder = {
  async build(context: BuildContext): Promise<Artifact<FrontendArtifactValue>> {
    const sourcePath = requireSourcePath(context, 'vite');
    assertNoResidualEnv(context, 'vite');
    const config = parseViteConfig(context.buildConfig);

    const cwd = join(sourcePath, config.root);
    await runViteBuild({ sourcePath, cwd, command: config.command, buildEnv: context.buildEnv });

    const builtDir = join(cwd, config.out_dir);
    if (!existsSync(builtDir)) {
      throw builderError(
        BLC_BUILD_FAILED,
        `vite build produced no output at '${config.out_dir}' (${BLC_BUILD_FAILED})`,
      );
    }
    copyDirContents(builtDir, context.outputDir);

    // Bucket name: explicit build_config.bucket_name wins; otherwise resolve
    // an appId-slug default persisted in <root>/.ycsf/state.json. `appId` is
    // the basename of pilot's artifact outputDir (<root>/.ycsf/artifacts/<appId>).
    const appId = basename(context.outputDir);
    const { bucketName } = bucketNameFor(context.projectRoot, appId, config.bucket_name);

    return { type: 'ycforge:frontend', value: { directory: context.outputDir, bucketName } };
  },
} satisfies Builder;

export default builder;