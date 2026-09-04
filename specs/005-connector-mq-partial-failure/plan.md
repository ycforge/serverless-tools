# Implementation Plan: optional per-message error semantics for MQ batch

**Branch**: `005-connector-mq-partial-failure` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-connector-mq-partial-failure/spec.md`

## Summary

Spec 005 adds optional per-message error semantics to the MQ batch dispatch in `@ycforge/nestjs-connector`. Currently, any handler failure stops the entire batch (fail-fast, spec 001). The new feature introduces a **degrade + DLQ** mode: when enabled via transport option, the connector attempts all messages, collects per-message outcomes, acks the batch, and republishes failed messages to a user-specified dead letter queue. Default behavior (fail-fast) is unchanged.

Key technical approach:
- Extend `QueueTransportOptions` with a `partialFailure` option (degrade mode + `deadLetterQueueId`)
- Modify `dispatchQueueHandlers` to support a degrade path that catches per-message failures, collects `MessageOutcome` entries, and continues
- Implement DLQ republishing via Yandex MQ HTTP API (`fetch`, Node 18+) — no new npm dependencies
- Add observability integration: per-message failure records carry `trace_id` from spec 004

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 target, ESNext modules

**Primary Dependencies**: @nestjs/common, @nestjs/core, reflect-metadata, rxjs (peer deps; zero runtime deps)

**Storage**: N/A (stateless connector)

**Testing**: vitest + @swc/core decorator metadata plugin (swc emits `design:paramtypes`; esbuild cannot)

**Target Platform**: Node.js 18+ (Yandex Cloud Functions runtime)

**Project Type**: library (npm package `@ycforge/nestjs-connector`)

**Performance Goals**: no measurable overhead in fail-fast (default) path; degrade path adds one try/catch per message + optional DLQ HTTP call per failed message

**Constraints**: zero new npm dependencies; DLQ republishing uses native `fetch` (Node 18+); IAM token from metadata service

**Scale/Scope**: single package change in `packages/nest-bridge`; ~3-4 source files modified, ~2-3 new files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation of concerns | ✅ | Changes confined to MQ transport (packages/nest-bridge); no cross-package impact |
| II. Spec-first, test-first | ✅ | Spec complete with acceptance criteria; tests generated from AC before implementation |
| III. Contracts versioned | ⚠️ | `QueueTransportOptions` is a public type — adding `partialFailure` is additive (non-breaking); no `.ycsf/*.yaml` changes |
| IV. Terraform stays Terraform | N/A | No Terraform involvement |
| V. Explicit over magic | ✅ | Opt-in via explicit transport option; default = fail-fast (unchanged) |
| VI. Ownership | N/A | No apps/resources changes |

**Post-design re-check**: no new violations. `QueueTransportOptions` extension is additive; no breaking changes to public API.

## Project Structure

### Documentation (this feature)

```text
specs/005-connector-mq-partial-failure/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/nest-bridge/
├── src/
│   ├── core/
│   │   └── handler-options.ts          # MODIFY: add PartialFailureOptions to QueueTransportOptions
│   ├── mq/
│   │   ├── dispatch.ts                 # MODIFY: degrade path in dispatchQueueHandlers
│   │   ├── dispatch.spec.ts            # MODIFY: new tests for degrade mode
│   │   ├── message-outcome.ts          # NEW: MessageOutcome, BatchDispatchResult types
│   │   ├── message-outcome.spec.ts     # NEW: type tests
│   │   ├── dlq-sender.ts              # NEW: DLQ republishing via Yandex MQ HTTP API
│   │   └── dlq-sender.spec.ts         # NEW: DLQ sender tests
│   └── index.ts                        # MODIFY: export new types
└── test/
    └── mq/
        └── partial-failure.integration.spec.ts  # NEW: integration tests
```

**Structure Decision**: Changes are confined to `packages/nest-bridge/src/mq/` and `src/core/handler-options.ts`. New types go in a dedicated `message-outcome.ts` file; DLQ sender in `dlq-sender.ts`. No new packages or cross-package changes.

## Complexity Tracking

> No constitution violations requiring justification.
