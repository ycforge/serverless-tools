/**
 * Public contracts of the moved feature (spec 017): `.ycsf/moved.yaml`
 * load/buildMoves API, MOV_* diagnostic codes and result shapes. Mirrors
 * contract versioning rules — codes live here, consumers compare against the
 * MOV_* constants (Constitution V), the YAML format carries `version: 1`.
 *
 * Type-level draft of `packages/pilot/src/contracts/moves.ts` (type-only +
 * pure constants, zero runtime dependencies — the static-consistency test
 * `T###` compares this catalog against `contracts/moves.json` #/errorCodes).
 */

import type { ProjectModelDiagnostic } from './project-model';
import type { TerraformMoved } from './terraform';

export const MOV_VERSION = 'MOV_VERSION' as const;
export const MOV_INVALID = 'MOV_INVALID' as const;
export const MOV_DUPLICATE = 'MOV_DUPLICATE' as const;
export const MOV_TYPE_CHANGE = 'MOV_TYPE_CHANGE' as const;
export const MOV_CONTRADICTORY = 'MOV_CONTRADICTORY' as const;
export const MOV_CYCLE = 'MOV_CYCLE' as const;
export const MOV_TARGET_UNRESOLVED = 'MOV_TARGET_UNRESOLVED' as const;
export const MOV_DANGLING = 'MOV_DANGLING' as const;

/** One side of a migration: logical identity (IDL) + Terraform address (IDT). */
export interface MoveEndpoint {
  readonly idl: string;
  readonly idt: string;
}

/** One migration record in `.ycsf/moved.yaml`. */
export interface MoveEntry {
  readonly from: MoveEndpoint;
  readonly to: MoveEndpoint;
}

/** Parsed `.ycsf/moved.yaml` document (`version: 1`). */
export interface MovesYaml {
  readonly version: 1;
  readonly moves: readonly MoveEntry[];
}

/**
 * Validation problem reported by `buildMoves`. Compared via MOV_* codes.
 * Structural diagnostics of `loadMoves` reuse the ProjectModelDiagnostic
 * shape (spec 011); semantic diagnostics of `buildMoves` carry `entry` /
 * `endpoint` / `available` and no file location (pure transform).
 */
export interface MovesDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly entry?: number;
  readonly endpoint?: MoveEndpoint;
  readonly field?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly available?: readonly string[];
}

/** Result of `loadMoves(rootDir)`. Missing file → ok with `moves: []` (file is optional, FR-002). */
export type MovesLoadResult =
  | { kind: 'ok'; data: MovesYaml }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

/** Result of `buildMoves(currentResources, moves)`. All-or-nothing (FR-013). */
export type BuildMovesResult =
  | { kind: 'ok'; moved: readonly TerraformMoved[] }
  | { kind: 'invalid'; errors: readonly MovesDiagnostic[] };