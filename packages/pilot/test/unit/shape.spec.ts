import { describe, expect, it } from 'vitest';

import { detectPluginKind, isBuilderShape, isMaterializerShape } from '../../src/registry/shape.js';

// T020–T022: shape.ts unit tests (FR-007/008, US-4, research 2)

describe('shape.ts', () => {
  it('T020: isBuilderShape returns true when obj.build is function, false otherwise', () => {
    expect(isBuilderShape({ build: async () => ({}) })).toBe(true);
    expect(isBuilderShape({})).toBe(false);
    expect(isBuilderShape(null)).toBe(false);
    expect(isBuilderShape('string')).toBe(false);
    expect(isBuilderShape({ build: 'not-a-function' })).toBe(false);
  });

  it('T021: isMaterializerShape returns true when supports+materialize are functions', () => {
    expect(isMaterializerShape({ supports: () => true, materialize: async () => ({}) })).toBe(true);
    expect(isMaterializerShape({ supports: () => true })).toBe(false);
    expect(isMaterializerShape({ materialize: async () => ({}) })).toBe(false);
    expect(isMaterializerShape({})).toBe(false);
    expect(isMaterializerShape(null)).toBe(false);
  });

  it('T022: detectPluginKind resolves default first, builder-priority for both shapes (FR-007/008, US-4 AC2)', () => {
    // builder shape
    expect(detectPluginKind({ default: { build: async () => ({}) } })).toBe('builder');
    // materializer shape
    expect(detectPluginKind({ default: { supports: () => true, materialize: async () => ({}) } })).toBe('materializer');
    // both shapes → builder priority (research 2)
    expect(
      detectPluginKind({
        default: {
          build: async () => ({}),
          supports: () => true,
          materialize: async () => ({}),
        },
      }),
    ).toBe('builder');
    // neither shape → null
    expect(detectPluginKind({ default: { foo: () => {} } })).toBe(null);
    // no default, falls back to ns itself
    expect(detectPluginKind({ build: async () => ({}) })).toBe('builder');
    // null ns.default, ns itself
    expect(detectPluginKind({ supports: () => true, materialize: async () => ({}) })).toBe('materializer');
  });
});
