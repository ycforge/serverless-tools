import { describe, expect, expectTypeOf, it } from 'vitest';

import { isArtifactType } from '@ycforge/pilot/contracts';
import type {
  Artifact as PilotArtifact,
  MaterializationContext as PilotMaterializationContext,
  Materializer as PilotMaterializer,
  OutputBuilder as PilotOutputBuilder,
  TerraformResource as PilotTerraformResource,
} from '@ycforge/pilot/contracts';
import type {
  Artifact as CoreArtifact,
  MaterializationContext as CoreMaterializationContext,
  Materializer as CoreMaterializer,
  OutputBuilder as CoreOutputBuilder,
  TerraformResource as CoreTerraformResource,
} from '@ycforge/materializers-core';

// pilot (spec 002/014) ↔ @ycforge/materializers-core (spec 019) contract
// conformance. The materializers-core package must stay structurally
// compatible with the pilot contracts while being pilot-free in its own src
// (D-2 / Constitution I). Direction note (research D-RE-5): the pilot
// single-resource Materializer is the SUBTYPE of the core multi-resource one,
// so `pilot extends core` is the direction that guarantees non-breaking
// additive evolution — a spec-002 materializer still satisfies the new
// (wider) contract.

describe('materializers-core conformance to pilot contracts (spec 019, D-RE-5)', () => {
  it('OutputBuilder is structurally identical in both directions (FR-002)', () => {
    expectTypeOf<PilotOutputBuilder>().toEqualTypeOf<CoreOutputBuilder>();
    expectTypeOf<CoreOutputBuilder>().toEqualTypeOf<PilotOutputBuilder>();
  });

  it('MaterializationContext is structurally identical in both directions (FR-002)', () => {
    expectTypeOf<PilotMaterializationContext>().toEqualTypeOf<CoreMaterializationContext>();
    expectTypeOf<CoreMaterializationContext>().toEqualTypeOf<PilotMaterializationContext>();
  });

  it('TerraformResource is structurally identical in both directions (FR-008)', () => {
    expectTypeOf<PilotTerraformResource>().toEqualTypeOf<CoreTerraformResource>();
    expectTypeOf<CoreTerraformResource>().toEqualTypeOf<PilotTerraformResource>();
  });

  it('Artifact is structurally identical in both directions (FR-003)', () => {
    expectTypeOf<PilotArtifact>().toEqualTypeOf<CoreArtifact>();
    expectTypeOf<CoreArtifact>().toEqualTypeOf<PilotArtifact>();
  });

  it('pilot single-resource Materializer is assignable to core multi-resource Materializer (additive, D-RE-5)', () => {
    expectTypeOf<PilotMaterializer>().toMatchTypeOf<CoreMaterializer>();

    type PilotResult = Awaited<ReturnType<PilotMaterializer['materialize']>>;
    type CoreResult = Awaited<ReturnType<CoreMaterializer['materialize']>>;
    expectTypeOf<CoreResult>().toEqualTypeOf<PilotResult | readonly PilotTerraformResource[]>();
  });

  it('values written against pilot contracts are consumable by core-shaped consumers and vice versa for identical shapes', () => {
    const pilotOutput: PilotOutputBuilder = { declare: () => {} };
    const coreOutput: CoreOutputBuilder = pilotOutput;
    const back: PilotOutputBuilder = coreOutput;

    const coreCtx: CoreMaterializationContext = { output: pilotOutput };
    const pilotCtx: PilotMaterializationContext = coreCtx;

    const coreResource: CoreTerraformResource = { kind: 'resource', type: 'yandex_function', name: 'fn', configuration: {} };
    const pilotResource: PilotTerraformResource = coreResource;

    expect(back).toBe(pilotOutput);
    expect(pilotCtx.output).toBe(pilotOutput);
    expect(pilotResource.name).toBe('fn');
  });

  it('pilot isArtifactType accepts the new spec 019 artifact types (FR-004, D-3)', () => {
    expect(isArtifactType('ycforge:api-gateway')).toBe(true);
    expect(isArtifactType('ycforge:queue')).toBe(true);
  });
});