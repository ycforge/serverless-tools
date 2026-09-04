/**
 * Per-message outcome types for partial failure handling (issue #005).
 *
 * These types model the result of processing each message in a batch when
 * degrade mode is enabled. The outcome carries ONLY the `messageId` and an
 * optional sanitized error — no payload, token, header, or raw body values
 * are ever included (FR-010).
 */

/**
 * Sanitized error captured from a per-message handler failure.
 *
 * Contains only the error class name and message string. Stack traces,
 * payload values, tokens, and header data are intentionally excluded to
 * prevent information leakage in logs and observability pipelines.
 */
export interface MessageError {
  /** Error class name (e.g. "Error", "TypeError") — no payload leakage */
  readonly name: string;
  /** Error message — no payload/token/header values */
  readonly message: string;
}

/**
 * Per-message processing result collected during degrade-mode dispatch.
 *
 * One `MessageOutcome` is produced for every message in the batch, preserving
 * the delivery order of `batch.messages`. The `error` field is present ONLY
 * when `success` is `false`.
 */
export interface MessageOutcome {
  /** Unique message identifier from the queue delivery */
  readonly messageId: string;
  /** Whether the message was processed successfully */
  readonly success: boolean;
  /** Error details (only present when success = false) */
  readonly error?: MessageError;
}

/**
 * Aggregated result of per-message processing in degrade mode.
 *
 * Created fresh for each `dispatchQueueHandlers` call — no state leaks
 * between concurrent invocations (FR-012). After the dispatch loop,
 * `failureCount > 0` triggers DLQ republishing.
 */
export interface BatchDispatchResult {
  /** All message outcomes in delivery order */
  readonly outcomes: readonly MessageOutcome[];
  /** Number of failed messages (outcomes.filter(o => !o.success).length) */
  readonly failureCount: number;
}

/**
 * Creates a successful outcome for a message.
 */
export function successOutcome(messageId: string): MessageOutcome {
  return { messageId, success: true };
}

/**
 * Creates a failed outcome for a message, capturing only the error name and
 * message (FR-010 — no payload, tokens, headers, or raw body).
 */
export function failureOutcome(messageId: string, error: unknown): MessageOutcome {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    messageId,
    success: false,
    error: { name: err.name, message: err.message },
  };
}
