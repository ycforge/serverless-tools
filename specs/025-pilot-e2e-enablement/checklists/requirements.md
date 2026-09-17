# Specification Quality Checklist: pilot-e2e-enablement — `@ycforge/pilot`, значения артефактов, artifact-типы в реестре, suspicious-keys check

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- All 16 items pass. Spec is ready for `/speckit.plan`.
- Scope strictly Project C (`packages/pilot` only): value threading (BIG-1), registry artifact-type keys (BIG-2), suspicious-keys category in `ycsf check` (BIG-6). Nothing in `packages/composer`, `packages/builders-core`, `packages/materializers-core`, no dialect apps.yaml (026), no docker `no_push` (027).
- FR-001–FR-016 are testable: pure-function parsers/validators for builders.yaml and outputs, fake materializers that read `value` (mirroring real structure without cwd calls), one in-memory integration test against real builders-core/materializers-core, table-driven suspicious-keys tests.
- D-1..D-6 record real design choices: value flow via dispatch options → descriptor → `DispatchResult.materializerOutputs` (single source, no `new Map()` literal), standalone `materialize` preserved, auto-output prefix relaxation (D-3, strict relaxation of spec 016; `OUT_INVALID_AUTO_PREFIX` frozen + superseded, does NOT break any previously-valid input), deterministic EXACT/SUFFIX denylist for suspicious keys, builders-section identity, raw-YAML value-free scanning.
- 0 [NEEDS CLARIFICATION] markers — all ambiguity resolved via documented decisions/assumptions (D-1..D-6, A-1..A-8).
- Diagnostics family `YCK_*`/`MTL_*`/`OUT_*` preserved; new code `YCK_SUSPICIOUS_KEY` mirrors repo convention.
- Contract additive only: `ArtifactDescriptor.value?`, `DispatchOptions.artifacts?`, `DispatchResult.ok.materializerOutputs`, new `YCK_SUSPICIOUS_KEY`; no existing type altered (type-tests guard this).
- Coordination note (outside scope): materializers-core cwd-dependence (api-gateway companion file, path hashing) is an 019 package defect fixed in the B layer by a separate change.