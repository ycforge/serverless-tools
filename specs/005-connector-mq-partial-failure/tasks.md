# Tasks: optional per-message error semantics for MQ batch

**Input**: Design documents from `/specs/005-connector-mq-partial-failure/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/queue-transport-options.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create type definitions and extend public API contract

- [x] T001 [P] Add `PartialFailureOptions` interface to `packages/nest-bridge/src/core/handler-options.ts` and extend `QueueTransportOptions` with optional `partialFailure` field per contracts/queue-transport-options.md
- [x] T002 [P] Create `MessageOutcome`, `MessageError`, and `BatchDispatchResult` types in new file `packages/nest-bridge/src/mq/message-outcome.ts` per data-model.md
- [x] T003 [P] Add `DlqSendRequest` internal interface in new file `packages/nest-bridge/src/mq/dlq-sender.ts` (just the interface; class body follows in Phase 2)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure — interface changes and DLQ sender — MUST complete before any user story work

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement `DlqSender` class in `packages/nest-bridge/src/mq/dlq-sender.ts`: lazy IAM token fetch from metadata service with TTL caching (~1 hour, 5-minute refresh margin), `send(body, queueId)` method that POSTs to Yandex MQ HTTP API via native `fetch`; DLQ send failures are logged as warnings and do NOT throw (fail-open per FR-011)
- [x] T005 Modify `dispatchQueueHandlers` signature in `packages/nest-bridge/src/mq/dispatch.ts` to accept optional `options?: QueueTransportOptions` parameter; when `partialFailure` is absent/false, retain existing fail-fast behavior byte-for-byte (FR-001, FR-004, FR-008). Do NOT implement the degrade path yet — that comes in T008 after US1 tests are RED.
- [x] T006 Add `PartialFailureOptions`, `MessageOutcome`, `MessageError`, and `BatchDispatchResult` type-only exports to `packages/nest-bridge/src/index.ts` per contracts/queue-transport-options.md §Exported Types

**Checkpoint**: Interface changes in place; `DlqSender` ready; fail-fast behavior unchanged. US1 tests can now be written against the new signature.

---

## Phase 3: User Story 1 — Developer doesn't block queue with poison message (Priority: P1) 🎯 MVP

**Goal**: Per-message continuation when one message fails in a batch — failed message is skipped, remaining messages are attempted

**Independent Test**: Batch with `messages[1]` throwing in handler: with degrade enabled, `messages[0]` and `messages[2]` are processed; without degrade, entire batch rejects at `messages[1]` (fail-fast parity)

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation (Constitution II)**

- [x] T007 [P] [US1] Add degrade-mode dispatch tests in `packages/nest-bridge/src/mq/dispatch.spec.ts`: (a) batch with one failing message — all messages attempted, outcomes collected in order; (b) all messages succeed in degrade mode — result identical to fail-fast; (c) empty handler list still throws `ConnectorError.noQueueHandler` regardless of degrade mode (FR-007); (d) `partialFailure: { deadLetterQueueId: "q" }` without `enabled: true` → fail-fast, no DLQ send (config validation); (e) invocation isolation — two sequential dispatch calls in degrade mode with different failure sets yield independent `BatchDispatchResult` (FR-012)

### Implementation for User Story 1

- [x] T008 [US1] Implement degrade path in `packages/nest-bridge/src/mq/dispatch.ts`: when `options?.partialFailure?.enabled` is true, wrap per-message delivery in try/catch that collects `MessageOutcome` entries into a `BatchDispatchResult` and continues to next message on handler throw; when degrade path has failures, invoke `DlqSender` for each failed `messageId` using `options.partialFailure.deadLetterQueueId` (or log warning if absent). Ensure the try/catch catches ONLY handler throw (not DI resolution failure or deserialization failure — those remain whole-invocation failures per FR-005, FR-007)
- [x] T009 [US1] Add `PartialFailureOptions` validation guard: `enabled` must be explicitly `true` for degrade path; `deadLetterQueueId` without `enabled` is ignored (fail-fast)

**Checkpoint**: At this point, User Story 1 should be fully functional — per-message continuation works, fail-fast default unchanged. Run `pnpm --filter @ycforge/nestjs-connector test` — all tests GREEN.

---

## Phase 4: User Story 2 — Developer sees per-message outcome for tracing (Priority: P2)

**Goal**: Per-message outcomes carry `trace_id` from invocation context and never expose payload/token/header values

**Independent Test**: Batch with two failures and one success: result has per-message outcomes (messageId → success/failure), stdout log carries common `trace_id` and mentions failed messages without payload values

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T010 [P] [US2] Add type tests in `packages/nest-bridge/src/mq/message-outcome.spec.ts`: `MessageOutcome` structure validation (messageId present, error absent when success=true, error contains only name+message)
- [x] T011 [P] [US2] Add observability integration test in `packages/nest-bridge/test/mq/partial-failure.integration.spec.ts` (new file): batch with failing messages in degrade mode — log output includes invocation `trace_id`/`awsRequestId` for each failure record, and no payload/token/header/raw values appear in the log (FR-010, SC-004)

### Implementation for User Story 2

- [x] T012 [US2] In `packages/nest-bridge/src/mq/dispatch.ts`, read invocation execution context via `resolveInvocationExecutionContext()` and include `trace_id`/`awsRequestId` in per-message failure log entries (FR-009); ensure log entries contain only `messageId` + error name/message — no payload, tokens, headers, or raw body (FR-010)

**Checkpoint**: Per-message outcomes are visible and correlated with invocation trace; no sensitive data leaks

---

## Phase 5: User Story 3 — Developer manages batch outcome on partial failure (Priority: P2)

**Goal**: Invocation result is deterministic based on degrade policy — ack batch when degrade enabled, exception when fail-fast

**Independent Test**: For each policy — batch with a failing message finishes with predictable outcome (success/exception) matching the policy, while preserving per-message outcomes from US2

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T013 [P] [US3] Add DLQ sender tests in `packages/nest-bridge/src/mq/dlq-sender.spec.ts`: (a) successful send — correct HTTP request shape (POST, JSON body with messageBody/queueId); (b) IAM token cached across calls; (c) send failure logged as warning, does not throw (fail-open)
- [x] T014 [P] [US3] Add integration test in `packages/nest-bridge/test/mq/partial-failure.integration.spec.ts`: (a) degrade + DLQ — invocation returns success (ack), failed messages republished to DLQ queue; (b) degrade without deadLetterQueueId — invocation returns success, warning logged about data loss with explicit mention of data loss (FR-006, SC-005)

### Implementation for User Story 3

- [x] T015 [US3] Ensure `DlqSender.send()` in `packages/nest-bridge/src/mq/dlq-sender.ts` uses `deadLetterQueueId` from `PartialFailureOptions` and constructs valid `DlqSendRequest` JSON body (`messageBody` base64-encoded, `queueId`); handle HTTP errors gracefully (log warning, do not throw)
- [x] T016 [US3] Ensure `dispatchQueueHandlers` returns normally (ack batch) after degrade path completes with failures — do not re-throw; invocation result must match selected policy exactly (FR-006, SC-005)

**Checkpoint**: All three user stories independently functional — US1 continuation, US2 observability, US3 invocation outcome

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Exports, parity validation, and quickstart verification

- [x] T017 [P] Verify all existing `packages/nest-bridge/src/mq/dispatch.spec.ts` tests still pass (fail-fast parity — SC-003); no regressions from degrade path addition
- [x] T018 [P] Verify existing adapter and handler-dispatch tests pass — HTTP transport behavior unchanged (FR-013)
- [x] T019 Run full quickstart.md validation scenarios against test suite: fail-fast default, degrade + DLQ, degrade without DLQ, observability correlation
- [x] T020 Ensure no new npm dependencies added; verify `fetch` usage is native Node 18+ (no polyfills)

---

## Phase 7: Convergence

**Purpose**: Close gaps found during `/speckit-converge` — end-to-end wiring of the transport-level opt-in, failure-scope correctness, and per-message observability.

- [x] T021 CRITICAL Forward `options` from `createMessageQueueTransport` (packages/nest-bridge/src/mq/adapter.ts:78) to `dispatchQueueHandlers(invocation.container, handlers, batch, options)` so the transport-level `partialFailure` opt-in reaches the degrade path per FR-008 (missing). Add an integration test that drives a batch through the real `messageQueueTransport` adapter with `partialFailure: { enabled: true, deadLetterQueueId }` and asserts all messages are attempted + failed ones republished to DLQ; add a second test that the default `messageQueueTransport` still fails fast.
- [x] T022 HIGH Restrict the degrade-mode try/catch in packages/nest-bridge/src/mq/dispatch.ts:271-279 to the handler-method invocation ONLY — resolve ALL providers via `invocationContainer.resolve` BEFORE entering the per-message catch, so a DI resolution failure propagates as a whole-invocation failure and does not continue the batch per FR-005 and T008 (contradicts). Add a test: in degrade mode, a provider that fails to resolve on message 2 aborts the whole invocation (messages 0…2 attempted at most up to the resolution failure, no outcome recorded, error propagates).
- [x] T023 HIGH Emit per-message failure log records in the degrade path carrying the invocation `trace_id`/`awsRequestId` from `resolveInvocationExecutionContext()` and sanitized `messageId` + error name/message (NO payload/token/header/raw values) per FR-009 and US2/AC2, regardless of whether `deadLetterQueueId` is configured (partial). Single-line record per failed message, correlated with the batch's common `trace_id`. Add/extend integration tests asserting (a) the log contains the invocation `awsRequestId` and the failing `messageId` for the degrade+DLQ path, (b) no payload values appear.

---

## Phase 8: Convergence

**Purpose**: Close gap found on the second `/speckit-converge` — silence on DLQ republish failure, contradicting the documented fail-open observability contract.

- [x] T024 MEDIUM Log a sanitized warning when DLQ republishing fails per T004/T015 ("DLQ send failures are logged as warnings", plan R1) (partial): in `packages/nest-bridge/src/mq/dlq-sender.ts`, emit a `console.warn` line carrying the invocation `trace_id`/`awsRequestId` and the failed message `messageId` (or aggregate failure count for `sendBatch`) — NEVER the message body/payload/token/header/raw values (FR-010); keep returning `false` / the sent-count so the transport outcome stays fail-open (FR-011). In `packages/nest-bridge/src/mq/dispatch.ts`, do not throw on a partial/unsuccessful `sendBatch` result (already fail-open) but ensure the warning is observable. Add/extend tests: (a) `dlq-sender.spec.ts` — a failed `send` logs a warning and still returns `false`; (b) integration test — degrade + DLQ where the send fails (non-ok response) logs a warning correlated with `awsRequestId`/`messageId` and the invocation still resolves successfully (ack).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — types and contracts created first
- **Phase 2 (Foundational)**: Depends on Phase 1 — `DlqSender` and dispatch signature require the types
- **Phase 3 (US1)**: Depends on Phase 2 — dispatch signature change + T007 RED tests written before T008 GREEN implementation
- **Phase 4 (US2)**: Depends on Phase 2 — observability integration reads from dispatch outcomes
- **Phase 5 (US3)**: Depends on Phase 2 — DLQ sender must be implemented
- **Phase 6 (Polish)**: Depends on Phases 3–5 — final validation after all stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 2 — no dependencies on other stories; T007 (tests) must be RED before T008 (implementation) runs GREEN
- **User Story 2 (P2)**: Can start after Phase 2 — uses outcomes from US1 dispatch path but independently testable
- **User Story 3 (P2)**: Can start after Phase 2 — uses DLQ sender from Phase 2, independently testable

### Within Each User Story

- Tests written FIRST (RED), then implementation (GREEN) per Constitution II
- Types/interfaces before class implementations
- DLQ sender tests before integration tests

### Parallel Opportunities

- Phase 1: T001, T002, T003 all touch different files — fully parallelizable
- Phase 3: T007 test written FIRST (RED), then T008+T009 implement (GREEN)
- Phase 4: T010 and T011 test files are independent
- Phase 5: T013 and T014 test files are independent
- Phase 6: T017 and T018 are independent validation tasks

---

## Parallel Example: User Story 1

```bash
# Tests (RED phase — Constitution II):
Task: "T007 Add degrade-mode dispatch tests in packages/nest-bridge/src/mq/dispatch.spec.ts"
# Confirm RED: tests fail because degrade path not yet implemented

