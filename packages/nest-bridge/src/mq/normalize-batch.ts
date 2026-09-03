import { createPayloadReader } from "./body-deserialization";
import type {
  QueueBatch,
  QueueBodyDeserializer,
  QueueEventMetadata,
  QueueMessage,
  QueueMessageAttribute,
} from "./message";
import type {
  RawQueueEvent,
  RawQueueMessageAttributeValue,
  RawQueueMessageEvent,
} from "./raw-event";

/**
 * Transforms one validated raw Message Queue trigger event into the normalized
 * {@link QueueBatch} (issues #7 and #9).
 *
 * The rules encoded here are deliberate preservation decisions, not cleanup:
 *
 * - The delivery stays a batch: every element of `messages[]` becomes its own
 *   envelope and nothing assumes the current trigger's grouped-message limit
 *   of 1 (**observed**, AGENTS.md section 4.6).
 * - Values are kept in their observed forms: `createdAt` remains the ISO-8601
 *   string, `tracingContext` passes through verbatim (`null` in every capture),
 *   system attributes keep their string values — numeric-looking epochs stay
 *   strings ("Numbers-as-strings trap", DATA-ANALYSE.md sections B–C).
 * - `body` is copied by reference as the opaque transport-boundary payload;
 *   the raw string is never rewritten, split or re-encoded (AGENTS.md
 *   section 32).
 * - Deserialization is NOT performed here: normalization stays free of body
 *   interpretation so an undecodable body can never corrupt delivery
 *   handling. Each message instead carries a lazy, memoized `payload` getter
 *   bound to the configured {@link QueueBodyDeserializer} (or the default
 *   strict-JSON policy); see src/mq/body-deserialization.ts.
 * - Checksums (`md5OfBody`, `md5OfMessageAttributes`) pass through verbatim;
 *   the connector never recomputes or verifies them.
 *
 * Normalization is transformation, not mutation: attribute maps are shared by
 * reference with the untouched event reachable through `raw`, so additive
 * Yandex fields survive without copying costs (AGENTS.md sections 7.3 and 36).
 */
export function normalizeQueueBatch(
  event: RawQueueEvent,
  deserializeBody?: QueueBodyDeserializer,
): QueueBatch {
  return Object.freeze({
    raw: event,
    messages: Object.freeze(
      event.messages.map((envelope) => normalizeQueueMessage(envelope, deserializeBody)),
    ),
  });
}

function normalizeQueueMessage(
  envelope: RawQueueMessageEvent,
  deserializeBody?: QueueBodyDeserializer,
): QueueMessage {
  const details = envelope.details;
  const message = details.message;
  const metadata = envelope.event_metadata;

  // Memoized per message instance: fan-out handlers of one round observe one
  // consistent payload; failures are computed once and replayed identically.
  // `self` resolves only once a getter actually runs — by then the frozen
  // message below exists, so custom deserializers see the real instance.
  // The reference and its reader are deliberately mutually recursive: the
  // frozen object closes over `readPayload`, whose custom strategies receive
  // `self` itself, so `self` cannot be initialized at declaration time.
  // eslint-disable-next-line prefer-const
  let self: QueueMessage;
  const readPayload = createPayloadReader(deserializeBody, message.body, () => self);

  self = Object.freeze({
    raw: envelope,

    // Observed identity fields pass through verbatim; event_id and message_id
    // were identical in 51/51 captures yet stay independent normalized fields
    // because they describe different objects (the delivery vs the message).
    messageId: message.message_id,
    md5OfBody: message.md5_of_body,
    body: message.body,
    attributes: message.attributes,
    messageAttributes: normalizeMessageAttributes(message.message_attributes),
    md5OfMessageAttributes: message.md5_of_message_attributes,

    queueId: details.queue_id,
    eventMetadata: Object.freeze({
      eventId: metadata.event_id,
      eventType: metadata.event_type,
      createdAt: metadata.created_at,
      tracingContext: metadata.tracing_context,
      cloudId: metadata.cloud_id,
      folderId: metadata.folder_id,
    }) satisfies QueueEventMetadata,

    // Lazy application-level payload (issue #9): evaluated on first access
    // under the configured strategy, never during normalization.
    get payload(): unknown {
      return readPayload();
    },
  });

  return self;
}

/**
 * Maps the observed `data_type`/`string_value` entries to camelCase. Only
 * these two fields were captured; anything else on an entry keeps living on
 * the raw message instead of being copied or dropped.
 */
function normalizeMessageAttributes(
  source: Record<string, RawQueueMessageAttributeValue>,
): Readonly<Record<string, QueueMessageAttribute>> {
  const normalized: Record<string, QueueMessageAttribute> = {};
  for (const [name, value] of Object.entries(source)) {
    normalized[name] = { dataType: value.data_type, stringValue: value.string_value };
  }
  return Object.freeze(normalized);
}
