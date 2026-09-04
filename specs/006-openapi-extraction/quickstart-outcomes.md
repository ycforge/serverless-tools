# Quickstart outcomes — spec 006 (implemented)

Recorded after `/speckit-implement`, 2026-09-05. Reference: [quickstart.md](./quickstart.md). All scenarios verified via `pnpm --filter @ycforge/composer test`.

| Scenario | Requirement | Verifying test | Outcome |
|----------|-------------|----------------|---------|
| US1 — explicit `openapi_entry`, safe mode | US1/AC1–AC3, SC-002, FR-001/002/009 | `extractOpenApi.success › openapi_entry (explicit) resolves with the document unchanged`; `... sees SERVERLESS_TOOLS_OPENAPI_BUILD=1 inside the runner`; `... never initializes the overflowing provider module` | ✅ green |
| US2 — artifact fallback, no user code executed | US2/AC1–AC3, FR-004/007, SC-003 | `extractOpenApi.artifact › swagger.json is used when no entry is given`; `... swagger.json wins over openapi.json`; `... NO child node process is spawned` | ✅ green |
| US3 — convention fallback via `dist/main` | US3/AC1–AC2, FR-005/002 | `extractOpenApi.convention › dist/main convention is used`; `... sees SERVERLESS_TOOLS_OPENAPI_BUILD=1 inside the runner` | ✅ green |
| US4 — no source → deterministic error | US4/AC1, FR-006 | `extractOpenApi.errors › NO_SOURCE with the fixed terminal message` | ✅ green |
| Edge — broken artifact is fail-fast | US2/AC3, FR-007 | `extractOpenApi.artifact › broken swagger.json → INVALID_ARTIFACT, never falls through to openapi.json` | ✅ green |
| Edge — runner timeout isolation | FR-011 | `spawnRunner › kills a hanging entry as ENTRY_TIMEOUT and leaves the main process alive` | ✅ green |
| Edge — crashed entry point | FR-008 | `spawnRunner › classifies an entry that throws as ENTRY_EXECUTION_FAILED` | ✅ green |

Additional edge coverage added during implementation:

| Scenario | Verifying test | Outcome |
|----------|----------------|---------|
| Entry returns non-object | `extractOpenApi.errors › entry returns a non-object → ENTRY_RETURNED_INVALID` | ✅ green |
| Runner spawn failure (invalid appRoot) | `extractOpenApi.errors › runner spawn failure → RUNNER_SPAWN_FAILED` | ✅ green |
| Missing entry file | `spawnRunner › classifies a missing entry as ENTRY_LOAD_FAILED` | ✅ green |
| Malformed result channel from child | `spawnRunner › classifies a child that writes malformed bytes on the result channel as ENTRY_RETURNED_INVALID` | ✅ green |
| Convention entry without `buildYcsfOpenApi` export | `extractOpenApi.errors › dist/main exists but lacks buildYcsfOpenApi → ENTRY_LOAD_FAILED` | ✅ green |
| User app logs to stdout/stderr (`console.log`) | `spawnRunner › still returns the document when the entry writes to stdout and stderr (console.log)`; safe-entry fixture also logs during entry execution | ✅ green |
| Failure messages sanitized (no app payload leak) | `spawnRunner › classifies an entry that throws as ENTRY_EXECUTION_FAILED without exposing app error detail` (asserts `SUPER-SECRET-xyz` never appears) | ✅ green |
| Failure classification immune to lookalike markers in user stderr | the EXEC fixture writes `SERVERLESS_TOOLS_RUNNER:INVALID` and a mid-line marker mention to stderr before throwing — classification still resolves to `ENTRY_EXECUTION_FAILED` via the trailing marker | ✅ green |
| Bounded stream caps enforced in bytes (UTF-8) | `appendByteCapped › enforces the cap in bytes, not characters (multi-byte UTF-8)` and companions | ✅ green |

Final gate: 29/29 composer tests green, `tsc --noEmit` clean, `pnpm lint` clean, monorepo suite (`pnpm test`) green — 526 total (composer 29 + pilot 55 + nest-bridge 442), zero runtime dependencies. `pnpm test` is self-sufficient from a clean checkout: `test` in nest-bridge runs `tsup && vitest run` because `subpath-exports.spec.ts` type-checks consumers against the built `dist/` declarations.

> Fixture placement note: `quickstart.md` lists `app-broken-artifact/` separately; implementation keeps the broken-swagger variant in `test/fixtures/app-broken-artifact/` (with a valid `openapi.json` present to prove no fall-through), consistent with US2/AC3.