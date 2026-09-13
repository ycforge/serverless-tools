import { describe, expectTypeOf, it } from 'vitest';

import builderDefault from '@ycforge/composer/builder';
import type {
  ApiGatewayArtifactValue as BuilderApiGatewayArtifactValue,
  ResourceReferenceValue,
} from '@ycforge/composer/builder';
import type {
  Builder,
  BuildContext,
  Artifact,
} from '@ycforge/pilot/contracts';
import type {
  ApiGatewayArtifactValue as CoreApiGatewayArtifactValue,
  ResourceReference as CoreResourceReference,
} from '@ycforge/materializers-core';

// Published-contract conformance (T031, FR-001/FR-002/FR-014, D-3/FR-016).
// The `@ycforge/composer/builder` subpath must be resolvable (publish-contract
// via dist), the builder default export must satisfy the pilot Builder shape,
// and the artifact value types must be structurally identical to the
// materializers-core forward contract (spec 019 D-3).

describe('@ycforge/composer/builder published contract (spec 026, P3 / T031)', () => {
  it('(a) value types conform to the materializers-core forward contract (FR-014)', () => {
    expectTypeOf<BuilderApiGatewayArtifactValue>().toEqualTypeOf<CoreApiGatewayArtifactValue>();
    expectTypeOf<CoreApiGatewayArtifactValue>().toEqualTypeOf<BuilderApiGatewayArtifactValue>();
    expectTypeOf<ResourceReferenceValue>().toEqualTypeOf<CoreResourceReference>();
    expectTypeOf<CoreResourceReference>().toEqualTypeOf<ResourceReferenceValue>();
  });

  it('(b) contract types come from @ycforge/pilot/contracts, not local copies (FR-002, D-3)', () => {
    // BuildContext is a pilot contract interface — assert the required fields exist at the type level
    expectTypeOf<BuildContext>().toHaveProperty('projectRoot');
    expectTypeOf<BuildContext>().toHaveProperty('outputDir');
    expectTypeOf<Artifact>().toHaveProperty('type');
    // the default object satisfies the pilot Builder shape
    expectTypeOf<typeof builderDefault>().toMatchTypeOf<Builder>();
  });

  it('(c) the ./builder subpath resolves on the runtime module graph (publish-contract, FR-001)', async () => {
    const _mod = await import('@ycforge/composer/builder');
    expectTypeOf<typeof _mod.default>().toMatchTypeOf<{ build: (c: BuildContext) => Promise<Artifact> }>();
  });
});