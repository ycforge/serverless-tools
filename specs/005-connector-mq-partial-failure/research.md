# Research: optional per-message error semantics for MQ batch

**Date**: 2026-09-04

## R1: DLQ republishing mechanism

**Decision**: Use Yandex MQ HTTP API via native `fetch` (Node 18+)

**Rationale**: Yandex MQ does not natively support dead letter queues with automatic republishing. The connector must send failed messages to a DLQ queue via the HTTP API:
- Endpoint: `POST https://message-queue.api.cloud.yandex.net/queues/{queue_id}/messages`
- Auth: IAM token from metadata service (`http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token`)
- Payload: JSON with `messageBody`, `queueId`, optional `delaySeconds`

**Alternatives considered**:
- `@yandex-cloud/nodejs-sdk`: adds a dependency; overkill for one HTTP call
- User-provided sender function: most flexible but changes the API contract (spec says connector does the republishing)
- `amqplib`: AMQP protocol; Yandex MQ uses HTTP API, not AMQP

**Trade-off**: The DLQ sender introduces outbound HTTP calls from the connector. This is acceptable because:
1. DLQ sending only happens in degrade mode (opt-in)
2. `fetch` is built into Node 18+ (no new dependency)
3. IAM token is available from the standard metadata service
4. DLQ send failures are logged as warnings but don't fail the invocation (fail-open for observability)

## R2: Dispatch loop modification strategy

**Decision**: Wrap per-message delivery in try/catch inside the existing sequential loop

**Rationale**: The current `dispatchQueueHandlers` iterates messages sequentially. For degrade mode:
1. Add a `try/catch` around each message's `extendInvocationScope` call
2. On catch: record `MessageOutcome` with failure info, continue to next message
3. After loop: if any failures, republish failed messages to DLQ
4. Return normally (ack batch)

**Alternatives considered**:
- Parallel message processing: breaks sequential delivery order guarantee (spec FR-003)
- Separate dispatch function for degrade mode: code duplication, harder to maintain

**Trade-off**: The try/catch adds a conditional branch in the hot path. In fail-fast mode (default), the catch block is dead code and JIT will optimize it away. No measurable overhead.

## R3: MessageOutcome type design

**Decision**: Minimal outcome type with `messageId`, `success` flag, and optional `error` (class + message, no payload)

**Rationale**: Per spec FR-010, the outcome must NOT contain payload/token/header values. The type carries:
- `messageId: string` — identifies the message
- `success: boolean` — outcome flag
- `error?: { name: string; message: string }` — error class and message only (no stack trace, no payload)

**Alternatives considered**:
- Full error object: violates FR-010 (could leak payload in error messages)
- Enum-based error codes: premature abstraction; error class name is sufficient for programmatic handling

## R4: IAM token retrieval for DLQ sender

**Decision**: Lazy-fetch IAM token from metadata service with caching (TTL ~1 hour)

**Rationale**: The metadata service endpoint returns a JSON with `access_token` and `expires_in` (typically 3600s). The DLQ sender should:
1. Fetch token on first DLQ send
2. Cache until ~5 minutes before expiry
3. Re-fetch on next DLQ send

**Alternatives considered**:
- Fetch token on every invocation: adds latency to every invocation, even when no DLQ sends happen
- No caching: token valid for ~1 hour; re-fetching every time is wasteful
- SDK-level token management: adds dependency

## R5: Integration with spec 004 observability

**Decision**: Per-message failure records include `trace_id` from invocation context

**Rationale**: The `trace_id` (= `awsRequestId`) is already available in the invocation scope (spec 004 FR-001). When recording a `MessageOutcome` failure, the DLQ sender includes the `trace_id` in the log entry. This provides correlation between the original failure and any DLQ processing.

**Implementation**: The DLQ sender reads `trace_id` from the invocation scope via `resolveInvocationExecutionContext()` (already used in dispatch.ts).
