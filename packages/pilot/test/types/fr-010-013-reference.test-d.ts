import { describe, expectTypeOf, it } from 'vitest';

import type {
  ParsedResourceReference,
  ResourceReference,
} from '../../src/contracts/index.js';
import {
  formatResourceReference,
  parseResourceReference,
} from '../../src/contracts/index.js';

// Type-level contract tests for FR-010..FR-013 (ResourceReference and the
// parser). Must break compilation on signature changes (SC-002).

describe('ResourceReference contract (FR-010..FR-013)', () => {
  it('FR-010: ResourceReference is a single canonical { ref: string }', () => {
    expectTypeOf<ResourceReference>().toEqualTypeOf<{ readonly ref: string }>();
  });

  it('FR-011: parser returns domain/name/property; formatter is the inverse', () => {
    expectTypeOf(parseResourceReference).returns.toEqualTypeOf<ParsedResourceReference>();
    expectTypeOf<ParsedResourceReference>().toEqualTypeOf<{
      readonly domain: string;
      readonly name: string;
      readonly property: string;
    }>();
    expectTypeOf(formatResourceReference).parameters.toEqualTypeOf<[parsed: ParsedResourceReference]>();
    expectTypeOf(formatResourceReference).returns.toEqualTypeOf<string>();
  });

  it('FR-012: rejection is via thrown ContractError, not undefined', () => {
    // The return type carries no `undefined` branch — invalid input throws.
    expectTypeOf(parseResourceReference('functions.user_service.id')).not.toBeUndefined();
  });
});
