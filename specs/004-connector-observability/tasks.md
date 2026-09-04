---

description: "Task list for 004-connector-observability implementation"
---

# Tasks: unified logger в stdout + `trace_id` в контексте и error-ответе (004)

**Input**: Design documents from `/specs/004-connector-observability/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Фича явно требует test-first (Constitution II; SC-001..006). Тесты-задачи включены и должны быть написаны ДО реализации (RED), затем GREEN.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Все работы — в `packages/nest-bridge/` (монорепо; план `specs/004-connector-observability/plan.md`, раздел Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Подготовка каталога `src/logger/`, фиксация контрактов, снапшот baseline тестов (регрессионная страховка spec 001/003).

- [ ] T001 Create `src/logger/` directory with placeholder subpath entry (empty barrel to bootstrap wiring), plus `src/logger/__tests__/` scratch note — file `packages/nest-bridge/src/logger/index.ts`
- [ ] T002 [P] Write design snapshot notes in `specs/004-connector-observability/` — confirm `research.md` R1–R11, `contracts/observability.md`, `contracts/package-exports.md`, `quickstart.md` V1–V5 are present and internally consistent (no locale-drift)
- [ ] T003 [P] Run baseline test suite `pnpm --filter @ycforge/nestjs-connector test` and record green output (guard against spec 001/003 regressions later)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Базовые сущности наблюдаемости, от которых зависят ВСЕ user stories.

### BoundaryLogRecord & serializer

- [x] T004 Create `BoundaryLogRecord` type and level-set in `packages/nest-bridge/src/logger/record.ts` per `contracts/observability.md` §2 (`event`, `trace_id`, `awsRequestId?`, `transport?`, `status?`, `durationMs?`, `code?`, `errorClass?`, `message?`)
- [x] T005 [P] Implement `serializeRecord(record)` → single-line JSON string in `packages/nest-bridge/src/logger/record.ts` (fields in enum/documented order; no `undefined` keys)
- [x] T006 [P] Implement `createLogWriter(sink?)` in `packages/nest-bridge/src/logger/writer.ts` — default sink `process.stdout`, single `sink.write(line + "\n")`, full try/catch fail-open wrapper
- [x] T007 [P] Implement `redactForLogging(value)` in `packages/nest-bridge/src/logger/redact.ts` — redacts `token`/`authorization`/`cookie`/`raw`/`rawEvent` per §6.2 (recursive over user `context`)

### Tolerant trace_id

- [x] T008 [P] Implement `readInvocationTraceId(rawContext)` in `packages/nest-bridge/src/context/build-yandex-execution-context.ts` — reads `awsRequestId` as optional string without throwing (research R4; reuse `readOptionalString`)

### Subpath plumbing

- [x] T009 [P] Add `"logger/index": "src/logger/index.ts"` entry to `packages/nest-bridge/tsup.config.ts`
- [x] T010 Add `"./logger": { types, import, require }` block to `exports` in `packages/nest-bridge/package.json`
- [x] T011 [P] Extend `GUARDED_DIRS` with `"logger"` in `packages/nest-bridge/test/packaging/no-root-barrel-import.spec.ts`

**Checkpoint**: `YandexLogger` провайдер ещё не зарегистрирован; базовые record/writer/redact готовы для RED-тестов.

---

## Phase 3: User Story 1 — `trace_id` в контексте (Priority: P1) 🎯 MVP

**Goal**: `YandexExecutionContext` получает `trace_id = awsRequestId`; `toJSON()` включает его (FR-001..004).

**Independent Test**: unit-тесты `build-yandex-execution-context.spec.ts`: вызов builder'а → `trace_id === awsRequestId`; warm N+1 → разный trace_id (изоляция).

### Tests for User Story 1 (TDD — write first, RED) ⚠️

- [x] T012 [P] [US1] Add `trace_id` assertions in `packages/nest-bridge/src/context/build-yandex-execution-context.spec.ts` — present, equals `awsRequestId`, present in `JSON.stringify`, absent optional-absence remains
- [x] T013 [P] [US1] Add isolation test (N+1 differs) in `packages/nest-bridge/src/context/invocation-scope.spec.ts`

### Implementation for User Story 1

- [x] T014 [US1] Add `readonly trace_id: string;` to `YandexExecutionContext` in `packages/nest-bridge/src/context/yandex-execution-context.ts` (doc: equals `awsRequestId`, not a secret)
- [x] T015 [US1] Populate `trace_id = readRequiredString(source, "awsRequestId")` in builder and include in `toJSON()` — `packages/nest-bridge/src/context/build-yandex-execution-context.ts`

**Checkpoint**: US1 самостоятельно тестируем (SC-003 isolation), MVP-демо: `@YandexContext().trace_id`.

---

## Phase 4: User Story 2 — Boundary-логи в stdout (Priority: P1)

**Goal**: connector пишет start/finish/error в `stdout` (FR-005..011, research R3).

**Independent Test**: conformance-прогон 11 HTTP + 5 MQ фикстур со `vi.spyOn(process.stdout,"write")` → пары start/finish с общим `trace_id`, статусы, duration; ошибки-границы → error с `code`.

### Tests for User Story 2 (TDD — first, RED) ⚠️

- [x] T016 [P] [US2] Unit tests for `serializeRecord`/`createLogWriter`/`redact` in `packages/nest-bridge/src/logger/*.spec.ts` (injectable string-array sink; fail-open; single-write; no-undefined-keys; redaction)
- [x] T017 [P] [US2] Integration test `packages/nest-bridge/src/core/boundary-logging.spec.ts` — HTTP & MQ fixture run with stdout spy: exact start+finish pairs, `trace_id`/`awsRequestId` equality, `transport`, `status` (HTTP code / MQ message count), `durationMs >= 0`
- [x] T018 [P] [US2] Integration test error paths in `packages/nest-bridge/src/core/boundary-logging-error.spec.ts` — `UNKNOWN_INVOCATION_EVENT` error-record with `code`; bootstrap-fail error-record without `trace_id` (edge case 1); no payload/token/stack fragments in any record
- [x] T019 [P] [US2] Parity test in `packages/nest-bridge/src/http/conformance-fixtures.spec.ts` — successful wire envelopes unchanged vs baseline (import parity helper)

### Implementation for User Story 2

- [x] T020 [US2] Implement `createInvocationLogger(writer)` in `packages/nest-bridge/src/logger/invocation-logger.ts` — `start()`, `finish(status...)`, `error({code|errorClass, message})`, `durationMs` via `performance.now()`
- [x] T021 [US2] Wire boundary logging into `createYandexHandler` in `packages/nest-bridge/src/core/create-yandex-handler.ts` — start after scope entry, finish/error around `transport.invoke`, tolerant `trace_id` before context; `status` via `transportId` + `resolveInvocationQueueBatch()` for MQ / returned `statusCode` for HTTP

**Checkpoint**: US2 independently observable; SC-002/SC-004.

---

## Phase 5: User Story 3 — `trace_id` в HTTP error-ответах (Priority: P2)

**Goal**: все HTTP error-ответы несут `trace_id`; merge без перезаписи (FR-016..018, research R5).

**Independent Test**: `http-failure-semantics.spec.ts` — last-resort 500/mapped 400/404 содержат `trace_id`; статус и тело фильтров сохранены; success-конверт не изменён.

### Tests for User Story 3 (TDD — first, RED) ⚠️

- [x] T022 [P] [US3] Add assertions in `packages/nest-bridge/src/http/http-failure-semantics.spec.ts` — last-resort 500 body `{"statusCode":500,"message":"Internal server error","trace_id":...}`; mapped 400 (BadRequest) body has `trace_id`, status/rest unchanged; filter-defined body-`trace_id` never overwritten; 404 has `trace_id`
- [x] T023 [P] [US3] Add success-parity assertion in `packages/nest-bridge/src/http/conformance-fixtures.spec.ts` — successful responses never carry `trace_id`

### Implementation for User Story 3

- [x] T024 [US3] Add `attachTraceId(traceId)` seam to `createResponseFacade` in `packages/nest-bridge/src/http/response-facade.ts` — non-enumerable; after attach, `json`/`send` object merge `{ trace_id }` only if key absent; scalar string/Buffer bodies untouched
- [x] T025 [P] [US3] Call `attachTraceId` on error path in `packages/nest-bridge/src/http/dispatch-pipeline.ts` — in `invokeErrorLayer` (before `errorLayer`), `writeLastResortResponse` (500), `respondWithCannotFind` (404); read trace_id from invocation scope via `resolveInvocationExecutionContext()`; captured at dispatch entry + status-gated injection (research R5, covers filter-consumed errors)
- [x] T026 [US3] Ensure attached `trace_id` propagates through `serializeResponse` in `packages/nest-bridge/src/http/serialize-response.ts` without altering success flow (verify envelope untouched)

**Checkpoint**: US3 wire-contract (SC-005).

---

## Phase 6: User Story 4 — Провайдер `YandexLogger` (Priority: P2)

**Goal**: application-код логгирует через DI-провайдер с автоподстановкой `trace_id` (FR-012..015, research R6/R9).

**Independent Test**: интеграционный тест инъекции в сервис; записи с `trace_id`; вне scope без исключения; ключи-секреты редактируются.

### Tests for User Story 4 (TDD — first, RED) ⚠️

- [x] T027 [P] [US4] Unit tests for `YandexLogger` in `packages/nest-bridge/src/logger/yandex-logger.spec.ts` — levels debug..error, `trace_id`/`awsRequestId` from scope, outside-scope no throw + fields absent, redaction of `token`-like keys in context
- [x] T028 [P] [US4] Integration test `packages/nest-bridge/test/logger/yandex-logger.integration.spec.ts` — inject `YandexLogger` into a test service, handle HTTP/MQ invocation, assert records in stdout carry the invocation's `trace_id`/`awsRequestId`
- [x] T029 [P] [US4] Extend `packages/nest-bridge/test/packaging/subpath-exports.spec.ts` — compile a fixture importing `@ycforge/nestjs-connector/logger` without root import (SC-003 addition)

### Implementation for User Story 4

- [x] T030 [P] [US4] Implement `YandexLogger` class in `packages/nest-bridge/src/logger/yandex-logger.ts` — `debug/info/warn/error`; `@Injectable()`; constructor takes internal writer (sink default stdout); resolve `trace_id`/`awsRequestId` via `resolveInvocationExecutionContext()` inside try/catch (fail-open outside scope)
- [x] T031 [US4] Register `YandexLogger` as provider and mark bootstrap module `@Global()` in `packages/nest-bridge/src/auth/bootstrap-module.ts` — `{ provide: YandexLogger, useClass: YandexLogger }` (research R6)
- [x] T032 [US4] Export `YandexLogger` (+ type `YandexLogLevel`) from `packages/nest-bridge/src/logger/index.ts` and from root `packages/nest-bridge/src/index.ts`

**Checkpoint**: US4 independently testable (SC-006).

> **Dev note (test infra)**: bare class-token Nest DI
> (`constructor(private readonly logger: YandexLogger)`, FR-012/R6) requires
> `design:paramtypes` reflect metadata, which neither esbuild nor Vite 7 emit
> for TS transforms. `packages/nest-bridge/vitest.config.ts` now transforms
> `.ts` through swc (`@swc/core` devDep) with
> `jsc.transform.{legacyDecorator,decoratorMetadata}`. `pnpm-workspace.yaml`
> `allowBuilds['@swc/core'] = false` (native binary ships via optionalDeps).
> The published runtime (tsup/esbuild) needs no metadata — consumers inject the
> token from their own tsc-compiled code.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Согласованность, пайплайн, документация, финальная валидация.

- [x] T033 [P] Verify dual build ESM/CJS for `./logger` — `pnpm --filter @ycforge/nestjs-connector build` (tsup двойной формат; `dist/logger/index.js` + `.cjs` присутствуют)
- [x] T034 [P] Run full `pnpm --filter @ycforge/nestjs-connector typecheck`
- [x] T035 [P] Run full `pnpm --filter @ycforge/nestjs-connector test` (green; US1–US4 + guard `logger` + parity)
- [x] T036 [P] Run `quickstart.md` V1–V5 validation steps (conformance + failure semantics + provider) end-to-end
- [x] T037 [P] Update `packages/nest-bridge/README.md` / `docs/ARCHITECTURE.md` observability sections — new exports map, log format, error-envelope contract, `YandexLogger` usage (per constitution conventions)
- [x] T038 [P] Update `specs/README.md` — 004 status 🚧 → ✅ after converge (per AGENTS.md outer loop)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3+)**: all depend on Foundational
  - US1 (Phase 3) is the MVP slice; US2 requires record/writer/redact (T004–T007)
  - US3 depends on US2's tolerant `trace_id` read (T008) and the record/redact base
  - US4 depends on US2's writer (T006) and US1's scope (T014–T015)
- **Polish (Final)**: depends on US1–US4 completing

### User Story Dependencies

- **US1 (P1)**: independent after Foundational
- **US2 (P1)**: independent after Foundational (uses T004–T008)
- **US3 (P2)**: after US2's T008-tolerant-trace_id (shared read helper); no coupling to US2 logging itself
- **US4 (P2)**: after Foundational (writer) + US1 (scope trace_id field)

### Within Each User Story

- Tests written FIRST and FAIL (RED) before implementation (test-first)
- Implementation then makes them green
- Story complete → next priority

### Parallel Opportunities

- All Setup tasks marked [P]
- Foundational T005..T011 (record serializer, writer, redact, tolerant read, tsup, exports, guard) parallel
- Full per-story test blocks [P] run in parallel
- US1 red+green (T012–T015) is the minimal first deliverable (MVP)
- US2/US3/US4 can be paralleled across devs after Foundational (paths disjoint except `dispatch-pipeline` vs `response-facade` — keep US3 within one dev or sequence its two impl tasks)

---

## Parallel Example: Foundational

```bash
# Launch Foundational writable pieces together:
Task: "Implement serializeRecord(record) in src/logger/record.ts"
Task: "Implement createLogWriter(sink?) in src/logger/writer.ts"
Task: "Implement redactForLogging(value) in src/logger/redact.ts"
Task: "Implement readInvocationTraceId(rawContext) in context/build-yandex-execution-context.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup
2. Phase 2 Foundational (record/writer/redact/tolerant-read + subpath plumbing)
3. Phase 3 US1 (`trace_id` in context) — RED tests then impl
4. **STOP & VALIDATE**: `pnpm --filter @ycforge/nestjs-connector test` green; demo `@YandexContext().trace_id`
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → base
2. US1 `trace_id` in context → MVP
3. US2 boundary-логи stdout → observable connector
4. US3 trace_id в error-ответах → client-support contract
5. US4 YandexLogger — провайдер для application-кода
6. Polish (build/typecheck/test/quickstart/doc/roadmap)

### Parallel Team Strategy

- Team completes Setup + Foundational
- Dev A: US1; Dev B: US2; Dev C: US3 (after T008); Dev D: US4 (after writer)
- Polish after US1–US4 merge

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps to spec user story (traceability, SC-001)
- Test-first RED before implementation
- Commit after each task or logical group (constitution: one spec = one branch `004-connector-observability`)
- Stop at checkpoints to validate each story independently
- Avoid: vague tasks, cross-story same-file conflicts (dispatch-pipeline error-путь и response-facade — в рамках одного dev в US3)