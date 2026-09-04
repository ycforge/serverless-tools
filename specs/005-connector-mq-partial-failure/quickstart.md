# Quickstart: per-message failure handling

## Prerequisites

- Node.js 18+ (Yandex Cloud Functions runtime)
- @ycforge/nestjs-connector installed
- A Yandex Message Queue queue with messages

## Validation Scenario 1: Fail-fast (default, unchanged)

1. Create a handler that throws on a specific message:
   ```typescript
   @QueueHandler()
   handleOrder(@QueueMessage() msg: QueueMessage) {
     if (msg.body.includes("bad")) throw new Error("invalid");
   }
   ```

2. Send a batch with a "bad" message followed by good messages

3. **Expected**: invocation fails immediately on "bad" message; good messages NOT processed; platform retries entire batch

4. **Command**: `pnpm --filter @ycforge/nestjs-connector test -- --grep "fail-fast"`

## Validation Scenario 2: Degrade + DLQ

1. Configure transport with partial failure:
   ```typescript
   const transport = createMessageQueueTransport({
     partialFailure: {
       enabled: true,
       deadLetterQueueId: "your-dlq-queue-id",
     },
   });
   ```

2. Use the same handler and batch as Scenario 1

3. **Expected**: all messages attempted; "bad" message outcome = `{ success: false, error: { name: "Error", message: "invalid" } }`; invocation returns success (ack); "bad" message republished to DLQ queue

4. **Command**: `pnpm --filter @ycforge/nestjs-connector test -- --grep "degrade"`

## Validation Scenario 3: Degrade without DLQ

1. Configure without deadLetterQueueId:
   ```typescript
   const transport = createMessageQueueTransport({
     partialFailure: { enabled: true },
   });
   ```

2. Send batch with a failing message

3. **Expected**: all messages attempted; invocation returns success; warning logged about data loss; failed message NOT republished

4. **Command**: `pnpm --filter @ycforge/nestjs-connector test -- --grep "degrade without DLQ"`

## Validation Scenario 4: Observability correlation

1. Enable degrade + DLQ with a failing message

2. **Expected**: log entries include `trace_id` = `awsRequestId` for the failing message; per-message outcome is accessible; no payload/token/header values in logs

3. **Command**: `pnpm --filter @ycforge/nestjs-connector test -- --grep "observability"`

## Full Test Suite

```bash
pnpm --filter @ycforge/nestjs-connector test
```

All existing tests must remain green (fail-fast parity). New tests cover:
- Degrade path: all messages attempted, outcomes collected
- DLQ republishing: failed messages sent to specified queue
- DLQ without queue ID: warning logged, no crash
- Observability: trace_id in failure records
- Type exports: new types available from package
