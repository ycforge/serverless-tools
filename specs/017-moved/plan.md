# Implementation Plan: moved — import history and `TerraformMoved[]` compile

**Branch**: `017-moved` | **Date**: 2026-09-07 | **Spec**: [specs/017-moved/spec.md](../../specs/017-moved/spec.md)

**Input**: Feature specification from `/specs/017-moved/spec.md`

**Note**: This template is filled in by the `/skill:speckit-plan` command; its definition describes the execution workflow.

## Summary

Add to `@ycforge/pilot` (Project C) the optional per-project import-history file `.ycsf/moved.yaml` (`version: 1`, `moves` list of `{from, to}` `{idl, idt}` endpoint pairs) and a pure transform `buildMoves(currentResources, moves)` that validates it and compiles `moved` blocks (`TerraformMoved` contract 002) for Terraform: chains link by exact `prev.to === next.from`, terminal must match a current resource pair (FR-010), `from` = historical address, `to` = current address (FR-012), idl-only steps emit no block (FR-011). 8 load/validation error codes (MOV_*), collect-all, all-or-nothing (FR-013), deterministic output independent of file order (FR-016). `loadMoves` is fs-only, missing file → ok with `moves: []`; `buildMoves` is pure (no I/O). Compile output goes through the existing materialize pipeline (014) as `moved.ycsf.tf.json`; orchestration calls it in 021. Research: `specs/017-moved/research.md`.

## Technical Context

**Language/Version**: TypeScript ~5.x (repo standard); Node >= 20; native `node:yaml` unavailable — existing `yaml` dep (used by 015 extensions) reused in parse-gate only.

**Primary Dependencies**: existing `yaml` (parse gate, `parseDocument({ uniqueKeys: true })`); `@ycforge/pilot` internals only. ✚ **zero new deps** (research 6). `src/contracts/moves.ts` is type-only + constants, zero-dep module.

**Storage**: `.ycsf/moved.yaml` (optional, filesystem, IDEA §35); compiled output emitted via existing `writeGeneratedTerraform` (014) — `moved.ycsf.tf.json` matches the `*.ycsf.tf.json` FILENAME_RE. No SQL/other stores.

**Testing**: vitest per-package (`pnpm --filter @ycforge/pilot test`); test-first per Constitution II. Unit: `test/unit/{moves-yaml,validate,chain,build-moves}.spec.ts`; quickstart integration: `test/moves/quickstart.spec.ts`; type-test `test/types/moves.test-d.ts` (empty-check, endpoint types). Fixtures: `test/helpers/moves-fixtures.ts`; loader I/O via `test/helpers/temp-project.ts` (mkdtemp).

**Target Platform**: Node.js CLI / library (pilot package); produced `.tf.json` targets HashiCorp Terraform ≥1.1 (moved block).

**Project Type**: library package inside the `serverless-tools` monorepo (pilot = Project C orchestration/build).

**Performance Goals**: linear in entries/chains: `O(n)` per validation pass + `O(n)` chain walk; per-chain terminal lookup on a `Map` (`O(1)`); compile `O(n)`; idl-only dedup `O(n)` with prev-address scan. Deterministic maps (first-wins) so output order is reproducible (FR-016).

**Constraints**: pure transforms — `buildMoves` MUST NOT touch fs/terraform (FR-014, Constitution IV); grammar IDL two-segment `[a-z][a-z0-9_]*`, IDT `[a-zA-Z_][a-zA-Z0-9_]*`; fail-fast on collisions (duplicates/contradictions/cycles/type-change); all-or-nothing compile (FR-013); messages deterministic (sorted available). No network calls.

**Scale/Scope**: small per-project histories (1–50 entries typical); 017 is additive, changes no existing modules (see Structure Decision); orchestration/CLI surface in 021.

