# Specification Quality Checklist: 017 moved

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-07
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

- Items marked complete — all criteria satisfied.
- **No implementation details**: The spec describes WHAT/WHY (format, semantics of moved.yaml, chain resolution, validation/fail-fast rules, compilation to `TerraformMoved[]`). It references the existing contract type `TerraformMoved` (contract 002) and the pure-transform seam conceptually, but does not prescribe code structure, file paths in FRs, libraries, or frameworks. Config snippets (YAML) and `moved {}` blocks are canonical format illustrations, not implementation.
- **No [NEEDS CLARIFICATION] markers**: the normative intent from IDEA §34–35 was prescriptive enough; all material decisions are documented in the Assumptions section (chain linkage by exact `{idl, idt}` pair match; `MOV_DANGLING` vs `MOV_TARGET_UNRESOLVED`; idl-only produces no Terraform block; type-check on `idt` without the 015 side-table; optional file → empty moves).
- **Testable/measurable**: every FR maps to US ACs; every AC is an observable Given/When/Then; SC-001..SC-010 are measurable (block counts, chain depth, no-op vs emitted, determinism, error codes, 100% AC coverage).
- **Scope bounded**: Out-of-scope table lists CLI orchestration (021), `ycsf check` (020), history compaction, provider-level state migration interpretation, dispatch/serialize changes.
- **Dependencies/assumptions identified**: dep = 014; assumptions section comprehensive (chain linkage, terminal correspondence, idl-only, type-chek on idt, partial history, optional file, reuse of `TerraformMoved`, currentResources as input, serialization via 014, fixture resources, no compaction).
- **Constitution alignment**: I (C doesn't own provisioning; Terraform owns `moved` semantics — explicit), III (`version: 1`, `.ycsf/*.yaml`), IV (C doesn't interpret provider state migrations, doesn't read user `.tf`), V (fail-fast, contradictions/duplicates/cycles are errors not silent merges), VI (logical identity stable, renames only via moved.yaml).
