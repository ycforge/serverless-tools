# Spec 019 — Requirements Quality Checklist

## Format & Structure

- [x] Metadata block (ID, Title, Status, Dependencies, IDEA sections, Packages)
- [x] Problem Statement (пробел между 014 dispatch и 018 artifact types → нет real materializers)
- [x] Scope with explicit decisions (D-1..D-5)
- [x] User Stories (3 P1, acceptance scenarios per story)
- [x] Requirements section with FR-NNN numbers
- [x] Success Criteria (SC-NNN)
- [x] Assumptions (D-N decisions documented)
- [x] References (specs + IDEA sections + Constitution articles)
- [x] Next Steps (speckit flow)

## Content Quality

- [x] Spec written in Russian (code identifiers, error codes, package names — English)
- [x] Each FR has clear actor and verifiable behavior
- [x] Each AC follows Given/When/Then format
- [x] Each AC is testable (≥1 test per AC — Constitution II)
- [x] No NEEDS CLARIFICATION markers
- [x] Out of Scope explicitly listed
- [x] Error codes defined as constants (YMT_* family)
- [x] Decisions D-1..D-5 documented with rationale

## Contract Compliance

- [x] Materializer shape matches spec 002 (`supports`/`materialize` methods)
- [x] TerraformResource shape matches spec 002 (`kind`, `type`, `name`, `configuration`)
- [x] Artifact.type values match spec 018 forward contract
- [x] Artifact.value shapes documented for new types (`ycforge:api-gateway`, `ycforge:queue`)
- [x] Standalone types (zero pilot imports) — D-2 mirrors spec 018 pattern
- [x] OutputBuilder usage documented for each materializer

## Dependency Validation

- [x] Depends on 002 (pilot-contracts ✅) — defines Materializer, TerraformResource
- [x] Depends on 014 (materializer-dispatch ✅) — dispatch consumes materializers
- [x] References 018 (builders-core ✅) — artifact type catalog
- [x] Forward references: 021 (ycsf CLI) — consumes real materializers
- [x] No circular dependencies
- [x] README.md updated (⬜ → 🚧)

## Consistency

- [x] Package name `@ycforge/materializers-core` follows naming convention
- [x] Subpath export pattern matches `@ycforge/builders-core`
- [x] Diagnostic code prefix `YMT_*` (distinct from `BLC_*`, `MTL_*`)
- [x] Catalog structure mirrors `@ycforge/builders-core/catalog.ts`
- [x] Error types follow `BuilderError` pattern from spec 018
