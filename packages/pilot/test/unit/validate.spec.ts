import { describe, expect, it } from 'vitest';

import {
  MOV_CONTRADICTORY,
  MOV_DUPLICATE,
  MOV_INVALID,
  MOV_TYPE_CHANGE,
} from '../../src/contracts/index.js';
import { buildMoves } from '../../src/index.js';
import {
  canonicalCurrentResources,
  endpoint,
  entry,
  movesFrom,
} from '../helpers/moves-fixtures.js';

describe('validateMoves (T016–T019)', () => {
  it('T016 invalid grammar: endpoints/field location + no file/line/column on pure transform (FR-004, Sc7, Sc10)', () => {
    const typed = movesFrom([
      entry(
        endpoint('functions', 'yandex_function.users'),
        endpoint('functions.users', 'yandex_function.user_api'),
      ),
      entry(
        endpoint('functions.accounts', 'yandex_function.accounts'),
        endpoint('functions.accounts', 'yandex_function-accounts'),
      ),
    ]);
    const result = buildMoves(canonicalCurrentResources(), typed);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === MOV_INVALID)).toBe(true);
    const first = result.errors.filter((e) => e.code === MOV_INVALID)[0];
    expect(first).toBeDefined();
    expect(first?.entry).toBeDefined();
    expect(first?.endpoint).toBeDefined();
    expect(first?.field).toBeDefined();
    expect(first?.file).toBeUndefined();
    expect(first?.line).toBeUndefined();
    expect(first?.column).toBeUndefined();
  });

  it('T016b a no-op entry (same from and to) is a defensive MOV_INVALID, not silently accepted (FR-007, Sc10.5)', () => {
    const noop = movesFrom([
      entry(
        endpoint('functions.users', 'yandex_function.users'),
        endpoint('functions.users', 'yandex_function.users'),
      ),
    ]);
    const result = buildMoves([], noop);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]).toMatchObject({ code: MOV_INVALID });
    expect(result.errors[0]?.entry).toBe(0);
  });

  it('T017 type change (IDT root differs between from and to) is an error and blocks (FR-001, US-4 AC1, Sc4)', () => {
    const either = movesFrom([
      entry(
        endpoint('functions.users', 'yandex_function.users'),
        endpoint('containers.users', 'yandex_container.users'),
      ),
    ]);
    const result = buildMoves([], either);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]).toMatchObject({ code: MOV_TYPE_CHANGE, entry: 0 });
  });

  it('T018 exact duplicate entries (same from AND same to) → one MOV_DUPLICATE at the later entry (FR-002, US-6 AC1, Sc1)', () => {
    const e = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.users', 'yandex_function.user_api'),
    );
    const result = buildMoves([], movesFrom([e, e]));
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: MOV_DUPLICATE, entry: 1 });
    expect(result.errors[0]?.code).not.toBe(MOV_CONTRADICTORY);
  });

  it('T019 contradictory entries → MOV_CONTRADICTORY, order-independent and both directions (FR-002, US-5 AC1, Sc5)', () => {
    const left = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.accounts', 'yandex_function.accounts'),
    );
    const sameFrom = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.analytics', 'yandex_function.analytics'),
    );
    const sameTo = entry(
      endpoint('functions.analytics', 'yandex_function.analytics'),
      endpoint('functions.accounts', 'yandex_function.accounts'),
    );

    const ab = buildMoves([], movesFrom([left, sameFrom]));
    const ba = buildMoves([], movesFrom([sameFrom, left]));
    expect(ab.kind).toBe('invalid');
    expect(ba.kind).toBe('invalid');
    if (ab.kind !== 'invalid' || ba.kind !== 'invalid') return;
    expect(ab.errors.some((e) => e.code === MOV_CONTRADICTORY)).toBe(true);
    expect(ba.errors.some((e) => e.code === MOV_CONTRADICTORY)).toBe(true);

    const cd = buildMoves([], movesFrom([left, sameTo]));
    expect(cd.kind).toBe('invalid');
    if (cd.kind !== 'invalid') return;
    expect(cd.errors.some((e) => e.code === MOV_CONTRADICTORY)).toBe(true);
  });
});