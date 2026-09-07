import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { MOV_INVALID, MOV_VERSION } from '../../src/contracts/index.js';
import { loadMoves } from '../../src/index.js';
import type { TempProject } from '../helpers/temp-project.js';
import { createTempProject, removeTempProject } from '../helpers/temp-project.js';
import { canonicalMovesYaml, movesYaml, writeMovedYaml } from '../helpers/moves-fixtures.js';

let project: TempProject | undefined;

afterEach(() => {
  if (project) {
    removeTempProject(project);
    project = undefined;
  }
});

describe('loadMoves (T031)', () => {
  it('missing .ycsf/moved.yaml → ok {version: 1, moves: []}, never throws (FR-005, US-7 AC3, Sc9)', () => {
    project = createTempProject({});
    const result = loadMoves(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data).toEqual({ version: 1, moves: [] });
    expect(result.data.moves).toEqual([]);
  });

  it('T031b parses a canonical moved.yaml → ok with one ordered entry (FR-005, Sc1)', () => {
    project = createTempProject({});
    writeMovedYaml(project, `${canonicalMovesYaml()}`);
    const result = loadMoves(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.moves).toHaveLength(1);
    expect(result.data.moves[0]).toEqual({
      from: { idl: 'functions.users', idt: 'yandex_function.users' },
      to: { idl: 'functions.users', idt: 'yandex_function.user_api' },
    });
  });

  it('T031c loader diagnostics carry file location; version + structural errors surface (FR-005, Sc7)', () => {
    project = createTempProject({});
    writeMovedYaml(project, 'version: 2\nmoves: []\n');
    const badVersion = loadMoves(project.root);
    expect(badVersion.kind).toBe('invalid');
    if (badVersion.kind !== 'invalid') return;
    expect(badVersion.errors[0]).toMatchObject({
      code: MOV_VERSION,
      file: '.ycsf/moved.yaml',
    });

    writeMovedYaml(project, 'version: 1\n');
    const structural = loadMoves(project.root);
    expect(structural.kind).toBe('invalid');
    if (structural.kind !== 'invalid') return;
    expect(structural.errors[0]).toMatchObject({
      code: MOV_INVALID,
      file: '.ycsf/moved.yaml',
    });
  });

  it('T031d I/O failures other than ENOENT propagate (Sc9)', () => {
    const local = createTempProject({});
    project = local;
    mkdirSync(join(local.root, '.ycsf', 'moved.yaml'), { recursive: true });
    expect(() => loadMoves(local.root)).toThrow();
  });
});