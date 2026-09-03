import { describe, expectTypeOf, it } from 'vitest';

import type {
  Artifact,
  Diagnostic,
  MaterializationContext,
  Materializer,
  TerraformResource,
} from '../../src/contracts/index.js';
import { ContractError, Diagnostics } from '../../src/contracts/index.js';

// Type-level contract tests for FR-014 (dispatch prerequisites) and
// FR-016 (diagnostics types). Must break compilation on signature changes
// (SC-002). Dispatch itself is C's zone — these tests only fix the contract
// shape that makes collision detection possible before materialize.

declare const candidates: Materializer[];
declare const artifact: Artifact;
declare const context: MaterializationContext;

/** FR-014: C can enumerate supports() for every candidate BEFORE calling
 * materialize — collision detection needs nothing but synchronous booleans. */
export function detectCollisionBeforeMaterialize(): boolean[] {
  return candidates.map((m) => m.supports(artifact, context));
}

describe('dispatch contract (FR-014)', () => {
  it('Artifact.type is a plain string dispatch key', () => {
    expectTypeOf<Artifact['type']>().toEqualTypeOf<string>();
  });

  it('supports is a synchronous boolean selector', () => {
    expectTypeOf<Materializer['supports']>().returns.toEqualTypeOf<boolean>();
    // @ts-expect-error — supports must NOT return a Promise (async detection
    // would make pre-materialize collision checks impossible).
    expectTypeOf<Materializer['supports']>().returns.toEqualTypeOf<Promise<boolean>>();
  });

  it('materialize stays async and returns TerraformResource directly', () => {
    expectTypeOf<Materializer['materialize']>().returns.toEqualTypeOf<Promise<TerraformResource<unknown>>>();
  });
});

describe('diagnostics types (FR-016)', () => {
  it('ContractError carries the Diagnostic shape', () => {
    expectTypeOf<ContractError['code']>().toEqualTypeOf<string>();
    expectTypeOf<ContractError['message']>().toEqualTypeOf<string>();
    const error = new ContractError(Diagnostics.InvalidResourceReference, 'x');
    expectTypeOf(error).toMatchTypeOf<Diagnostic>();
    expectTypeOf(Diagnostics.InvalidResourceReference).toEqualTypeOf<'INVALID_RESOURCE_REFERENCE'>();
  });
});
