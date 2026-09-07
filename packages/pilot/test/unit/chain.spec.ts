import { describe, expect, it } from 'vitest';

import { MOV_CYCLE, MOV_DANGLING, MOV_TARGET_UNRESOLVED } from '../../src/contracts/index.js';
import { buildChains, type ChainsResult } from '../../src/moves/chain.js';
import { validateMoves } from '../../src/moves/validate.js';
import type { MoveEndpoint, MoveEntry } from '../../src/contracts/index.js';
import { endpoint, entry, movesFrom } from '../helpers/moves-fixtures.js';

function chainsFor(
  entries: readonly MoveEntry[],
  current: readonly MoveEndpoint[],
): ChainsResult {
  return buildChains(validateMoves(movesFrom(entries)), entries, current);
}

describe('buildChains (T020–T023)', () => {
  it('T020 chains links multi-hop moves into chains with start/terminal/entries (FR-002, US-1, US-3, Sc1/Sc2)', () => {
    const e0 = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.user_service', 'yandex_function.user_service'),
    );
    const e1 = entry(
      endpoint('functions.user_service', 'yandex_function.user_service'),
      endpoint('functions.accounts', 'yandex_function.accounts'),
    );
    const current = [endpoint('functions.accounts', 'yandex_function.accounts')];

    const { errors, chains } = chainsFor([e0, e1], current);
    expect(errors).toEqual([]);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.start).toEqual(e0.from);
    expect(chains[0]?.terminal).toEqual(e1.to);
    expect(chains[0]?.current).toEqual(current[0]);
    expect(chains[0]?.entries).toEqual([e0, e1]);
  });

  it('T020b endpoints with the same IDT but different IDL are NOT linked (identity is the full pair, FR-002, Sc9)', () => {
    const e0 = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.user_service', 'yandex_function.user_service'),
    );
    const e1 = entry(
      endpoint('functions.accounts', 'yandex_function.user_service'),
      endpoint('functions.reports', 'yandex_function.reports'),
    );
    const current = [
      endpoint('functions.user_service', 'yandex_function.user_service'),
      endpoint('functions.reports', 'yandex_function.reports'),
    ];

    const { errors, chains } = chainsFor([e0, e1], current);
    expect(errors).toEqual([]);
    expect(chains).toHaveLength(2);
  });

  it('T021 cycles are detected once per component and carry the addresses in the message (FR-002, US-8 AC3, Sc2)', () => {
    const a = endpoint('functions.alpha', 'yandex_function.alpha');
    const b = endpoint('functions.beta', 'yandex_function.beta');
    const c = endpoint('functions.gamma', 'yandex_function.gamma');
    const d = endpoint('functions.delta', 'yandex_function.delta');

    const backAndForth = chainsFor(
      [entry(a, b), entry(b, a)],
      canonicalCurrent(),
    );
    expect(backAndForth.chains).toHaveLength(0);
    expect(backAndForth.errors).toHaveLength(1);
    expect(backAndForth.errors[0]?.code).toBe(MOV_CYCLE);
    expect(backAndForth.errors[0]?.message).toContain('yandex_function.alpha');
    expect(backAndForth.errors[0]?.message).toContain('yandex_function.beta');

    const twoCycles = chainsFor(
      [entry(a, b), entry(b, a), entry(c, d), entry(d, c)],
      canonicalCurrent(),
    );
    expect(twoCycles.chains).toHaveLength(0);
    expect(twoCycles.errors.filter((e) => e.code === MOV_CYCLE)).toHaveLength(2);
  });

  it('T022 dangling chains: MOV_TARGET_UNRESOLVED (endpoint + available idls) + MOV_DANGLING × N, partial matches unresolved (FR-002, US-6 AC2, Sc6)', () => {
    const start = endpoint('functions.users', 'yandex_function.users');
    const terminal = endpoint('functions.analytics', 'yandex_function.analytics');
    const current = [endpoint('functions.user_service', 'yandex_function.user_service')];

    const single = chainsFor([entry(start, terminal)], current);
    expect(single.chains).toHaveLength(0);
    expect(single.errors).toHaveLength(2);
    const unresolved = single.errors.find((e) => e.code === MOV_TARGET_UNRESOLVED);
    expect(unresolved?.endpoint).toEqual(terminal);
    expect(unresolved?.available).toEqual(['functions.user_service']);
    expect(unresolved?.message).toContain('functions.analytics');
    expect(single.errors.filter((e) => e.code === MOV_DANGLING)).toHaveLength(1);

    const middle = endpoint('functions.user_service', 'yandex_function.user_service');
    const multi = chainsFor(
      [entry(start, middle), entry(middle, terminal)],
      current,
    );
    expect(multi.chains).toHaveLength(0);
    expect(multi.errors.filter((e) => e.code === MOV_DANGLING)).toHaveLength(2);
    expect(multi.errors.filter((e) => e.code === MOV_TARGET_UNRESOLVED)).toHaveLength(1);

    const idlMatches = chainsFor(
      [entry(start, endpoint('functions.accounts', 'yandex_function.accounts2'))],
      [endpoint('functions.accounts', 'yandex_function.accounts')],
    );
    expect(idlMatches.errors.some((e) => e.code === MOV_TARGET_UNRESOLVED)).toBe(true);

    const idtMatches = chainsFor(
      [entry(start, endpoint('functions.other', 'yandex_function.accounts'))],
      [endpoint('functions.accounts', 'yandex_function.accounts')],
    );
    expect(idtMatches.errors.some((e) => e.code === MOV_TARGET_UNRESOLVED)).toBe(true);
  });

  it('T023 chains are sorted canonically by (start.idl, start.idt), independent of file order (US-9 AC1, Sc8)', () => {
    const eA0 = entry(
      endpoint('functions.beta', 'yandex_function.beta'),
      endpoint('functions.beta2', 'yandex_function.beta2'),
    );
    const eA1 = entry(
      endpoint('functions.beta2', 'yandex_function.beta2'),
      endpoint('functions.beta3', 'yandex_function.beta3'),
    );
    const eB0 = entry(
      endpoint('functions.alpha', 'yandex_function.alpha'),
      endpoint('functions.alpha2', 'yandex_function.alpha2'),
    );
    const current = [
      endpoint('functions.alpha2', 'yandex_function.alpha2'),
      endpoint('functions.beta3', 'yandex_function.beta3'),
    ];

    const ba = chainsFor([eB0, eA0, eA1], current);
    const ab = chainsFor([eA0, eA1, eB0], current);

    expect(ba.errors).toEqual([]);
    expect(ab.errors).toEqual([]);
    expect(ba.chains.map((c) => c.start.idl)).toEqual(['functions.alpha', 'functions.beta']);
    expect(ba.chains).toEqual(ab.chains);
    expect(ba.chains[0]?.entries).toEqual([eB0]);
    expect(ba.chains[1]?.entries).toEqual([eA0, eA1]);
  });
});

function canonicalCurrent(): readonly MoveEndpoint[] {
  return [
    endpoint('functions.alpha2', 'yandex_function.alpha2'),
    endpoint('functions.beta3', 'yandex_function.beta3'),
    endpoint('functions.gamma2', 'yandex_function.gamma2'),
    endpoint('functions.delta2', 'yandex_function.delta2'),
  ];
}