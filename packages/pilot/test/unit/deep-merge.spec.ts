import { describe, expect, it } from 'vitest';

import { deepMerge } from '../../src/extensions/deep-merge.js';

describe('deepMerge (T018–T020)', () => {
  it('T018 object+object recursive merge + new top-level keys (FR-008, US-8 AC3, Sc8.3)', () => {
    const result = deepMerge(
      { a: { b: { x: 1, y: 2 } }, c: 3 },
      { a: { b: { y: 9 }, d: 4 } },
    );
    expect(result).toEqual({ a: { b: { x: 1, y: 9 }, d: 4 }, c: 3 });

    // new top-level key added to a resource without `tags`
    const withTags = deepMerge(
      { name: 'user_service', runtime: 'nodejs18' },
      { tags: { main: 'http' } },
    );
    expect(withTags).toEqual({ name: 'user_service', runtime: 'nodejs18', tags: { main: 'http' } });
  });

  it('T019 replace semantics: array/scalar/null/base-non-plain (FR-008/§25.2, US-2 AC1, Sc2/Sc9)', () => {
    // nested array replace (NOT [1,2,3,4])
    expect(deepMerge({ a: { list: [1, 2, 3] } }, { a: { list: [4] } })).toEqual({ a: { list: [4] } });

    // custom_domains replaced whole
    const domains = deepMerge(
      { custom_domains: [{ domain_id: 'd1' }] },
      { custom_domains: [{ domain_id: '${yandex_api_gateway_domain.main.id}' }] },
    ) as { custom_domains: readonly unknown[] };
    expect(domains.custom_domains).toHaveLength(1);
    expect(domains).toEqual({
      custom_domains: [{ domain_id: '${yandex_api_gateway_domain.main.id}' }],
    });

    // scalar override
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    // null from patch replaces
    expect(deepMerge({ a: 'old' }, { a: null })).toEqual({ a: null });
    // base non-plain-object replaced by patch object
    expect(deepMerge({ a: null }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    // missing key + patch array → key added
    expect(deepMerge({}, { list: [1] })).toEqual({ list: [1] });
  });

  it('T020 immutability + no-op + shared-subtree reuse (FR-008 non-mutating, US-6, Sc9)', () => {
    const base = { a: { b: { x: 1, y: 2 } }, list: [1, 2, 3], c: 3 };
    const patch = { a: { b: { y: 9 } }, c: 4 };
    const baseBefore = JSON.stringify(base);
    const patchBefore = JSON.stringify(patch);

    deepMerge(base, patch);
    expect(JSON.stringify(base)).toBe(baseBefore);
    expect(JSON.stringify(patch)).toBe(patchBefore);

    // untouched subtree reused by reference (patch touched `a` but not `a.b`)
    const base2 = { a: { b: { x: 1 }, y: 2 } };
    const result2 = deepMerge(base2, { a: { y: 9 } }) as typeof base2;
    expect(result2.a.b).toBe(base2.a.b);
    expect(result2).toEqual({ a: { b: { x: 1 }, y: 9 } });

    // deepMerge(base, {}) → new object structurally equal (no-op US-8 AC1)
    const noOp = deepMerge(base2, {}) as typeof base2;
    expect(noOp).toEqual(base2);
    expect(noOp).not.toBe(base2);
    expect(JSON.stringify(base2)).toBe('{"a":{"b":{"x":1},"y":2}}');

    // non-object inputs → value from patch replaces
    expect(deepMerge(null, { x: 1 })).toEqual({ x: 1 });
    expect(deepMerge([1], [2, 3])).toEqual([2, 3]);
    expect(deepMerge('old', 'new')).toBe('new');
  });
});