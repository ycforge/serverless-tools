import { extendInvocationScope } from "../context/invocation-scope";
import type { QueueTransportOptions } from "../core/handler-options";
import type { TransportAdapter, TransportId, TransportInvocation } from "../core/transport";
import { dispatchQueueHandlers, discoverQueueHandlers } from "./dispatch";
import type { QueueBatch } from "./message";
import { normalizeQueueBatch } from "./normalize-batch";
import type { RawQueueEvent } from "./raw-event";
import { validateQueueEvent } from "./validate-raw-event";

/**
 * Yandex Cloud Functions Message Queue trigger transport (issues #7, #8).
 *
 * Detection discriminator (**observed**, docs/ARCHITECTURE.md section 4):
 * a non-empty `messages` array whose elements carry the observed trigger
 * fingerprint — an object `event_metadata` plus `details.queue_id` and
 * `details.message.message_id`. The check stays cheap, deterministic,
 * side-effect-free and never throws; deeper structural validation happens
 * once inside `invoke` and reports violations as `INVALID_INVOCATION_EVENT`.
 * Deliveries that miss the fingerprint (including an empty `messages` array,
 * which never occurred in 51/51 captures) stay unclaimed and fail with
 * `UNKNOWN_INVOCATION_EVENT` instead of being silently absorbed (AGENTS.md
 * section 8.3).
 *
 * Failure semantics are asynchronous-queue semantics, never HTTP: validation
 * and later handler failures propagate out of the invocation so Message Queue
 * retry/dead-letter configuration stays effective (docs/ARCHITECTURE.md
 * section 6.2). Nothing here acknowledges or swallows errors.
 *
 * The adapter object itself is stateless: everything invocation-specific
 * arrives on the {@link TransportInvocation} and nothing survives the call,
 * so the single module-level instance is safe across warm and concurrent
 * invocations (AGENTS.md sections 10–11).
 */
/**
 * Builds the Message Queue trigger transport with optional body
 * deserialization configuration (issue #9). Configuration stays inside the
 * transport boundary: nothing queue-specific leaks into the shared invocation
 * record or into the HTTP transport (AGENTS.md section 30).
 */
export function createMessageQueueTransport(
  options?: QueueTransportOptions,
): TransportAdapter<RawQueueEvent, QueueBatch> {
  return {
    id: "message-queue" satisfies TransportId,

    supports(rawEvent): rawEvent is RawQueueEvent {
      if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
        return false;
      }
      const candidate = rawEvent as Record<string, unknown>;
      const messages = candidate["messages"];
      if (!Array.isArray(messages) || messages.length === 0) {
        return false;
      }
      return messages.every(isQueueMessageEnvelopeShape);
    },

    async invoke(invocation: TransportInvocation<RawQueueEvent>): Promise<QueueBatch> {
      const rawEvent = validateQueueEvent(invocation.rawEvent);
      // Deserialization is deferred to payload access (see normalize-batch);
      // normalization itself never interprets bodies.
      const batch = normalizeQueueBatch(rawEvent, options?.deserializeBody);

      // Publish the normalized delivery into this invocation's scope before any
      // user code runs: queue code reached through the warm container can then
      // read the typed batch plus the execution context injected by the core
      // (@YandexContext()), isolated per invocation (AGENTS.md section 11).
      // Handler dispatch (issue #8) runs INSIDE this same scope: discovery is a
      // one-time static walk of the warm container, execution resolves handler
      // instances per message under one shared DI sub-tree (so REQUEST/TRANSIENT
      // lifecycles stay per delivery) and publishes each message as an immutable
      // scope extension, and failures propagate verbatim — never converted to
      // HTTP-like results — so Message Queue retry/dead-letter behavior stays
      // effective. The untouched batch remains the deterministic transport
      // result of a successful delivery.
      return extendInvocationScope({ queueBatch: batch }, async () => {
        const handlers = discoverQueueHandlers(invocation.container.getApplication());
        await dispatchQueueHandlers(invocation.container, handlers, batch);
        return batch;
      });
    },
  };
}

/**
 * Default zero-configuration Message Queue transport (strict-JSON bodies).
 * Module-level yet stateless — everything invocation-specific arrives on the
 * {@link TransportInvocation}, so sharing one instance across warm and
 * concurrent invocations stays safe.
 */
export const messageQueueTransport: TransportAdapter<RawQueueEvent, QueueBatch> =
  createMessageQueueTransport();

/** Cheap per-element fingerprint check; full validation lives in invoke(). */
function isQueueMessageEnvelopeShape(element: unknown): boolean {
  if (typeof element !== "object" || element === null) {
    return false;
  }
  const envelope = element as Record<string, unknown>;
  const metadata = envelope["event_metadata"];
  if (typeof metadata !== "object" || metadata === null) {
    return false;
  }
  const details = envelope["details"];
  if (typeof details !== "object" || details === null) {
    return false;
  }
  const detailRecord = details as Record<string, unknown>;
  if (typeof detailRecord["queue_id"] !== "string") {
    return false;
  }
  const message = detailRecord["message"];
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as Record<string, unknown>)["message_id"] === "string"
  );
}
