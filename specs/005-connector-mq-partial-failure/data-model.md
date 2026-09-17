# Data Model: optional per-message error semantics for MQ batch

## Entities

### MessageOutcome

Per-message processing result in degrade mode.

```typescript
interface MessageOutcome {
  /** Unique message identifier from the queue delivery */
  readonly messageId: string;
  /** Whether the message was processed successfully */
  readonly success: boolean;
  /** Error details (only present when success = false) */
  readonly error?: MessageError;
}

interface MessageError {
  /** Error class name (e.g., "Error", "TypeError") — no payload leakage */
  readonly name: string;
  /** Error message — no payload/token/header values */
  readonly message: string;
}
```

**Validation rules**:
- `messageId` MUST match the original `QueueMessage.messageId`
- `error` MUST be absent when `success = true`
- `error.name` and `error.message` MUST NOT contain payload, tokens, headers, or `raw` values (FR-010)

### BatchDispatchResult

Aggregated result of per-message processing in degrade mode.

```typescript
interface BatchDispatchResult {
  /** All message outcomes in delivery order */
  readonly outcomes: readonly MessageOutcome[];
  /** Number of failed messages (outcomes.filter(o => !o.success).length) */
  readonly failureCount: number;
}
```

**State transitions**:
- Created during dispatch loop (one entry per message)
- After loop: `failureCount > 0` triggers DLQ republishing
- Consumed by adapter to determine invocation result (ack or throw)

### PartialFailureOptions

Configuration for per-message failure handling in `QueueTransportOptions`.

```typescript
interface PartialFailureOptions {
  /** Enable degrade mode (ack batch, push failures to DLQ) */
  readonly enabled: boolean;
  /** Queue ID for dead letter republishing (required when enabled = true) */
  readonly deadLetterQueueId?: string;
}
```

**Validation rules**:
- `enabled = true` without `deadLetterQueueId`: allowed (data loss, logged as warning)
- `enabled = false` or absent: fail-fast mode (default, unchanged)
- `deadLetterQueueId` without `enabled = true`: ignored

### DlqSendRequest

Internal type for Yandex MQ HTTP API request to send a message to DLQ.

```typescript
interface DlqSendRequest {
  /** Base64-encoded message body */
  readonly messageBody: string;
  /** Queue ID (deadLetterQueueId from options) */
  readonly queueId: string;
  /** Optional delay before message becomes visible (default: 0) */
  readonly delaySeconds?: number;
}
```

## Relationships

```
QueueTransportOptions
  └── PartialFailureOptions (optional)
        └── deadLetterQueueId: string

dispatchQueueHandlers(invocationContainer, handlers, batch, options?)
  └── creates BatchDispatchResult
        └── contains MessageOutcome[] (one per message)
              └── MessageOutcome.error?: MessageError

DlqSender
  └── receives MessageOutcome[] (failures only)
  └── reads deadLetterQueueId from PartialFailureOptions
  └── calls Yandex MQ HTTP API
```

## File Layout

```
packages/nest-bridge/src/
├── core/handler-options.ts     # MODIFY: add PartialFailureOptions
├── mq/
│   ├── message-outcome.ts      # NEW: MessageOutcome, BatchDispatchResult
│   ├── dlq-sender.ts          # NEW: DlqSender class
│   └── dispatch.ts            # MODIFY: degrade path
```
