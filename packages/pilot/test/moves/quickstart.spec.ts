import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  BuildMovesResult,
  GeneratedTfFile,
  MoveEndpoint,
  MovesYaml,
  TerraformMoved,
} from '../../src/contracts/index.js';
import {
  MOV_CONTRADICTORY,
  MOV_DANGLING,
  MOV_DUPLICATE,
  MOV_INVALID,
  MOV_TARGET_UNRESOLVED,
  MOV_TYPE_CHANGE,
  MOV_VERSION,
} from '../../src/contracts/index.js';
import { buildMovedFile, buildMoves, loadMoves } from '../../src/index.js';
import { writeGeneratedTerraform } from '../../src/materialize/write.js';
import {
  canonicalCurrentResources,
  canonicalMovesYaml,
  endpoint,
  entry,
  movesFrom,
  writeMovedYaml,
} from '../helpers/moves-fixtures.js';
import type { TempProject } from '../helpers/temp-project.js';
import { createTempProject, removeTempProject } from '../helpers/temp-project.js';

const packageRoot = new URL('../..', import.meta.url);
const repoRoot = new URL('../../../..', import.meta.url);

let project: TempProject | undefined;

afterEach(() => {
  if (project) {
    removeTempProject(project);
    project = undefined;
  }
});

function expectOk(result: BuildMovesResult): readonly TerraformMoved[] {
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') return [];
  return result.moved;
}

