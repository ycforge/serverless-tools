import { describe, expectTypeOf, it } from 'vitest';

import {
  MOV_CONTRADICTORY,
  MOV_CYCLE,
  MOV_DANGLING,
  MOV_DUPLICATE,
  MOV_INVALID,
  MOV_TARGET_UNRESOLVED,
  MOV_TYPE_CHANGE,
  MOV_VERSION,
  type BuildMovesResult,
  type GeneratedTfFile,
  type MoveEndpoint,
  type MoveEntry,
  type MovesDiagnostic,
  type MovesLoadResult,
  type MovesYaml,
  type ProjectModelDiagnostic,
  type TerraformMoved,
} from '../../src/contracts/index.js';
import { buildMovedFile, buildMoves, loadMoves } from '../../src/index.js';

declare const current: readonly MoveEndpoint[];
declare const yaml: MovesYaml;
declare const moved: readonly TerraformMoved[];

describe('moves contracts (T032)', () => {
  it('MoveEndpoint / MoveEntry / MovesYaml shapes', () => {
    expectTypeOf<MoveEndpoint>().toMatchTypeOf<{ idl: string; idt: string }>();
    expectTypeOf<MoveEntry>().toMatchTypeOf<{ from: MoveEndpoint; to: MoveEndpoint }>();
    expectTypeOf<MovesYaml>().toMatchTypeOf<{ version: 1; moves: readonly MoveEntry[] }>();
  });

  it('TerraformMoved is {kind:"moved"; from; to} exactly', () => {
    expectTypeOf<TerraformMoved>().toMatchTypeOf<{
      kind: 'moved';
      from: string;
      to: string;
    }>();
  });

  it('MovesDiagnostic defines entry/endpoint/field/available on top of code/message', () => {
    expectTypeOf<MovesDiagnostic>().toMatchTypeOf<{
      code: string;
      message: string;
      entry?: number;
      endpoint?: MoveEndpoint;
      field?: string;
      file?: string;
      line?: number;
      column?: number;
      available?: readonly string[];
    }>();
  });

  it('the eight MOV_* codes are distinct literal types', () => {
    expectTypeOf(MOV_VERSION).toEqualTypeOf<'MOV_VERSION'>();
    expectTypeOf(MOV_INVALID).toEqualTypeOf<'MOV_INVALID'>();
    expectTypeOf(MOV_DUPLICATE).toEqualTypeOf<'MOV_DUPLICATE'>();
    expectTypeOf(MOV_TYPE_CHANGE).toEqualTypeOf<'MOV_TYPE_CHANGE'>();
    expectTypeOf(MOV_CONTRADICTORY).toEqualTypeOf<'MOV_CONTRADICTORY'>();
    expectTypeOf(MOV_CYCLE).toEqualTypeOf<'MOV_CYCLE'>();
    expectTypeOf(MOV_TARGET_UNRESOLVED).toEqualTypeOf<'MOV_TARGET_UNRESOLVED'>();
    expectTypeOf(MOV_DANGLING).toEqualTypeOf<'MOV_DANGLING'>();
  });

  it('MovesLoadResult is a discriminated union of ok/invalid', () => {
    expectTypeOf<MovesLoadResult>().toMatchTypeOf<
      | { kind: 'ok'; data: MovesYaml }
      | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] }
    >();
  });

  it('BuildMovesResult is a discriminated union of ok/invalid', () => {
    expectTypeOf<BuildMovesResult>().toMatchTypeOf<
      | { kind: 'ok'; moved: readonly TerraformMoved[] }
      | { kind: 'invalid'; errors: readonly MovesDiagnostic[] }
    >();
  });

  it('public function signatures', () => {
    expectTypeOf(loadMoves).toBeCallableWith('root');
    expectTypeOf(loadMoves).returns.toEqualTypeOf<MovesLoadResult>();
    expectTypeOf(buildMoves).toBeCallableWith(current, yaml);
    expectTypeOf(buildMoves).returns.toEqualTypeOf<BuildMovesResult>();
    expectTypeOf(buildMovedFile).toBeCallableWith(moved);
    expectTypeOf(buildMovedFile).returns.toEqualTypeOf<GeneratedTfFile | null>();
  });
});