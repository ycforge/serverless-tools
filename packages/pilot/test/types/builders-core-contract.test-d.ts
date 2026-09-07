import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Builder, BuildContext } from '../../src/contracts/index.js';
import { isArtifactType } from '../../src/contracts/index.js';
import type { BuildContext as BcBuildContext } from '@ycforge/builders-core';
import nestjsFunctionBuilder from '@ycforge/builders-core/nestjs-function';
import dockerBuilder from '@ycforge/builders-core/docker';
import viteBuilder from '@ycforge/builders-core/vite';

// pilot (spec 002/013) ↔ @ycforge/builders-core (spec 018) contract conformance.
// The builders-core package must stay structurally compatible with the pilot
// Builder/BuildContext contracts while being pilot-free in its own src.

describe('builders-core conformance to pilot contracts (spec 002/018)', () => {
  it('subpath builders are pilot-Builder-shaped (FR-001)', () => {
    expectTypeOf(nestjsFunctionBuilder).toMatchTypeOf<Builder>();
    expectTypeOf(dockerBuilder).toMatchTypeOf<Builder>();
    expectTypeOf(viteBuilder).toMatchTypeOf<Builder>();
  });

  it('BuildContext is structurally interchangeable in both directions', () => {
    const pilotCtx: BuildContext = {
      projectRoot: '.',
      sourcePath: './user_service',
      buildConfig: { entry: 'src/main.ts' },
      buildEnv: {},
      outputDir: 'out',
    };
    const bcCtx: BcBuildContext = pilotCtx;
    const back: BuildContext = bcCtx;
    expect(back.outputDir).toBe('out');
  });

  it('catalog artifact types follow the <scope>:<kind> grammar (FR-004)', () => {
    expect(isArtifactType('ycforge:function')).toBe(true);
    expect(isArtifactType('ycforge:docker-image')).toBe(true);
    expect(isArtifactType('ycforge:frontend')).toBe(true);
  });
});