describe('quickstart scenarios (T080–T089)', () => {
  it('T080 Sc1 canonical single move end-to-end: loadMoves → buildMoves → buildMovedFile', () => {
    project = createTempProject({});
    writeMovedYaml(project, canonicalMovesYaml());
    const loaded = loadMoves(project.root);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;

    const current = [endpoint('functions.users', 'yandex_function.user_api')];
    const moved = expectOk(buildMoves(current, loaded.data));
    expect(moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.user_api' },
    ]);

    const file = buildMovedFile(moved);
    expect(file).not.toBeNull();
    if (!file) return;
    expect(file.filename).toBe('moved.ycsf.tf.json');
    expect(JSON.parse(file.content)).toEqual({
      moved: [{ from: 'yandex_function.users', to: 'yandex_function.user_api' }],
    });
    expect(buildMovedFile(moved)?.content).toBe(file.content);
  });

  it('T081 Sc2 rename INTO an existing resource → moved emitted, to equals the current idt', () => {
    const current = [endpoint('functions.user_service', 'yandex_function.user_service')];
    const moved = expectOk(
      buildMoves(
        current,
        movesFrom([
          entry(
            endpoint('functions.users', 'yandex_function.users'),
            endpoint('functions.user_service', 'yandex_function.user_service'),
          ),
        ]),
      ),
    );
    expect(moved).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.user_service' },
    ]);
  });

  it('T082 Sc3 multi-hop chain + incomplete history: deterministic, chronological compression', () => {
    const current = [endpoint('functions.accounts', 'yandex_function.accounts')];
    const chain = movesFrom([
      entry(
        endpoint('functions.users', 'yandex_function.users'),
        endpoint('functions.user_service', 'yandex_function.user_service'),
      ),
      entry(
        endpoint('functions.user_service', 'yandex_function.user_service'),
        endpoint('functions.accounts', 'yandex_function.accounts'),
      ),
    ]);
    const a = expectOk(buildMoves(current, chain));
    const b = expectOk(buildMoves(current, chain));
    const incomplete = expectOk(
      buildMoves(
        current,
        movesFrom([
          entry(
            endpoint('functions.users', 'yandex_function.users'),
            endpoint('functions.accounts', 'yandex_function.accounts'),
          ),
        ]),
      ),
    );
    expect(a).toEqual(b);
    expect(a).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.accounts' },
      { kind: 'moved', from: 'yandex_function.user_service', to: 'yandex_function.accounts' },
    ]);
    expect(incomplete).toEqual([
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.accounts' },
    ]);
  });

  it('T083 Sc4 type change is rejected and nothing is emitted (all-or-nothing)', () => {
    const result = buildMoves(
      [endpoint('containers.users', 'yandex_container.users')],
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('containers.users', 'yandex_container.users'),
        ),
        entry(
          endpoint('functions.analytics', 'yandex_function.analytics'),
          endpoint('functions.analytics2', 'yandex_function.analytics2'),
        ),
      ]),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.some((e) => e.code === MOV_TYPE_CHANGE)).toBe(true);
  });

  it('T084 Sc5 duplicates and contradictions are reported order-independently, once each', () => {
    const e = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.accounts', 'yandex_function.accounts'),
    );
    const competitor = entry(
      endpoint('functions.users', 'yandex_function.users'),
      endpoint('functions.analytics', 'yandex_function.analytics'),
    );

    const dupThenContra = buildMoves([], movesFrom([e, e, competitor]));
    const contraThenDup = buildMoves([], movesFrom([e, competitor, e]));
    expect(dupThenContra.kind).toBe('invalid');
    expect(contraThenDup.kind).toBe('invalid');
    if (dupThenContra.kind !== 'invalid' || contraThenDup.kind !== 'invalid') return;
    expect(
      dupThenContra.errors.filter((d) => d.code === MOV_DUPLICATE),
    ).toHaveLength(1);
    expect(
      dupThenContra.errors.filter((d) => d.code === MOV_CONTRADICTORY),
    ).toHaveLength(1);
    expect(
      contraThenDup.errors.filter((d) => d.code === MOV_DUPLICATE),
    ).toHaveLength(1);
    expect(
      contraThenDup.errors.filter((d) => d.code === MOV_CONTRADICTORY),
    ).toHaveLength(1);
  });

  it('T085 Sc6 dangling chain: N MOV_DANGLING + one MOV_TARGET_UNRESOLVED with available idls', () => {
    const current = canonicalCurrentResources();
    const chainComponents: readonly [MoveEndpoint, MoveEndpoint][] = [
      [endpoint('functions.users', 'yandex_function.users'), endpoint('functions.user_service', 'yandex_function.user_service')],
      [endpoint('functions.user_service', 'yandex_function.user_service'), endpoint('functions.analytics', 'yandex_function.analytics')],
      [endpoint('functions.analytics', 'yandex_function.analytics'), endpoint('functions.sales', 'yandex_function.sales')],
    ];
    const live: readonly [MoveEndpoint, MoveEndpoint] = [
      endpoint('gateways.old', 'yandex_api_gateway.old'),
      endpoint('gateways.openapi', 'yandex_api_gateway.openapi'),
    ];
    const result = buildMoves(
      current,
      movesFrom([
        ...chainComponents.map(([f, t]) => entry(f, t)),
        entry(live[0], live[1]),
      ]),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors.filter((e) => e.code === MOV_DANGLING)).toHaveLength(3);
    const unresolved = result.errors.find((e) => e.code === MOV_TARGET_UNRESOLVED);
    expect(unresolved?.endpoint).toEqual(endpoint('functions.sales', 'yandex_function.sales'));
    expect(unresolved?.available).toEqual([
      'containers.frontend',
      'functions.analytics',
      'functions.user_service',
      'gateways.openapi',
    ]);
  });

  it('T086 Sc7 idl-only change compiles to an empty moved list', () => {
    const result = buildMoves(
      canonicalCurrentResources(),
      movesFrom([
        entry(
          endpoint('functions.accounts', 'yandex_function.analytics'),
          endpoint('functions.analytics', 'yandex_function.analytics'),
        ),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.moved).toEqual([]);
  });

  it('T087 Sc8 optional/deterministic: empty moves, canonical output, byte-identical files', () => {
    const empty = buildMoves(canonicalCurrentResources(), movesFrom([]));
    expect(empty.kind).toBe('ok');
    if (empty.kind !== 'ok') return;
    expect(empty.moved).toEqual([]);
    expect(buildMovedFile(empty.moved)).toBeNull();

    const moved: readonly TerraformMoved[] = [
      { kind: 'moved', from: 'yandex_function.users', to: 'yandex_function.accounts' },
    ];
    const file = buildMovedFile(moved);
    const file2 = buildMovedFile(moved);
    expect(file?.content).toBe(file2?.content);
  });

  it('T088 Sc9 loader handles missing file and returns diagnostics with file location', () => {
    project = createTempProject({});
    expect(loadMoves(project.root)).toEqual({ kind: 'ok', data: { version: 1, moves: [] } });

    writeMovedYaml(project, 'version: 3\nmoves: []\n');
    const bad = loadMoves(project.root);
    expect(bad.kind).toBe('invalid');
    if (bad.kind !== 'invalid') return;
    expect(bad.errors[0]).toMatchObject({ code: MOV_VERSION, file: '.ycsf/moved.yaml' });
  });

  it('T089 Sc10 defensive: no-op, structural, and grammar violations are MOV_INVALID, never silent (FR-006/007)', () => {
    const noop = buildMoves(
      [endpoint('functions.users', 'yandex_function.users')],
      movesFrom([
        entry(
          endpoint('functions.users', 'yandex_function.users'),
          endpoint('functions.users', 'yandex_function.users'),
        ),
      ]),
    );
    expect(noop.kind).toBe('invalid');
    if (noop.kind !== 'invalid') return;
    expect(noop.errors.some((e) => e.code === MOV_INVALID)).toBe(true);

    const grammar = buildMoves(
      [],
      movesFrom([
        entry(
          endpoint('functions', 'yandex_function.users'),
          endpoint('functions.users', 'yandex_function.user_api'),
        ),
      ]),
    );
    expect(grammar.kind).toBe('invalid');
    if (grammar.kind !== 'invalid') return;
    expect(grammar.errors.some((e) => e.code === MOV_INVALID)).toBe(true);
  });
});

