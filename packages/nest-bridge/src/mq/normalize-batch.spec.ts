import { createHash } from "node:crypto";
import { normalizeQueueBatch } from "./normalize-batch";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * Specs for the raw trigger event -> QueueBatch transformation (issue #7).
 *
 * Fixtures follow the sanitized captured shape (DATA-ANALYSE.md section C).
 * Assertions pin the preservation decisions that must never regress: verbatim
 * strings for timestamps/attributes/checksums, opaque bodies, batch-capable
 * `messages[]` handling, shared-by-reference raw structures and reachable
 * additive fields.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";
const EVENT_ID = "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8";

function md5OfBody(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

function makeMessageEnvelope(
  overrides: {
    metadata?: Record<string, unknown>;
    message?: Record<string, unknown>;
  } = {},
): RawQueueMessageEvent {
  const body = overrides.message?.["body"];
  const payload = typeof body === "string" ? body : '{"orderId":"order-fixture","items":3}';
  return {
    event_metadata: {
      event_id: EVENT_ID,
      event_type: "yandex.cloud.events.messagequeue.QueueMessage",
      created_at: "2026-08-21T21:44:34.266Z",
      tracing_context: null,
      cloud_id: "a1b2c3d4000000000000",
      folder_id: "e5f6a7b8000000000000",
      ...overrides.metadata,
    },
    details: {
      queue_id: QUEUE_ID,
      message: {
        message_id: EVENT_ID,
        md5_of_body: md5OfBody(payload),
        body: payload,
        attributes: {
          ApproximateFirstReceiveTimestamp: "1787328274291",
          ApproximateReceiveCount: "1",
          SenderId: "AFIXTURESENDERID00001",
          SentTimestamp: "1787328274187",
        },
        message_attributes: {},
        md5_of_message_attributes: "",
        ...overrides.message,
      },
    },
  } as RawQueueMessageEvent;
}

describe("queue batch normalization", () => {
  it("normalizes one captured delivery into a single typed message envelope", () => {
    const event = { messages: [makeMessageEnvelope()] };

    const batch = normalizeQueueBatch(event);

    expect(batch.raw).toBe(event);
    expect(batch.messages).toHaveLength(1);

    const envelope = event.messages[0]!;
    const message = batch.messages[0]!;

    // Message identity passes through verbatim — event_id and message_id were
    // identical in every capture yet stay independent normalized fields.
    expect(message.messageId).toBe(EVENT_ID);
    expect(message.md5OfBody).toBe(envelope.details.message.md5_of_body);
    expect(message.body).toBe('{"orderId":"order-fixture","items":3}');
    expect(message.md5OfMessageAttributes).toBe("");

    // Queue and delivery metadata.
    expect(message.queueId).toBe(QUEUE_ID);
    expect(message.eventMetadata.eventId).toBe(EVENT_ID);
    expect(message.eventMetadata.eventType).toBe("yandex.cloud.events.messagequeue.QueueMessage");
    // ISO-8601 stays a string; no Date coercion happens (AGENTS.md section 5).
    expect(message.eventMetadata.createdAt).toBe("2026-08-21T21:44:34.266Z");
    expect(message.eventMetadata.tracingContext).toBeNull();
    expect(message.eventMetadata.cloudId).toBe("a1b2c3d4000000000000");
    expect(message.eventMetadata.folderId).toBe("e5f6a7b8000000000000");
  });

  it("models the delivery as a batch of every delivered message", () => {
    const first = makeMessageEnvelope();
    const second = makeMessageEnvelope({
      metadata: { event_id: "8b2f-d02a3f5c7b94416ac2e10d8f-63e5f9" },
    });
    second.details.message.message_id = second.event_metadata.event_id;
    const event = { messages: [first, second] };

    const batch = normalizeQueueBatch(event);

    // Nothing may hard-code the current grouped-message limit of 1
    // (AGENTS.md section 4.6): order and multiplicity survive intact.
    expect(batch.messages).toHaveLength(2);
    expect(batch.messages.map((message) => message.messageId)).toEqual([
      EVENT_ID,
      "8b2f-d02a3f5c7b94416ac2e10d8f-63e5f9",
    ]);
  });

  it("preserves arbitrary UTF-8 bodies byte-for-byte without decoding attempts", () => {
    const unicodeBody = 'Привет, мир! 🌍 日本語 العربية\t\nescaped "quotes"';
    const event = { messages: [makeMessageEnvelope({ message: { body: unicodeBody } })] };

    const batch = normalizeQueueBatch(event);

    expect(batch.messages[0]!.body).toBe(unicodeBody);
    // The checksum fixture mirrors the observed recomputation over UTF-8
    // bytes; both travel unchanged side by side.
    expect(batch.messages[0]!.md5OfBody).toBe(md5OfBody(unicodeBody));
  });

  it("keeps system attributes as the observed verbatim strings", () => {
    const event = { messages: [makeMessageEnvelope()] };

    const attributes = normalizeQueueBatch(event).messages[0]!.attributes;

    // Numeric-looking epochs stay strings ("Numbers-as-strings trap") and the
    // map is shared by reference with the untouched raw message.
    expect(attributes).toBe(event.messages[0]!.details.message.attributes);
    expect(attributes["ApproximateReceiveCount"]).toBe("1");
    expect(attributes["SentTimestamp"]).toBe("1787328274187");
  });

  it("maps empty user message_attributes to an empty record without invention", () => {
    const event = { messages: [makeMessageEnvelope()] };

    const messageAttributes = normalizeQueueBatch(event).messages[0]!.messageAttributes;

    expect(Object.keys(messageAttributes)).toHaveLength(0);
    expect(event.messages[0]!.details.message.md5_of_message_attributes).toBe("");
  });

  it("normalizes populated user message attributes without lossy coercion", () => {
    const event = {
      messages: [
        makeMessageEnvelope({
          message: {
            message_attributes: {
              Scenario: { data_type: "String", string_value: "retry" },
              Attempt: { data_type: "Number", string_value: "1" },
            },
            md5_of_message_attributes: "5f1d0c9ab8c64e72a3f0d41c96be28a7",
          },
        }),
      ],
    };

    const message = normalizeQueueBatch(event).messages[0]!;

    // Number-typed attributes keep their string values exactly as delivered.
    expect(message.messageAttributes["Scenario"]).toEqual({
      dataType: "String",
      stringValue: "retry",
    });
    expect(message.messageAttributes["Attempt"]).toEqual({
      dataType: "Number",
      stringValue: "1",
    });
    expect(typeof message.messageAttributes["Attempt"]?.stringValue).toBe("string");
    expect(message.md5OfMessageAttributes).toBe("5f1d0c9ab8c64e72a3f0d41c96be28a7");
  });

  it("keeps additive unknown fields reachable through the raw escape hatches", () => {
    const event = { messages: [makeMessageEnvelope()] } as RawQueueEvent;
    event["futureTopLevelField"] = { any: true };
    const envelope = event.messages[0]!;
    envelope.event_metadata["futureMetadataField"] = "value";
    envelope.details["futureDetailsField"] = 17;
    envelope.details.message["futureMessageField"] = [1];
    (envelope.details.message.message_attributes as Record<string, unknown>)["Scenario"] = {
      data_type: "String",
      string_value: "retry",
      futureAttributeField: true,
    };

    const batch = normalizeQueueBatch(event);
    const message = batch.messages[0]!;

    // Unknown data is neither dropped nor merged into the normalized model:
    // it stays reachable through raw at its original level (AGENTS.md §36).
    expect(batch.raw["futureTopLevelField"]).toEqual({ any: true });
    expect((message.raw as RawQueueMessageEvent).event_metadata["futureMetadataField"]).toBe(
      "value",
    );
    expect(message.raw.details["futureDetailsField"]).toBe(17);
    expect(
      message.raw.details.message.message_attributes["Scenario"]?.["futureAttributeField"],
    ).toBe(true);
  });

  it("preserves raw references by identity without mutating anything", () => {
    const event = { messages: [makeMessageEnvelope()] };

    const batch = normalizeQueueBatch(event);
    const message = batch.messages[0]!;

    expect(batch.raw).toBe(event);
    expect(message.raw).toBe(event.messages[0]);
    expect(message.attributes).toBe(event.messages[0]!.details.message.attributes);
    expect(message.eventMetadata.createdAt).toBe(event.messages[0]!.event_metadata.created_at);
  });

  it("transforms frozen raw events, proving normalization never mutates them", () => {
    const event = Object.freeze({
      messages: [
        Object.freeze({
          ...makeMessageEnvelope(),
          details: Object.freeze({
            ...makeMessageEnvelope().details,
            message: Object.freeze(makeMessageEnvelope().details.message),
          }),
          event_metadata: Object.freeze(makeMessageEnvelope().event_metadata),
        } as RawQueueMessageEvent),
      ],
    } as RawQueueEvent);

    // Assignments to frozen objects throw in strict mode; normalization must
    // complete without tripping them (transformation over mutation,
    // AGENTS.md section 7.3).
    expect(() => normalizeQueueBatch(event)).not.toThrow();

    const batch = normalizeQueueBatch(event);
    expect(batch.messages[0]!.messageId).toBe(EVENT_ID);
  });
});
