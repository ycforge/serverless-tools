import { describe, expectTypeOf, it } from 'vitest';

import type {
  AppIdArtifactMap,
  ArtifactDescriptor,
  DispatchDiagnostic,
  DispatchOptions,
  DispatchResult,
  GeneratedTfFile,
  OutputValue,
  TerraformResource,
} from '../../src/contracts/index.js';
import {
  MTL_COLLISION,
  MTL_UNHANDLED_ARTIFACT,
  MTL_MATERIALIZE_FAILED,
  MTL_FILENAME_COLLISION,
  MTL_INVALID_TERRAFORM_ADDRESS,
  MTL_OUTPUT_NAME_COLLISION,
} from '../../src/contracts/index.js';
import { dispatch, writeGeneratedTerraform } from '../../src/index.js';

// T026: materialize.test-d.ts — public dispatch API type contract (data-model.md,
// quickstart.md prerequisites). Must break compilation on signature changes.

declare const model: import('../../src/contracts/index.js').ProjectModel;
declare const registry: import('../../src/contracts/index.js').PluginRegistry;

describe('dispatch API types (T026)', () => {
  it('dispatch returns Promise<DispatchResult>; writeGeneratedTerraform returns Promise<void>', () => {
    expectTypeOf(dispatch).returns.toEqualTypeOf<Promise<DispatchResult>>();
    expectTypeOf(dispatch).toBeCallableWith(model, registry);
    expectTypeOf(writeGeneratedTerraform).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(writeGeneratedTerraform).toBeCallableWith('infra', []);
  });

  it('DispatchResult is a discriminated ok/invalid union (data-model.md)', () => {
    expectTypeOf<DispatchResult>().toMatchTypeOf<
      | { kind: 'ok'; resources: readonly TerraformResource[]; generatedFiles: readonly GeneratedTfFile[] }
      | { kind: 'invalid'; errors: readonly DispatchDiagnostic[] }
    >();
  });

  it('ArtifactDescriptor carries id/name/type plain strings', () => {
    expectTypeOf<ArtifactDescriptor['id']>().toEqualTypeOf<string>();
    expectTypeOf<ArtifactDescriptor['name']>().toEqualTypeOf<string>();
    expectTypeOf<ArtifactDescriptor['type']>().toEqualTypeOf<string>();
  });

  it('T001: ArtifactDescriptor.value is optional and opaque (FR-001, SC-007)', () => {
    expectTypeOf<ArtifactDescriptor['value']>().toEqualTypeOf<unknown | undefined>();
  });

  it('T001: DispatchOptions.artifacts is an optional AppIdArtifactMap (FR-002, FR-016)', () => {
    expectTypeOf<DispatchOptions['artifacts']>().toEqualTypeOf<AppIdArtifactMap | undefined>();
    expectTypeOf<AppIdArtifactMap>().toMatchTypeOf<ReadonlyMap<string, { type: string; value: unknown }>>();
  });

  it('T001: DispatchResult ok branch exposes materializerOutputs in declaration order (FR-004)', () => {
    expectTypeOf<Extract<DispatchResult, { kind: 'ok' }>>().toMatchTypeOf<{
      readonly materializerOutputs: ReadonlyMap<string, OutputValue>;
    }>();
  });

  it('T001: dispatch stays callable with (model, registry) and (model, registry, DispatchOptions)', () => {
    expectTypeOf(dispatch).toBeCallableWith(model, registry);
    const options: DispatchOptions = {};
    expectTypeOf(dispatch).toBeCallableWith(model, registry, options);
  });

  it('MTL_* constants are literal single-codes (Constitution V — no string coercion)', () => {
    expectTypeOf(MTL_COLLISION).toEqualTypeOf<'MTL_COLLISION'>();
    expectTypeOf(MTL_UNHANDLED_ARTIFACT).toEqualTypeOf<'MTL_UNHANDLED_ARTIFACT'>();
    expectTypeOf(MTL_MATERIALIZE_FAILED).toEqualTypeOf<'MTL_MATERIALIZE_FAILED'>();
    expectTypeOf(MTL_FILENAME_COLLISION).toEqualTypeOf<'MTL_FILENAME_COLLISION'>();
    expectTypeOf(MTL_INVALID_TERRAFORM_ADDRESS).toEqualTypeOf<'MTL_INVALID_TERRAFORM_ADDRESS'>();
    expectTypeOf(MTL_OUTPUT_NAME_COLLISION).toEqualTypeOf<'MTL_OUTPUT_NAME_COLLISION'>();
  });
});