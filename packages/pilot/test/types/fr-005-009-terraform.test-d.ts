import { describe, expectTypeOf, it } from 'vitest';

import type {
  Artifact,
  MaterializationContext,
  Materializer,
  OutputBuilder,
  TerraformBlock,
  TerraformData,
  TerraformMoved,
  TerraformOutput,
  TerraformResource,
  TerraformVariable,
} from '../../src/contracts/index.js';

// Type-level contract tests for FR-005..FR-009 (Materializer /
// MaterializationContext / OutputBuilder / Terraform model). Must break
// compilation on any signature change (SC-002).

declare const materializer: Materializer;
declare const artifact: Artifact;
declare const context: MaterializationContext;

export async function fr005MaterializeReturnsTerraformResource(): Promise<TerraformResource> {
  // FR-005: materialize returns TerraformResource directly, no intermediate
  // abstraction layer (IDEA §22).
  return materializer.materialize(artifact, context);
}

export function fr005SupportsIsSyncBoolean(): boolean {
  // FR-014 prerequisite: supports is a synchronous pure boolean selector —
  // C can detect collisions before calling materialize.
  return materializer.supports(artifact, context);
}

describe('Materializer contract (FR-005..FR-007)', () => {
  it('FR-006: MaterializationContext is exactly { output: OutputBuilder }', () => {
    expectTypeOf<keyof MaterializationContext>().toEqualTypeOf<'output'>();
    expectTypeOf(context.output).toEqualTypeOf<OutputBuilder>();
  });

  it('FR-007: OutputBuilder.declare(name, { value, description? }): void', () => {
    expectTypeOf(context.output.declare).parameters.toEqualTypeOf<
      [name: string, output: { value: string; description?: string }]
    >();
    expectTypeOf(context.output.declare).returns.toEqualTypeOf<void>();
  });

  it('FR-005: supports is synchronous, materialize is async', () => {
    expectTypeOf(materializer.supports).returns.toEqualTypeOf<boolean>();
    expectTypeOf(materializer.materialize).returns.toEqualTypeOf<Promise<TerraformResource<unknown>>>();
  });
});

describe('Terraform model (FR-008, FR-009)', () => {
  it('FR-008: TerraformResource<T> generic minimal representation', () => {
    expectTypeOf<TerraformResource>().toEqualTypeOf<{
      readonly kind: 'resource';
      readonly type: string;
      readonly name: string;
      readonly configuration: unknown;
    }>();
    const typed = {} as TerraformResource<{ image: string }>;
    expectTypeOf(typed.configuration).toEqualTypeOf<{ image: string }>();
  });

  it('FR-009: TerraformBlock is a discriminated union of 5 block kinds', () => {
    expectTypeOf<TerraformBlock['kind']>().toEqualTypeOf<
      'resource' | 'moved' | 'variable' | 'data' | 'output'
    >();
    const moved = {} as TerraformMoved;
    expectTypeOf(moved.kind).toEqualTypeOf<'moved'>();
    expectTypeOf(moved.from).toEqualTypeOf<string>();
    expectTypeOf(moved.to).toEqualTypeOf<string>();
    const variable = {} as TerraformVariable;
    expectTypeOf(variable.kind).toEqualTypeOf<'variable'>();
    const data = {} as TerraformData;
    expectTypeOf(data.kind).toEqualTypeOf<'data'>();
    const output = {} as TerraformOutput;
    expectTypeOf(output.kind).toEqualTypeOf<'output'>();
    // narrowing works off the discriminant
    const block = {} as TerraformBlock;
    if (block.kind === 'moved') {
      expectTypeOf(block).toEqualTypeOf<TerraformMoved>();
    } else if (block.kind === 'resource') {
      expectTypeOf(block).toEqualTypeOf<TerraformResource<unknown>>();
    }
  });
});