# Implementation (GREEN phase):
Task: "T008 Implement degrade path in dispatch.ts (try/catch, outcome collection, DLQ invocation)"
Task: "T009 Add PartialFailureOptions validation guard in dispatch.ts"
# Confirm GREEN: all T007 tests pass
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types and contracts) — T001, T002, T003
2. Complete Phase 2: Foundational (DLQ sender + dispatch signature) — T004, T005, T006
3. Complete Phase 3: User Story 1 — T007 (RED), T008 (GREEN), T009 (GREEN)
4. **STOP and VALIDATE**: Run `pnpm --filter @ycforge/nestjs-connector test` — all tests green
5. Deploy/demo if ready

### Incremental Delivery

1. Phase 1 + Phase 2 → Core infrastructure ready
2. Phase 3 (US1) → Test independently → Deploy/Demo (MVP!)
3. Phase 4 (US2) → Test independently → Deploy/Demo (observability added)
4. Phase 5 (US3) → Test independently → Deploy/Demo (DLQ policy complete)
5. Phase 6 → Final polish, parity validation

### Parallel Team Strategy

With multiple developers:
1. Team completes Phase 1 + Phase 2 together
2. Once Phase 2 is done:
   - Developer A: US1 (continuation tests + verification)
   - Developer B: US2 (observability tests + trace integration)
   - Developer C: US3 (DLQ tests + invocation outcome)
3. Phase 6 after all stories converge

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests are included (spec explicitly requests test-first per Constitution II)
- Per Constitution II: write tests FIRST, confirm RED, then GREEN
- Existing fail-fast tests must remain green throughout (SC-003)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