**Constraints re: existing contracts**: `TerraformMoved` (contract 002, `src/contracts/terraform.ts`) reused as-is — never redefined (FR-015). `serializeJson` (014) reused as-is — never modified (research 1). `write.ts`, `FILENAME_RE`, stale cleanup (014) untouched. STRUCTURE/parse-gate mirrors 015 `extensions-yaml.ts`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I Separation of Concerns**: A (runtime) untouched; B (composer) untouched; C (pilot) owns moves build; Terraform owns `state mv` execution (018/022; moved block is declaration, not execution). ✔
- **II Spec-first / Test-first**: FR-004..FR-016 → acceptance criteria; RED before implementation; thrown user errors tested user-visible. ✔
- **III Contract Versioning**: new `.ycsf/moved.yaml` format starts at `version: 1`; MOV_VERSION rejects non-1; `TerraformMoved` (002) reused unchanged; new contracts exported from public barrels. ✔
- **IV Explicit-over-Magic**: no auto-renames, no silent merges (MOV_CONTRADICTORY/MOV_DUPLICATE/MOV_TYPE_CHANGE fail-fast); no implicit fs access; `from`-still-current = deep-TF validation only, documented (open seam), no new error code. ✔
- **V Constants-not-literals**: MOV_* constants in `src/contracts/moves.ts`; compared via constants (Constitution V); contract consistency T-tests: `contracts/moves.json` (#/errorCodes) ↔ `contracts/moves.ts` ↔ implementation. ✔
- **VI 'You aren't gonna need it'**: no `ycsf check` plumbing (020), no orchestration (021), no CLI flags, no partial-write modes — added only when those specs land. ✔
- **VII Message Style**: user-facing publishable diagnostics — `MOV_TARGET_UNRESOLVED` message mentions terminal + available identities (sorted) — established patterns of MTL_*/PML_* messages. ✔

**Result**: GATE passed (Phase 0). Re-checked after Phase 1 — no violations. Complexity Tracking: none.

## Project Structure

### Documentation (this feature)

```text
specs/017-moved/
├── plan.md              # This file (/skill:speckit-plan command output)
├── research.md          # Phase 0 output (decisions 1–6)
├── data-model.md        # Phase 1 output (entities, flows, validation rules, MOV_* catalog)
├── quickstart.md        # Phase 1 output (acceptance scenarios Sc1..Sc10)
├── contracts/           # Phase 1 output
│   ├── moves.json       # JSON Schema + #/errorCodes (source of truth for MOV_* T-tests)
│   └── moves.ts         # type-level draft of src/contracts/moves.ts
└── tasks.md             # Phase 2 output (/skill:speckit-tasks command — NOT created here)
```

### Source Code (repository root)

```text
packages/pilot/
├── src/
│   ├── contracts/
│   │   ├── terraform.ts        # existing: TerraformMoved (REUSED, unchanged) + GeneratedTfFile
│   │   ├── moves.ts            # NEW zero-dep: MoveEndpoint/MoveEntry/MovesYaml/MovesDiagnostic
│   │   │                       #   + MovesLoadResult/BuildMovesResult + MOV_* constants
│   │   └── index.ts            # UPDATE: re-export moves contracts
│   ├── moves/
│   │   ├── moves-yaml.ts       # parseMovesYaml(text, filename): parse gate + structure + MOV_* loader diags
│   │   ├── loader.ts           # loadMoves(rootDir): fs read (ENOENT → ok moves:[]), parseMovesYaml
│   │   ├── validate.ts         # validateMoves(moves): entry-level + cross-entry
│   │   ├── chain.ts            # buildChains(moves, currentResources): chain walk + cycles + terminal resolution
│   │   ├── build.ts            # buildMoves(...) → BuildMovesResult; buildMovedFile(moved) → GeneratedTfFile|null
│   │   ├── errors.ts           # MovesError factory (message building, sorted available)
│   │   └── index.ts            # NEW public surface: loadMoves, buildMoves, buildMovedFile
│   └── index.ts                # UPDATE: re-export src/moves public API
├── test/
│   ├── unit/
│   │   ├── moves-yaml.spec.ts  # parse gate + MOV_VERSION/MOV_INVALID + collect-all
│   │   ├── validate.spec.ts    # duplicate/contradictory/type-change/no-op + defensive MOV_INVALID
│   │   ├── chain.spec.ts       # chains, cycles, terminal resolution, dangling, canonical order
│   │   └── build-moves.spec.ts # compile semantics, idl-only dedup, all-or-nothing, determinism, buildMovedFile
│   ├── moves/
│   │   └── quickstart.spec.ts  # Sc1..Sc10 against canon project (user_service/analytics/frontend/openapi)
│   ├── helpers/
│   │   ├── moves-fixtures.ts   # Fujendra-like: endpoint()/entry()/canonicalMovesYaml/currentResources
│   │   └── temp-project.ts     # existing (mkdtemp) — loader I/O tests reuse
│   └── types/
│       └── moves.test-d.ts     # #type-test: endpoint/moves shapes, empty-check
```

**Structure Decision**: additive single-package feature in `packages/pilot`. New leaf modules `src/moves/*` beside the existing `src/extensions/*` (015) and `src/materialize/*` (014); a single new zero-dep `src/contracts/moves.ts` plus additive re-exports in the two barrels. `package.json` exports and `tsup.config.ts` are NOT modified (research 6): implementation is internal, public surface already covered by `*` subpath. Single-project option applies (repo rule: no new packages).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. (Two `src/moves` modules — `validate.ts` + `chain.ts` — split intentionally to keep RED GREEN test surfaces (validation vs chain building) independent, mirroring 015's `idl.ts`/`deep-merge.ts` split. Not tracked as complexity.)

## Phases

### Phase 0 — Research (DONE)

`research.md` written; decisions 1–6 locked (JSON moved shape confirms HashiCorp docs; chain algorithm; terminal resolution; idl-only emission; pure-transform boundaries; layer layout). Web-checked: Terraform JSON syntax (top-level `moved` array of `{from,to}` strings) and moved block semantics (from/to are addresses). ✔ no new dependencies.

### Phase 1 — Design (DONE)

`data-model.md`, `contracts/moves.json`, `contracts/moves.ts`, `quickstart.md` written. Public API frozen:

- `loadMoves(rootDir): MovesLoadResult` — fs + parse gate + structure; missing file → ok with `moves: []`.
- `buildMoves(currentResources, moves): BuildMovesResult` — pure validation + chain resolve + compile; all-or-nothing.
- `buildMovedFile(moved): GeneratedTfFile | null` — thin wrapper over `serializeJson` (014); filename `moved.ycsf.tf.json`; null when empty.

Implementation modules mapped (see Source Code). Feasibility: all seams verified against 014/015 sources (parse gate `extensions-yaml.ts`, `diag` `model/errors.ts`, `serializeJson`, write glob, temp-project helper).

### Phase 2 — Tasks

Delegated to `/speckit-tasks`; mandates derived from requirements checklist in `checklists/requirements.md`: RED test-first, single-file mounts, canonical project scenario fixtures, `T###` contract-consistency test (`contracts/moves.json` ↔ `contracts/moves.ts` ↔ implementation), final manual review. 021 orchestration explicitly out of scope (call-site seam documented).

## Key Decisions (Locked)

| # | Decision | Rejected alternative |
|---|----------|---------------------|
| 1 | JSON moved = top-level `{"moved":[{from,to}...]}`; emit via `buildMovedFile` wrapper over existing `serializeJson` | new writer / modifying serializer 014 |
| 2 | Chain walk on degree≤1 graph from indegree-0 starts; cycles = unreachable components → one MOV_CYCLE; canonical chain order by `start.idl` then `start.idt` (not file order) | preserving file order in `moved` (violates FR-016) |
| 3 | Terminal resolution by exact-pair Map vs currentResources; UNRESOLVED on terminal (1×) + DANGLING per entry (N×); contradictions already impossible by same-from / same-to rules | new MOV_* code for duplicate current endpoints (single-code guarantee stays 8) |
| 4 | idl-only: emit by distinct historical addresses (skip `address === current.idt`, dedup adjacent identical); `to` = current.idt always | emitting a block for address-equal steps |
| 5 | `buildMoves` pure (no fs); fs only in loader; yaml only in parse gate; missing file → ok `moves: []` | throwing EXT_MISSING_FILE-style; loading in buildMoves |
| 6 | Additive layout: `src/moves/*` + `src/contracts/moves.ts`; package.json/tsup unchanged | enlarging 014 to own moves; new export paths |
| 7 | `from`-still-current = ambiguous Terraform graph → maps to deep-TF validation (Constitution IV), documented open seam; no user-check pass in 017 | new MOV_* error at build time |

## Risks / Open Seams

| Risk | Mitigation / Ownership |
|------|------------------------|
| Orchestration call-site (dispatch → buildMoves → buildMovedFile → append to fileset) belongs to 021 | explicit `buildMoves(currentResources, ...)` + `buildMovedFile` pure seams leave 021 free to compose; seam documented in data-model/research |
| SE0004 `ycsf check` (020) needs validation without fs | `buildMoves` carries validation independent from `loadMoves` (programmatic MovesYaml accepted, defensive MOV_INVALID) |
| `from` still declared as a current resource in same infraDir → Terraform ambiguous move | Terraform-fileset validation stage (constitution IV); noted in quickstart Sc10.6, not a MOV_* error in this spec |
| Contracts drift (moves.json ↔ moves.ts ↔ implementation) | `T###` static consistency test equalizes error-codes catalog; barrel re-exports included in tests |
| Deterministic output across tool versions | canonical ordering (research 2/4) + first-wins maps; FR-016 asserts deep-equality across reordered inputs |
| Pre-existing LSP noise in `composer/test/fixtures/*` (dup YAML keys) | unrelated to 017; left untouched |