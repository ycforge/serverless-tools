import { describe, expect, it } from 'vitest';

import { ARTIFACT_TYPE_PATTERN, isArtifactType } from '../../src/contracts/index.js';

// FR-004: predicate validating the `<package-scope>:<kind>` convention.
// Enforcement of the convention (error on violation) is C's zone — the
// contracts module provides only the pure predicate and the pattern.

describe('isArtifactType (FR-004)', () => {
  it('accepts canonical package-scope:kind pairs', () => {
    expect(isArtifactType('ycforge:function')).toBe(true);
    expect(isArtifactType('ycforge:api-gateway')).toBe(true);
    expect(isArtifactType('acme-widgets:container2')).toBe(true);
  });

  it('rejects violations of the convention', () => {
    expect(isArtifactType('function')).toBe(false); // no scope
    expect(isArtifactType('Ycforge:function')).toBe(false); // uppercase scope
    expect(isArtifactType('ycforge:Function')).toBe(false); // uppercase kind
    expect(isArtifactType('ycforge:')).toBe(false); // empty kind
    expect(isArtifactType(':function')).toBe(false); // empty scope
    expect(isArtifactType('ycforge:api_gateway')).toBe(false); // underscore in kind
    expect(isArtifactType('')).toBe(false);
  });

  it('is pure: no throws, no side effects', () => {
    expect(() => isArtifactType('anything at all!')).not.toThrow();
    expect(isArtifactType('ycforge:function')).toBe(true); // stable on repeat
  });

  it('exposes the frozen pattern', () => {
    expect(ARTIFACT_TYPE_PATTERN.source).toBe('^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$');
    expect(Object.isFrozen(ARTIFACT_TYPE_PATTERN)).toBe(true);
  });
});
