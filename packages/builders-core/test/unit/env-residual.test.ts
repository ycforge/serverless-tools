import { describe, expect, it } from 'vitest';

import { scanBuildInput, type EnvScanResult } from '../../src/env.js';

function expectClean(result: EnvScanResult): void {
  expect(result).toEqual({ clean: true });
}

function expectHits(result: EnvScanResult, expected: readonly string[]): void {
  expect(result.clean).toBe(false);
  if (result.clean) return;
  expect([...result.hits].sort()).toEqual([...expected].sort());
}

describe('env residual scan (D-3, US5)', () => {
  it('no {{$…}} references anywhere → clean', () => {
    expectClean(scanBuildInput({ image: { tag: 'latest', repository: 'cr.example/app' } }, {}));
    expectClean(scanBuildInput({ entry: 'src/main.ts', external: ['sharp'] }, { FOO: 'bar' }));
  });

  it('US5-AC2: {{$TAG}} inside buildConfig.image.tag → hit buildConfig.image.tag', () => {
    expectHits(scanBuildInput({ image: { tag: '{{$TAG}}' } }, {}), ['buildConfig.image.tag']);
  });

  it('US5-AC1: {{$ENTRY}} as a whole string value → hit', () => {
    expectHits(scanBuildInput({ entry: '{{$ENTRY}}' }, {}), ['buildConfig.entry']);
  });

  it('residual in buildEnv values → hit buildEnv.<KEY>', () => {
    expectHits(scanBuildInput({}, { X: '{{$Y}}', OK: 'yes' }), ['buildEnv.X']);
  });

  it('residual inside an array element → hit with index', () => {
    expectHits(scanBuildInput({ external: ['sharp', '{{$PKG}}'] }, {}), ['buildConfig.external[1]']);
  });

  it('STRICT FR-019: residual whose name IS a buildEnv key is still a hit (no leniency)', () => {
    expectHits(scanBuildInput({ image: { tag: '{{$TAG}}' } }, { TAG: 'v2' }), ['buildConfig.image.tag']);
  });

  it('US5-AC3: buildEnv value referencing its own key → hit buildEnv.GREETING', () => {
    expectHits(scanBuildInput({}, { GREETING: '{{$GREETING}}' }), ['buildEnv.GREETING']);
  });

  it('a buildEnv value referencing a key whose own value still has residual → both keys are hits (transitive is upstream job)', () => {
    expectHits(scanBuildInput({}, { X: '{{$Y}}', Y: '{{$Z}}' }), ['buildEnv.X', 'buildEnv.Y']);
  });

  it('non-object buildConfig → clean (nothing to scan)', () => {
    expectClean(scanBuildInput(null, {}));
    expectClean(scanBuildInput('vite build', {}));
  });
});