# Contract: QueueTransportOptions (partial failure extension)

**Scope**: Public API type in `@ycforge/nestjs-connector`

## Current Contract (spec 001/004)

```typescript
interface QueueTransportOptions {
  readonly deserializeBody?: QueueBodyDeserializer;
}
```

## Extended Contract (spec 005)

```typescript
interface QueueTransportOptions {
  readonly deserializeBody?: QueueBodyDeserializer;
  readonly partialFailure?: PartialFailureOptions;
}

interface PartialFailureOptions {
  /** Enable degrade mode: ack batch, push failures to DLQ. Default: false (fail-fast). */
  readonly enabled: boolean;
  /** Queue ID for dead letter republishing. Required when enabled = true.
   *  Without it, failed messages are lost (logged as warning). */
  readonly deadLetterQueueId?: string;
}
```

## Usage Examples

### Default (fail-fast, unchanged)

```typescript
const transport = createMessageQueueTransport();
// or
const transport = createMessageQueueTransport({
  deserializeBody: (body) => JSON.parse(body),
});
```

### Degrade + DLQ

```typescript
const transport = createMessageQueueTransport({
  partialFailure: {
    enabled: true,
    deadLetterQueueId: "dead-letter-queue-id",
  },
});
```

### Degrade without DLQ (data loss, logged)

```typescript
const transport = createMessageQueueTransport({
  partialFailure: {
    enabled: true,  // no deadLetterQueueId — warning logged, messages lost
  },
});
```

## Backward Compatibility

- **Non-breaking**: `partialFailure` is optional; omitting it = fail-fast (current behavior)
- **No runtime changes in default path**: the degrade path is only entered when `partialFailure.enabled === true`
- **Type-level only**: adding optional properties to an existing interface is a minor-compatible change

## Exported Types (new)

```typescript
// From @ycforge/nestjs-connector (via index.ts re-export)
export type { MessageOutcome, MessageError, BatchDispatchResult } from "./mq/message-outcome";
export type { PartialFailureOptions } from "./core/handler-options";
```
