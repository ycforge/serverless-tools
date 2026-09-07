import { describe, expect, it } from 'vitest';

import {
  MOV_DUPLICATE,
  MOV_TYPE_CHANGE,
  type BuildMovesResult,
  type TerraformMoved,
} from '../../src/contracts/index.js';
import { buildMovedFile, buildMoves } from '../../src/index.js';
import { endpoint, entry, movesFrom } from '../helpers/moves-fixtures.js';

const FILENAME_RE = /^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/;

describe('buildMoves (T024–T030)', () => {
  it('T024 single idt-only rename compiles to one TerraformMoved (FR-002, US-1 AC1, Sc1)', () => {
    const current = [endpoint('functions.users', 'yandex_function.user_api')];
    const result = buildMoves(
      current,
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('functions.users', 'yandex_function.user_api'),
        ),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.user_api' },
    ]);
  });

  it('T025 rename INTO an existing current resource (full move) compiles (US-2 AC1, Sc2)', () => {
    const current = [endpoint('functions.user_service', 'yandex_function.user_service')];
    const result = buildMoves(
      current,
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('functions.user_service', 'yandex_function.user_service'),
        ),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.user_service' },
    ]);
  });

  it('T026 chains compile to one TerraformMoved per compiled step, oldest first, plus-compression of intermediate hops (FR-002, US-3 AC1, Sc3)', () => {
    const current = [endpoint('functions.accounts', 'yandex_function.accounts')];

    const twoHop = buildMoves(
      current,
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('functions.user_service', 'yandex_function.user_service'),
        ),
        entry(
          endpoint('functions.user_service', 'yandex_function.user_service'),
          endpoint('functions.accounts', 'yandex_function.accounts'),
        ),
      ]),
    );
    expect(twoHop.kind).toBe('ok');
    if (twoHop.kind !== 'ok') return;
    expect(twoHop.moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.accounts' },
      { kind: 'moved', from: 'yandex_function.user_service', to: 'yandex_function.accounts' },
    ]);

    const incompleteHistory = buildMoves(
      current,
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('functions.accounts', 'yandex_function.accounts'),
        ),
      ]),
    );
    expect(incompleteHistory.kind).toBe('ok');
    if (incompleteHistory.kind !== 'ok') return;
    expect(incompleteHistory.moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.accounts' },
    ]);

    const threeStep = buildMoves(
      current,
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('functions.user_service', 'yandex_function.user_service'),
        ),
        entry(
          endpoint('functions.user_service', 'yandex_function.user_service'),
          endpoint('functions.reports', 'yandex_function.reports'),
        ),
        entry(
          endpoint('functions.reports', 'yandex_function.reports'),
          endpoint('functions.accounts', 'yandex_function.accounts'),
        ),
      ]),
    );
    expect(threeStep.kind).toBe('ok');
    if (threeStep.kind !== 'ok') return;
    expect(threeStep.moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.accounts' },
      { kind: 'moved', from: 'yandex_function.user_service', to: 'yandex_function.accounts' },
      { kind: 'moved', from: 'yandex_function.reports', to: 'yandex_function.accounts' },
    ]);
  });

  it('T027 idl-only renames are skipped: single entries produce nothing, chain-internal hops are absorbed (US-7 AC2, Sc7)', () => {
    const single = buildMoves(
      [endpoint('functions.accounts', 'yandex_function.accounts')],
      movesFrom([
        entry(
          endpoint('functions.old', 'yandex_function.accounts'),
          endpoint('functions.accounts', 'yandex_function.accounts'),
        ),
      ]),
    );
    expect(single.kind).toBe('ok');
    if (single.kind !== 'ok') return;
    expect(single.moved).toEqual([]);

    const chainStart = endpoint('functions.old', 'yandex_function.accounts');
    const mid = endpoint('functions.accounts', 'yandex_function.accounts');
    const terminal = endpoint('functions.final', 'yandex_function.final');
    const chained = buildMoves(
      [endpoint('functions.final', 'yandex_function.final')],
      movesFrom([entry(chainStart, mid), entry(mid, terminal)]),
    );
    expect(chained.kind).toBe('ok');
    if (chained.kind !== 'ok') return;
    expect(chained.moved).toEqual([
      { kind: 'moved', from: 'yandex_function.accounts', to: 'yandex_function.final' },
    ]);
  });

  it('T028 errors are collected across all entries in order and NO moved block is emitted (all-or-nothing, US-4 AC2, Sc4)', () => {
    const typeChange = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('containers.users', 'yandex_container.users'),
    );
    const valid = entry(
      endpoint('functions.analytics', 'yandex_function.analytics'),
      endpoint('functions.analytics2', 'yandex_function.analytics2'),
    );
    const current = [
      endpoint('containers.users', 'yandex_container.users'),
      endpoint('functions.analytics2', 'yandex_function.analytics2'),
    ];

    const withError = buildMoves(current, movesFrom([typeChange, valid]));
    expect(withError.kind).toBe('invalid');
    if (withError.kind !== 'invalid') return;
    expect(withError.errors[0]).toMatchObject({ code: MOV_TYPE_CHANGE, entry: 0 });

    const r2 = buildMoves(current, movesFrom([typeChange, valid, valid]));
    expect(r2.kind).toBe('invalid');
    if (r2.kind !== 'invalid') return;
    expect(r2.errors).toHaveLength(2);
    expect(r2.errors[0]).toMatchObject({ code: MOV_TYPE_CHANGE, entry: 0 });
    expect(r2.errors[1]).toMatchObject({ code: MOV_DUPLICATE, entry: 2 });
  });

  it('T029 deterministic output: repeated + reordered inputs produce equal results; empty moves → ok []; inputs not mutated (US-9 AC1, US-7 AC3, Sc8)', () => {
    const current = [endpoint('functions.accounts', 'yandex_function.accounts')];
    const e0 = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.user_service', 'yandex_function.user_service'),
    );
    const e1 = entry(
      endpoint('functions.user_service', 'yandex_function.user_service'),
      endpoint('functions.accounts', 'yandex_function.accounts'),
    );

    const a = buildMoves(current, movesFrom([e0, e1]));
    const b = buildMoves(current, movesFrom([e0, e1]));
    const c = buildMoves(current, movesFrom([e1, e0]));
    expect(a).toEqual(b);
    expect(a.kind).toBe('ok');
    if (a.kind !== 'ok' || c.kind !== 'ok') return;
    expect(c.moved).toEqual(a.moved);

    const empty = buildMoves(canonical(), movesFrom([]));
    expect(empty.kind).toBe('ok');
    if (empty.kind !== 'ok') return;
    expect(empty.moved).toEqual([]);
  });

  it('T030 buildMovedFile: moved.ycsf.tf.json, {moved:[...]} content, canonical key order, null when empty (FR-002, US-9 AC1, Sc8)', () => {
    const moved: readonly TerraformMoved[] = [
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.user_api' },
    ];
    const file = buildMovedFile(moved);
    expect(file).not.toBeNull();
    if (!file) return;
    expect(file.filename).toBe('moved.ycsf.tf.json');
    expect(file.filename).toMatch(FILENAME_RE);
    expect(JSON.parse(file.content)).toEqual({
      moved: [{ from: 'yandex_function.users', to: 'yandex_function.user_api' }],
    });
    expect(file.content.indexOf('"from"')).toBeLessThan(file.content.indexOf('"to"'));
    expect(buildMovedFile(moved)?.content).toBe(file.content);

    expect(buildMovedFile([])).toBeNull();
  });
});

function canonical(): Awaited<Parameters<typeof buildMoves>[0]> {
  return [
    endpoint('functions.user_service', 'yandex_function.user_service'),
    endpoint('functions.analytics', 'yandex_function.analytics'),
    endpoint('gateways.openapi', 'yandex_api_gateway.openapi'),
    endpoint('containers.frontend', 'yandex_container.frontend'),
  ];
}