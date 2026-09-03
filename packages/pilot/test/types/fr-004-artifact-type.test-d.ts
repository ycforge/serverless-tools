import { describe, expectTypeOf, it } from 'vitest';

import { ARTIFACT_TYPE_PATTERN, isArtifactType } from '../../src/contracts/index.js';

// SC-002: compile-time coverage for FR-004 (artifact type convention
// predicate). Breaks compilation if the signature changes.

describe('artifact-type predicate types (FR-004)', () => {
  it('isArtifactType is a pure (string) => boolean function', () => {
    expectTypeOf(isArtifactType).toEqualTypeOf<(value: string) => boolean>();
    expectTypeOf(isArtifactType('ycforge:function')).toEqualTypeOf<boolean>();
  });

  it('ARTIFACT_TYPE_PATTERN is a RegExp', () => {
    expectTypeOf(ARTIFACT_TYPE_PATTERN).toEqualTypeOf<RegExp>();
    expectTypeOf(ARTIFACT_TYPE_PATTERN.test).toEqualTypeOf<(string: string) => boolean>();
  });
});
