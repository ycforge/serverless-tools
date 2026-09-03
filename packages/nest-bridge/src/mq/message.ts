import type { HasRaw } from "../core/raw-access";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * Normalized Message Queue models. Application code consumes these; the raw
 * trigger payload remains reachable through {@link HasRaw}.
 */

/**
 * Metadata shared by all messages of one trigger delivery. Values are kept in
 * their observed forms — `createdAt` stays an ISO string and is not coerced to
 * a `Date`, `tracingContext` stays opaque.
 */
export interface QueueEventMetadata {
  readonly eventId: string;
  readonly eventType: string;
  readonly createdAt: string;
  readonly tracingContext: unknown;
  readonly cloudId: string;
  readonly folderId: string;
}

/**
 * Single message attribute with its declared data type, normalized to
 * camelCase from the observed `data_type`/`string_value` wire fields.
 */
export interface QueueMessageAttribute {
  readonly dataType: string;
  readonly stringValue: string;
}

/**
 * Decoding strategy for queue message bodies (issue #9).
 *
 * Receives the exact raw body string plus the normalized message (so custom
 * strategies can branch on attributes or metadata) and returns the value that
 * {@link QueueMessage.payload} exposes. Throwing from a strategy fails the
 * consuming handler round with the original error — failures propagate
 * verbatim, never wrapped, mirroring handler failure semantics.
 */
export type QueueBodyDeserializer = (body: string, message: QueueMessage) => unknown;

/**
 * One queue message.
 *
 * Three representation levels live side by side, deliberately kept distinct:
 *
 * 1. **Raw transport representation** — `body` plus everything under `raw`
 *    (`HasRaw`), untouched and byte-for-byte/text-for-text identical to what
 *    Yandex delivered. Always present, never mutated.
 * 2. **Normalized message representation** — identity, checksums, system/user
 *    attributes and delivery metadata in their observed forms (strings stay
 *    strings; nothing numeric-looking is coerced).
 * 3. **Deserialized application payload** — `payload`, produced on first
 *    access by the configured {@link QueueBodyDeserializer} (default: strict
 *    JSON) and memoized for the lifetime of this message instance.
 *
 * `payload` evaluation is lazy by design: an invalid body must not corrupt
 * normalization of the delivery nor affect handlers that never read it. A
 * decoding failure surfaces inside exactly the handler round that accesses
 * `payload` — the default policy raises {@link ConnectorError} code
 * `QUEUE_BODY_DESERIALIZATION_FAILED`; custom strategies propagate their own
 * errors verbatim. The outcome (value or failure) is computed once per
 * message instance and replayed deterministically on repeated access, so
 * fan-out handlers of one round observe one consistent payload.
 *
 * The generic parameter is a consumer-side assertion, exactly like typing a
 * `JSON.parse` result: the connector does not validate `T` at runtime.
 *
 * Message attributes are NOT decoded: `{ dataType, stringValue }` preserves
 * the original `string_value` exactly (no numeric coercion, no precision
 * loss); converting a Number-typed attribute is a deliberate consumer step.
 * Unknown/future `data_type` values normalize through the same shape instead
 * of being rejected.
 */
export interface QueueMessage<T = unknown> extends HasRaw<RawQueueMessageEvent> {
  readonly messageId: string;
  readonly md5OfBody: string;
  readonly body: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly messageAttributes: Readonly<Record<string, QueueMessageAttribute>>;
  readonly md5OfMessageAttributes: string;
  readonly queueId: string;
  readonly eventMetadata: QueueEventMetadata;
  /** Deserialized application payload; see the interface documentation for evaluation semantics. */
  readonly payload: T;
}

/**
 * A whole trigger delivery. Always modeled as a collection even though the
 * current trigger configuration delivers one message at a time (**observed**)
 * — the domain model must stay batch-capable (AGENTS.md section 4.6).
 */
export interface QueueBatch extends HasRaw<RawQueueEvent> {
  readonly messages: readonly QueueMessage[];
}
