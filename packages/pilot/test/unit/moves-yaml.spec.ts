import { describe, expect, it } from 'vitest';

import { MOV_INVALID, MOV_VERSION } from '../../src/contracts/index.js';
import { parseMovesYaml } from '../../src/moves/moves-yaml.js';
import { canonicalMovesYaml, movesYaml } from '../helpers/moves-fixtures.js';

const FILE = '.ycsf/moved.yaml';

function expectInvalidCode(
  result: ReturnType<typeof parseMovesYaml>,
  code: string,
): void {
  expect(result.kind).toBe('invalid');
  if (result.kind === 'ok') return;
  expect(result.errors.some((e) => e.code === code)).toBe(true);
}

describe('parseMovesYaml (T010–T015)', () => {
  it('T010 parses a valid canonical file → ok, version 1, ordered moves (FR-001, US-1, Sc1)', () => {
    const result = parseMovesYaml(canonicalMovesYaml(), FILE);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.version).toBe(1);
    expect(result.data.moves).toHaveLength(1);
    expect(result.data.moves[0]).toEqual({
      from: { idl: 'functions.users', idt: 'yandex_function.users' },
      to: { idl: 'functions.users', idt: 'yandex_function.user_api' },
    });
  });

  it('T011 version gate: missing → MOV_VERSION, unsupported → MOV_VERSION (FR-003, US-7 AC1, Sc7)', () => {
    const missing = parseMovesYaml('moves: []\n', FILE);
    expect(missing.kind).toBe('invalid');
    if (missing.kind === 'ok') return;
    expect(missing.errors).toHaveLength(1);
    expect(missing.errors[0]).toMatchObject({ code: MOV_VERSION, file: FILE });
    expect(missing.errors[0]?.message).toMatch(/missing version/);

    const unsupported = parseMovesYaml('version: 2\nmoves: []\n', FILE);
    expect(unsupported.kind).toBe('invalid');
    if (unsupported.kind === 'ok') return;
    expect(unsupported.errors[0]).toMatchObject({ code: MOV_VERSION });
    expect(unsupported.errors[0]?.message).toMatch(/unsupported version '2'.*supported: 1/);
  });

  it('T012 unknown/structural top-level keys → MOV_INVALID (FR-004, Sc7/Sc10.4)', () => {
    const noMoves = parseMovesYaml('version: 1\n', FILE);
    expectInvalidCode(noMoves, MOV_INVALID);
    if (noMoves.kind === 'invalid') {
      expect(noMoves.errors[0]?.message).toMatch(/moves/);
    }

    const foobar = parseMovesYaml('version: 1\nmoves: []\nfoobar: 1\n', FILE);
    expectInvalidCode(foobar, MOV_INVALID);
    if (foobar.kind === 'invalid') {
      expect(foobar.errors.some((e) => e.message.includes('foobar'))).toBe(true);
    }

    const scalar = parseMovesYaml('version: 1\nmoves: 5\n', FILE);
    expectInvalidCode(scalar, MOV_INVALID);

    const noEntries = parseMovesYaml('version: 1\nmoves:\n', FILE);
    expectInvalidCode(noEntries, MOV_INVALID);
  });

  it('T013 entry grammar: from/to endpoints, IDL 3-segment, IDT 2-part, extra keys → MOV_INVALID (FR-004, US-8 AC1, Sc1)', () => {
    const noTo = parseMovesYaml(movesYaml('  - from:\n      idl: functions.users\n      idt: yandex_function.users\n'), FILE);
    expectInvalidCode(noTo, MOV_INVALID);

    const noFrom = parseMovesYaml(movesYaml('  - to:\n      idl: functions.users\n      idt: yandex_function.users\n'), FILE);
    expectInvalidCode(noFrom, MOV_INVALID);

    const shortIdl = parseMovesYaml(movesYaml('  - from:\n      idl: functions\n      idt: yandex_function.users\n    to:\n      idl: functions.users\n      idt: yandex_function.user_api\n'), FILE);
    expectInvalidCode(shortIdl, MOV_INVALID);
    if (shortIdl.kind === 'invalid') {
      expect(shortIdl.errors[0]?.field).toBe('from.idl');
    }

    const hyphenIdt = parseMovesYaml(movesYaml('  - from:\n      idl: functions.users\n      idt: yandex_function-users\n    to:\n      idl: functions.users\n      idt: yandex_function.user_api\n'), FILE);
    expectInvalidCode(hyphenIdt, MOV_INVALID);
    if (hyphenIdt.kind === 'invalid') {
      expect(hyphenIdt.errors[0]?.field).toBe('from.idt');
    }

    const threePartIdt = parseMovesYaml(movesYaml('  - from:\n      idl: functions.users\n      idt: yandex.function.users\n    to:\n      idl: functions.users\n      idt: yandex_function.user_api\n'), FILE);
    expectInvalidCode(threePartIdt, MOV_INVALID);

    const noop = parseMovesYaml(movesYaml('  - from:\n      idl: functions.users\n      idt: yandex_function.users\n    to:\n      idl: functions.users\n      idt: yandex_function.users\n'), FILE);
    expectInvalidCode(noop, MOV_INVALID);

    const extraKey = parseMovesYaml(movesYaml('  - from:\n      idl: functions.users\n      idt: yandex_function.users\n    to:\n      idl: functions.users\n      idt: yandex_function.user_api\n    weight: 10\n'), FILE);
    expectInvalidCode(extraKey, MOV_INVALID);
  });

  it('T014 multiple errors are collected and file-ordered (FR-005, Sc10.4)', () => {
    const text =
      'version: 1\n' +
      'moves:\n' +
      '  - from:\n' +
      '      idl: functions\n' +
      '      idt: yandex_function.users\n' +
      '    to:\n' +
      '      idl: functions.users\n' +
      '      idt: yandex_function.user_api\n' +
      '  - from:\n' +
      '      idl: functions.users\n' +
      '      idt: yandex_function.users\n' +
      '    to:\n' +
      '      idl: functions.users\n' +
      '      idt: yandex_function-user_api\n' +
      'foobar: 1\n';

    const result = parseMovesYaml(text, FILE);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'ok') return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.every((e) => e.code === MOV_INVALID)).toBe(true);
    expect(result.errors[0]?.field).toBe('from.idl');
    expect(result.errors[1]?.field).toBe('to.idt');
    expect(result.errors[result.errors.length - 1]?.message).toMatch(/foobar/);
  });

  it('T015 YAML syntax errors and duplicate mapping keys → MOV_INVALID with line/column (FR-004, Sc10.4)', () => {
    const syntax = parseMovesYaml('version: 1\nmoves: [unclosed\n', FILE);
    expectInvalidCode(syntax, MOV_INVALID);
    if (syntax.kind === 'invalid') {
      expect(syntax.errors[0]).toMatchObject({ file: FILE });
      expect(syntax.errors[0]?.line).toBeGreaterThan(0);
      expect(syntax.errors[0]?.column).toBeGreaterThan(0);
    }

    const duplicateKey = parseMovesYaml(
      'version: 1\nmoves:\n  - from:\n      idl: functions.users\n      idt: yandex_function.users\n      idt: yandex_function.overridden\n    to:\n      idl: functions.users\n      idt: yandex_function.user_api\n',
      FILE,
    );
    expectInvalidCode(duplicateKey, MOV_INVALID);
    if (duplicateKey.kind === 'invalid') {
      expect(duplicateKey.errors[0]).toMatchObject({ file: FILE });
      expect(duplicateKey.errors[0]?.line).toBeGreaterThan(0);
      expect(duplicateKey.errors[0]?.column).toBeGreaterThan(0);
    }
  });
});