import { ConnectorError } from "../core/connector-error";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * Deep structural validation of a Message Queue trigger event after the MQ
 * transport claimed it (docs/ARCHITECTURE.md sections 4 and 6.3).
 *
 * `supports()` only answers the cheap discriminator question; this pass owns
 * the full observed-shape contract (AGENTS.md section 4.6, DATA-ANALYSE.md
 * section C). Every field the trigger delivered in 51/51 captured invocations
 * must be present with its observed type: a violation means the payload was
 * misidentified or Yandex changed its contract, and failing loudly beats
 * flowing half-typed data into application code (AGENTS.md section 2.3).
 * `tracing_context` is required to be present but deliberately accepted with
 * any value: it was observed as `null` in every capture while its populated
 * shape was never characterized, so rejecting non-null values would invent a
 * contract nobody captured (AGENTS.md section 29).
 *
 * The event is treated as an immutable record of what Yandex sent — validation
 * only reads, never normalizes or repairs (AGENTS.md section 7.3).
 *
 * Diagnostics are strictly value-free: they name fields (with their batch
 * index) and expected types, never bodies, attribute values or metadata —
 * queue payloads may carry arbitrary producer data (AGENTS.md section 6.2).
 */
export function validateQueueEvent(rawEvent: unknown): RawQueueEvent {
  const event = requireEventObject(rawEvent);
  requireMessageArray(event.messages);
  event.messages.forEach((envelope, index) => validateMessageEnvelope(envelope, index));
  return event;
}

function requireEventObject(rawEvent: unknown): RawQueueEvent {
  if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
    throw invalid("expected a structured event object");
  }
  return rawEvent as RawQueueEvent;
}

/**
 * Observed deliveries always contain at least one message (51/51 captures,
 * grouped-message limit = 1); the array contract stays batch-capable without
 * hard-coding that limit anywhere (AGENTS.md section 4.6).
 */
function requireMessageArray(messages: unknown): asserts messages is RawQueueMessageEvent[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalid('expected field "messages" to be a non-empty array');
  }
}

function validateMessageEnvelope(envelope: unknown, index: number): void {
  const source = requireObject(envelope, `messages[${index}]`);
  const path = `messages[${index}]`;

  const metadata = requireObject(source["event_metadata"], `${path}.event_metadata`);
  requireString(metadata, "event_id", `${path}.event_metadata`);
  requireString(metadata, "event_type", `${path}.event_metadata`);
  // Kept as the observed ISO-8601 string; no Date coercion happens anywhere
  // in the connector (docs/ARCHITECTURE.md section 5).
  requireString(metadata, "created_at", `${path}.event_metadata`);
  // Present-with-null in every capture; any value is tolerated because the
  // populated shape is unknown (see module docs).
  if (!("tracing_context" in metadata)) {
    throw invalid(`expected field "${path}.event_metadata.tracing_context" to be present`);
  }
  requireString(metadata, "cloud_id", `${path}.event_metadata`);
  requireString(metadata, "folder_id", `${path}.event_metadata`);

  const details = requireObject(source["details"], `${path}.details`);
  requireString(details, "queue_id", `${path}.details`);

  const message = requireObject(details["message"], `${path}.details.message`);
  requireString(message, "message_id", `${path}.details.message`);
  requireString(message, "md5_of_body", `${path}.details.message`);
  // The body stays opaque at the transport boundary; deserialization lands
  // with issue #9 (docs/ARCHITECTURE.md section 10).
  requireString(message, "body", `${path}.details.message`);
  requireStringRecord(message["attributes"], `${path}.details.message.attributes`);

  const messageAttributes = message["message_attributes"];
  if (
    typeof messageAttributes !== "object" ||
    messageAttributes === null ||
    Array.isArray(messageAttributes)
  ) {
    throw invalid(`expected field "${path}.details.message.message_attributes" to be an object`);
  }
  for (const [name, value] of Object.entries(messageAttributes)) {
    requireMessageAttributeValue(value, `${path}.details.message.message_attributes`, name);
  }

  requireString(message, "md5_of_message_attributes", `${path}.details.message`);
}

/**
 * One user attribute entry. Only the two fields observed in every capture are
 * required; additive per-entry fields (e.g. future `binary_value`) stay
 * reachable through the raw escape hatch instead of being rejected
 * (AGENTS.md section 36).
 */
function requireMessageAttributeValue(value: unknown, prefix: string, name: string): void {
  const source = requireObject(value, `${prefix}[${JSON.stringify(name)}]`);
  requireString(source, "data_type", `${prefix}[${JSON.stringify(name)}]`);
  requireString(source, "string_value", `${prefix}[${JSON.stringify(name)}]`);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`expected field "${path}" to be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, field: string, prefix: string): void {
  if (typeof source[field] !== "string") {
    throw invalid(`expected field "${prefix}.${field}" to be a string`);
  }
}

function requireStringRecord(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`expected field "${path}" to be an object`);
  }
  for (const entry of Object.values(value)) {
    if (typeof entry !== "string") {
      // System attributes are observed as strings verbatim — including
      // numeric-looking epoch timestamps ("Numbers-as-strings trap",
      // DATA-ANALYSE.md section B); anything else breaks that representation.
      throw invalid(`expected every value of field "${path}" to be a string`);
    }
  }
}

/** Value-free boundary failure carrying the claiming transport id. */
function invalid(reason: string): ConnectorError {
  return ConnectorError.invalidInvocationEvent("message-queue", reason);
}