describe('spec 017 guards (T103–T105)', () => {
  it('T103 static guard: CPU-only modules carry no fs path/yaml imports; MOV_* catalog matches specs/017-moved/contracts', () => {
    const srcMoves = new URL('./src/moves/', packageRoot);
    for (const mod of ['validate', 'chain', 'build']) {
      const src = readFileSync(new URL(`${mod}.ts`, srcMoves), 'utf8');
      expect(src).not.toMatch(/from 'node:fs/);
      expect(src).not.toMatch(/from 'node:path/);
      expect(src).not.toMatch(/from 'yaml'/);
    }

    const srcContracts = readFileSync(
      new URL('./src/contracts/moves.ts', packageRoot),
      'utf8',
    );
    const specContracts = readFileSync(
      new URL('specs/017-moved/contracts/moves.ts', repoRoot),
      'utf8',
    );
    const codes = (text: string): string[] => [
      ...text.matchAll(/export const (MOV_\w+) =/g),
    ].map((m) => m[1] ?? '');
    expect(codes(srcContracts).sort()).toEqual(codes(specContracts).sort());

    const catalog = JSON.parse(
      readFileSync(new URL('specs/017-moved/contracts/moves.json', repoRoot), 'utf8'),
    ) as { errorCodes: { properties: Record<string, unknown> } };
    const catalogCodes = Object.keys(catalog.errorCodes.properties).sort();
    expect(codes(srcContracts).sort()).toEqual(catalogCodes);
  });

  it('T104 write ownership: overall moved.ycsf.tf.json via writeGeneratedTerraform; C-owned stale removed on empty run', async () => {
    project = createTempProject({
      'infra/user.tf': '# user terraform stays\n',
      'infra/moved.ycsf.tf.json': '{"moved":[{"from":"stale","to":"stale"}]}\n',
    });
    const infraDir = join(project.root, 'infra');

    const movedFile: GeneratedTfFile = {
      filename: 'moved.ycsf.tf.json',
      content: '{"moved":[]}\n',
    };
    const appFile: GeneratedTfFile = {
      filename: 'user_service.ycsf.tf.json',
      content: '{"resource":{}}\n',
    };
    await writeGeneratedTerraform(infraDir, [movedFile, appFile]);
    expect(readFileSync(join(infraDir, 'moved.ycsf.tf.json'), 'utf8')).toBe(
      '{"moved":[]}\n',
    );
    expect(readFileSync(join(infraDir, 'user_service.ycsf.tf.json'), 'utf8')).toBe(
      '{"resource":{}}\n',
    );
    expect(readFileSync(join(infraDir, 'user.tf'), 'utf8')).toBe(
      '# user terraform stays\n',
    );

    expect(buildMovedFile([])).toBeNull();
    await writeGeneratedTerraform(infraDir, []);
    expect(existsSync(join(infraDir, 'moved.ycsf.tf.json'))).toBe(false);
    expect(existsSync(join(infraDir, 'user_service.ycsf.tf.json'))).toBe(false);
    expect(readFileSync(join(infraDir, 'user.tf'), 'utf8')).toBe(
      '# user terraform stays\n',
    );
  });

  it('T105 perf smoke: ~50 entries over ~25 current resources well under 5s, byte-deterministic', () => {
    const entries: [MoveEndpoint, MoveEndpoint][] = [];
    for (let i = 0; i < 25; i++) {
      entries.push([
        endpoint(`functions.chain${i}_a`, `yandex_function.chain${i}_a`),
        endpoint(`functions.chain${i}_b`, `yandex_function.chain${i}_b`),
      ]);
      entries.push([
        endpoint(`functions.chain${i}_b`, `yandex_function.chain${i}_b`),
        endpoint(`functions.chain${i}_c`, `yandex_function.chain${i}_c`),
      ]);
    }
    const current = Array.from({ length: 25 }, (_, i) =>
      endpoint(`functions.chain${i}_c`, `yandex_function.chain${i}_c`),
    );
    const moves: MovesYaml = movesFrom(entries.map(([f, t]) => entry(f, t)));

    const start = performance.now();
    const result = buildMoves(current, moves);
    const elapsed = performance.now() - start;
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.moved).toHaveLength(50);
    expect(elapsed).toBeLessThan(5000);
    const second = buildMoves(current, moves);
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') return;
    expect(result.moved).toEqual(second.moved);
    expect(buildMovedFile(result.moved)?.content).toBe(buildMovedFile(result.moved)?.content);

    for (const mod of ['validate', 'chain', 'build']) {
      const src = readFileSync(new URL(`./src/moves/${mod}.ts`, packageRoot), 'utf8');
      expect(src).not.toMatch(/Math\.random\(/);
      expect(src).not.toMatch(/Date\.now\(/);
    }
  });
});