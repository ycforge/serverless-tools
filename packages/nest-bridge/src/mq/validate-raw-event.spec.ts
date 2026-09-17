import { createHash } from "node:crypto";
import { ConnectorError } from "../core/connector-error";
import { validateQueueEvent } from "./validate-raw-event";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * Specs for the deep structural validation behind the Message Queue transport
 * claim (issue #7). Fixtures mirror the captured trigger shape with sanitized
 * placeholder values (DATA-ANALYSE.md section C): no real cloud/folder ids,
 * sender ids or producer payload data.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";
const EVENT_ID = "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8";

/** Mirrors the observed invariant: recomputed over the UTF-8 body bytes. */
function md5OfBody(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

function makeMessageEnvelope(
  overrides: {
    metadata?: Record<string, unknown>;
    details?: Record<string, unknown>;
    message?: Record<string, unknown>;
    envelope?: Record<string, unknown>;
  } = {},
): RawQueueMessageEvent {
  const body = '{"orderId":"order-fixture","items":3}';
  const metadata = {
    event_id: EVENT_ID,
    event_type: "yandex.cloud.events.messagequeue.QueueMessage",
    created_at: "2026-08-21T21:44:34.266Z",
    tracing_context: null,
    cloud_id: "a1b2c3d4000000000000",
    folder_id: "e5f6a7b8000000000000",
    ...overrides.metadata,
  };
  const message = {
    message_id: EVENT_ID,
    md5_of_body: md5OfBody(body),
    body,
    attributes: {
      ApproximateFirstReceiveTimestamp: "1787328274291",
      ApproximateReceiveCount: "1",
      SenderId: "AFIXTURESENDERID00001",
      SentTimestamp: "1787328274187",
    },
    message_attributes: {},
    md5_of_message_attributes: "",
    ...overrides.message,
  };
  return {
    event_metadata: metadata,
    details: { queue_id: QUEUE_ID, message, ...overrides.details },
    ...overrides.envelope,
  } as RawQueueMessageEvent;
}

function makeQueueEvent(messages?: RawQueueMessageEvent[]): RawQueueEvent {
  return { messages: messages ?? [makeMessageEnvelope()] };
}

function capturedRejection(validate: () => unknown): ConnectorError {
  try {
    validate();
  } catch (error) {
    if (!(error instanceof ConnectorError)) {
      throw new Error(`expected ConnectorError, received ${String(error)}`, { cause: error });
    }
    return error;
  }
  throw new Error("expected validation to reject");
}

describe("message queue raw event validation", () => {
  it("accepts an observed-shape one-message delivery and returns the untouched reference", () => {
    const event = makeQueueEvent();

    expect(validateQueueEvent(event)).toBe(event);
  });

  it("accepts a batch of several messages without assuming the grouped limit", () => {
    const secondId = "8b2f-d02a3f5c7b94416ac2e10d8f-63e5f9";
    const second = makeMessageEnvelope();
    second.event_metadata.event_id = secondId;
    second.details.message.message_id = secondId;
    const event = makeQueueEvent([makeMessageEnvelope(), second]);

    expect(validateQueueEvent(event)).toBe(event);
  });

  it("tolerates additive unknown fields at every observed level", () => {
    const event = makeQueueEvent();
    event.messages[0]!.event_metadata["futureMetadataField"] = "value";
    event.messages[0]!.details["futureDetailsField"] = 17;
    event.messages[0]!.details.message["futureMessageField"] = [1];
    (event.messages[0]!.details.message.message_attributes as Record<string, unknown>)["Scenario"] =
      {
        data_type: "String",
        string_value: "retry",
        futureAttributeField: true,
      };
    const topLevel = event as Record<string, unknown>;
    topLevel["futureTopLevelField"] = { any: true };

    expect(validateQueueEvent(event)).toBe(event);
  });

  it("accepts tracing_context with any value while requiring its presence", () => {
    // Observed as null in 51/51 captures; a populated shape was never seen,
    // so nothing but string-typed fields may be assumed about it.
    const populated = makeMessageEnvelope({
      metadata: { tracing_context: { traceId: "fixture-trace" } },
    });

    expect(validateQueueEvent(makeQueueEvent([populated]))).toBeDefined();
  });

  it.each([
    [
      "messages is not an array",
      (): RawQueueEvent => ({ messages: "one" }) as unknown as RawQueueEvent,
      'expected field "messages" to be a non-empty array',
    ],
    [
      "messages is empty",
      (): RawQueueEvent => ({ messages: [] }),
      'expected field "messages" to be a non-empty array',
    ],
    [
      "message element is not an object",
      (): RawQueueEvent => makeQueueEvent(["broken" as unknown as RawQueueMessageEvent]),
      'expected field "messages[0]" to be an object',
    ],
    [
      "second message element is not an object",
      (): RawQueueEvent =>
        makeQueueEvent([makeMessageEnvelope(), 42 as unknown as RawQueueMessageEvent]),
      'expected field "messages[1]" to be an object',
    ],
    [
      "event_metadata is missing",
      (): RawQueueEvent =>
        makeQueueEvent([makeMessageEnvelope({ envelope: { event_metadata: undefined } })]),
      'expected field "messages[0].event_metadata" to be an object',
    ],
    [
      "event_metadata.event_id is not a string",
      (): RawQueueEvent => makeQueueEvent([makeMessageEnvelope({ metadata: { event_id: 42 } })]),
      'expected field "messages[0].event_metadata.event_id" to be a string',
    ],
    [
      "event_metadata.created_at is missing",
      (): RawQueueEvent =>
        makeQueueEvent([makeMessageEnvelope({ metadata: { created_at: undefined } })]),
      'expected field "messages[0].event_metadata.created_at" to be a string',
    ],
    [
      "event_metadata.tracing_context key is absent",
      (): RawQueueEvent => {
        const envelope = makeMessageEnvelope();
        delete (envelope.event_metadata as Record<string, unknown>)["tracing_context"];
        return makeQueueEvent([envelope]);
      },
      'expected field "messages[0].event_metadata.tracing_context" to be present',
    ],
    [
      "event_metadata.cloud_id is not a string",
      (): RawQueueEvent => makeQueueEvent([makeMessageEnvelope({ metadata: { cloud_id: null } })]),
      'expected field "messages[0].event_metadata.cloud_id" to be a string',
    ],
    [
      "details.queue_id is missing",
      (): RawQueueEvent =>
        makeQueueEvent([makeMessageEnvelope({ details: { queue_id: undefined } })]),
      'expected field "messages[0].details.queue_id" to be a string',
    ],
    [
      "details.message is not an object",
      (): RawQueueEvent => makeQueueEvent([makeMessageEnvelope({ details: { message: "body" } })]),
      'expected field "messages[0].details.message" to be an object',
    ],
    [
      "details.message.body is not a string",
      (): RawQueueEvent => makeQueueEvent([makeMessageEnvelope({ message: { body: null } })]),
      'expected field "messages[0].details.message.body" to be a string',
    ],
    [
      "system attribute value is not a string",
      (): RawQueueEvent =>
        makeQueueEvent([
          makeMessageEnvelope({
            message: { attributes: { SentTimestamp: 1787328274187 } },
          }),
        ]),
      'expected every value of field "messages[0].details.message.attributes" to be a string',
    ],
    [
      "message_attributes entry misses data_type",
      (): RawQueueEvent =>
        makeQueueEvent([
          makeMessageEnvelope({
            message: { message_attributes: { Scenario: { string_value: "retry" } } },
          }),
        ]),
      'expected field "messages[0].details.message.message_attributes["Scenario"].data_type" to be a string',
    ],
    [
      "message_attributes string_value is not a string",
      (): RawQueueEvent =>
        makeQueueEvent([
          makeMessageEnvelope({
            message: {
              message_attributes: { Attempt: { data_type: "Number", string_value: 1 } },
            },
          }),
        ]),
      'expected field "messages[0].details.message.message_attributes["Attempt"].string_value" to be a string',
    ],
    [
      "md5_of_message_attributes is missing",
      (): RawQueueEvent =>
        makeQueueEvent([
          makeMessageEnvelope({ message: { md5_of_message_attributes: undefined } }),
        ]),
      'expected field "messages[0].details.message.md5_of_message_attributes" to be a string',
    ],
  ])("rejects %s as INVALID_INVOCATION_EVENT", (_label, makeBrokenEvent, reason) => {
    const error = capturedRejection(() => validateQueueEvent(makeBrokenEvent()));

    expect(error.code).toBe("INVALID_INVOCATION_EVENT");
    expect(error.transportId).toBe("message-queue");
    expect(error.message).toContain(reason);
  });
});

describe("message queue validation diagnostics", () => {
  it("keeps producer payload values out of failure diagnostics", () => {
    const event = makeQueueEvent([
      makeMessageEnvelope({
        message: {
          body: "TOP-SECRET-BODY",
          message_attributes: {
            Scenario: { data_type: "String", string_value: "TOP-SECRET-ATTRIBUTE" },
            Broken: { data_type: 42 },
          },
        },
      }),
    ]);

    const error = capturedRejection(() => validateQueueEvent(event));

    expect(error.message).toContain("message_attributes");
    // The failure names only the field path and expected type; producer
    // values — including the valid attribute sitting next to the violation —
    // never surface (AGENTS.md section 6.2).
    expect(error.message).not.toContain("TOP-SECRET-BODY");
    expect(error.message).not.toContain("TOP-SECRET-ATTRIBUTE");
    expect(JSON.stringify(event)).toContain("TOP-SECRET-ATTRIBUTE");
  });

  it("reports batch violations with the offending message index only", () => {
    const event = makeQueueEvent([makeMessageEnvelope(), makeMessageEnvelope()]);
    const metadata = event.messages[1]!.event_metadata as Record<string, unknown>;
    metadata["folder_id"] = undefined;

    const error = capturedRejection(() => validateQueueEvent(event));

    expect(error.message).toContain('field "messages[1].event_metadata.folder_id"');
    expect(error.message).not.toContain("messages[0]");
  });
});
