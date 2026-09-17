/**
 * nestjs-function builder: bundles a NestJS app into one self-contained CJS
 * file (esbuild), zips it into `outputDir`, returns `ycforge:function`
 * (spec 018 §Scope, D-RE-8; self-contained-only since the spec-028 toolchain
 * fix — declared `external` stays a bare runtime `require`, never vendored).
 */

import { assertNoResidualEnv, requireSourcePath } from '../preflight.js';
import type { Artifact, Builder, BuildContext, FunctionArtifactValue } from '../types.js';
import { bundleFunction } from './bundle.js';
import { parseNestjsConfig } from './config.js';

const builder = {
  async build(context: BuildContext): Promise<Artifact<FunctionArtifactValue>> {
    const sourcePath = requireSourcePath(context, 'nestjs-function');
    assertNoResidualEnv(context, 'nestjs-function');
    const config = parseNestjsConfig(context.buildConfig);
    const bundle = await bundleFunction({
      sourcePath,
      entry: config.entry,
      runtime: config.runtime,
      external: config.external,
      out_filename: config.out_filename,
      outputDir: context.outputDir,
    });
    return { type: 'ycforge:function', value: bundle };
  },
} satisfies Builder;

export default builder;