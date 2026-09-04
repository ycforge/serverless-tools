import type { QueueBodyDeserializer } from "../mq/message";
import type { ConnectorBootstrapOptions } from "../auth/connector-bootstrap-options";

/**
 * Configuration for per-message partial failure handling in MQ batch dispatch.
 *
 * When `enabled` is `true`, the connector switches from fail-fast to degrade
 * semantics: each handler throw is caught, a {@link MessageOutcome} is
 * recorded for the failing message, and dispatch continues with the remaining
 * messages in the batch. After all messages are attempted the batch is acked
 * (the invocation returns normally) and failed messages are optionally
 * republished to a dead letter queue.
 *
 * Without `enabled` the default fail-fast behaviour (spec 001) is preserved
 * byte-for-byte.
 */
export interface PartialFailureOptions {
  /** Enable degrade mode: ack batch, push failures to DLQ. Default: false (fail-fast). */
  readonly enabled: boolean;
  /** Queue ID for dead letter republishing. Required when enabled = true.
   *  Without it, failed messages are lost (logged as warning). */
  readonly deadLetterQueueId?: string;
}

/**
 * Message Queue transport configuration (issue #9).
 *
 * Kept deliberately minimal: the only extension point is the body
 * deserialization strategy. Retry/acknowledgement policy, selectors and other
 * queue behaviors belong to their own issues and are intentionally absent.
 */
export interface QueueTransportOptions {
  /**
   * Replaces the default strict-JSON policy for EVERY delivery handled by
   * this runtime. The strategy receives the exact raw body plus the
   * normalized message; its return value becomes `QueueMessage.payload` and
   * its failures propagate verbatim into the consuming handler round.
   */
  readonly deserializeBody?: QueueBodyDeserializer;
  /**
   * Per-message partial failure handling (issue #005). When present and
   * `enabled` is `true`, handler failures no longer stop the entire batch;
   * instead, each message is attempted independently and the outcome is
   * collected. Default: absent (fail-fast, unchanged).
   */
  readonly partialFailure?: PartialFailureOptions;
}

/**
 * Options accepted by {@link createYandexHandler}.
 *
 * All sections are optional; omitting `queue` selects the documented default
 * behavior (strict-JSON bodies). HTTP transport behavior is not configurable
 * through this type — the API Gateway v2 contract is fixed by the platform.
 */
export interface CreateYandexHandlerOptions extends ConnectorBootstrapOptions {
  readonly queue?: QueueTransportOptions;
}
