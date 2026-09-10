import { describe, it, expect } from 'vitest';
import { getBuilder } from '../../../src/registry/shape.js';

describe('getBuilder (T017)', () => {
  it('returns Builder for valid builder module', () => {
    const builder = { build: async () => ({ type: 'test', value: {} }) };
    expect(getBuilder(builder)).toBe(builder);
  });

  it('returns Builder from module.default', () => {
    const builder = { build: async () => ({ type: 'test', value: {} }) };
    expect(getBuilder({ default: builder })).toBe(builder);
  });

  it('returns null for non-object', () => {
    expect(getBuilder(null)).toBeNull();
    expect(getBuilder(undefined)).toBeNull();
    expect(getBuilder('string')).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(getBuilder({})).toBeNull();
  });

  it('returns null for materializer shape', () => {
    const materializer = { supports: () => true, materialize: async () => {} };
    expect(getBuilder(materializer)).toBeNull();
  });
});
