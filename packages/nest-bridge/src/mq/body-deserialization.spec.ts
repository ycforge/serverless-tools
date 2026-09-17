import { createHash } from "node:crypto";
import { ConnectorError } from "../core/connector-error";
import type { QueueBodyDeserializer, QueueMessage } from "./message";
import { createPayloadReader, jsonBodyDeserializer } from "./body-deserialization";
import { normalizeQueueBatch } from "./normalize-batch";
import type { RawQueueMessageEvent } from "./raw-event";

/**
 * Specs for queue body deserialization and message-attribute semantics
 * (issue #9).
 *
 * The pinned decisions:
 * - the raw body survives every outcome untouched;
 * - `payload` is lazy (normalization never parses) and memoized per message;
 * - invalid JSON under the default policy fails deterministically with
 *   `QUEUE_BODY_DESERIALIZATION_FAILED`, leaking no body fragments;
 * - custom strategies receive body + message exactly once and their failures
 *   propagate verbatim;
 * - message attributes stay lossless strings — no numeric coercion, unknown
 *   data types preserved.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";
const EVENT_ID = "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8";
const INVALID_JSON_MESSAGE_PATTERN = /not valid JSON under the default deserialization policy/;

function md5Of(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

function makeEnvelope(
  overrides: {
    body?: string;
    messageAttributes?: Record<string, { data_type: string; string_value: string }>;
    md5OfMessageAttributes?: string;
  } = {},
): RawQueueMessageEvent {
  const body = overrides.body ?? '{"orderId":"order-fixture","items":3}';
  return {
    event_metadata: {
      event_id: EVENT_ID,
      event_type: "yandex.cloud.events.messagequeue.QueueMessage",
      created_at: "2026-08-21T21:44:34.266Z",
      tracing_context: null,
      cloud_id: "a1b2c3d4000000000000",
      folder_id: "e5f6a7b8000000000000",
    },
    details: {
      queue_id: QUEUE_ID,
      message: {
        message_id: EVENT_ID,
        md5_of_body: md5Of(body),
        body,
        attributes: {},
        message_attributes: overrides.messageAttributes ?? {},
        md5_of_message_attributes: overrides.md5OfMessageAttributes ?? "",
      },
    },
  } as RawQueueMessageEvent;
}

function firstMessageOf(
  envelope: RawQueueMessageEvent,
  deserializeBody?: QueueBodyDeserializer,
): QueueMessage {
  return normalizeQueueBatch({ messages: [envelope] }, deserializeBody).messages[0]!;
}

/** Captures the error thrown by reading a payload, for identity assertions. */
function readPayloadError(message: QueueMessage): unknown {
  try {
    void message.payload;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("default JSON deserialization policy", () => {
  it("decodes a valid JSON object into its typed value", () => {
    const message = firstMessageOf(makeEnvelope());

    expect(message.payload).toEqual({ orderId: "order-fixture", items: 3 });
    // Raw representations remain intact beside the decoded value.
    expect(message.body).toBe('{"orderId":"order-fixture","items":3}');
    expect(message.raw.details.message.body).toBe('{"orderId":"order-fixture","items":3}');
  });

  it("decodes a valid JSON array preserving element order", () => {
    const message = firstMessageOf(makeEnvelope({ body: '[1,{"two":2},"three"]' }));

    expect(message.payload).toEqual([1, { two: 2 }, "three"]);
    expect((message.payload as unknown[])[1]).toEqual({ two: 2 });
  });

  it.each([
    ["a JSON string", '"plain text"', "plain text"],
    ["a JSON number", "42", 42],
    ["a JSON boolean", "true", true],
    ["JSON null", "null", null],
  ])("decodes %s through normal JSON.parse semantics", (_label, body, expected) => {
    expect(firstMessageOf(makeEnvelope({ body })).payload).toBe(expected);
  });

  it("keeps Unicode and emoji intact in both raw and decoded forms", () => {
    const body = '{"greeting":"Привет 🌍 日本語 العربية"}';
    const message = firstMessageOf(makeEnvelope({ body }));

    expect(message.payload).toEqual({ greeting: "Привет 🌍 日本語 العربية" });
    expect(message.body).toBe(body);
  });

  it("fails invalid JSON deterministically without leaking body content", () => {
    const sensitiveFragment = '{"token":"s3cr3t-fragment';
    const message = firstMessageOf(makeEnvelope({ body: sensitiveFragment }));

    const firstError = readPayloadError(message);

    expect(firstError).toBeInstanceOf(ConnectorError);
    const boundaryError = firstError as ConnectorError;
    expect(boundaryError.code).toBe("QUEUE_BODY_DESERIALIZATION_FAILED");
    expect(boundaryError.transportId).toBe("message-queue");
    // Structural diagnostics only: neither the body nor parse positions leak.
    expect(boundaryError.message).not.toContain("s3cr3t");
    expect(boundaryError.message).not.toContain("position");

    // Repeated access replays the identical failure instead of re-parsing.
    expect(readPayloadError(message)).toBe(firstError);

    // The delivery itself stays healthy: identity and raw body readable.
    expect(message.body).toBe(sensitiveFragment);
    expect(message.messageId).toBe(EVENT_ID);
  });

  it("treats plain text as undecodable JSON while keeping it usable as a string", () => {
    const body = "hello, plain world";
    const message = firstMessageOf(makeEnvelope({ body }));

    expect(readPayloadError(message)).toMatchObject({
      code: "QUEUE_BODY_DESERIALIZATION_FAILED",
    });
    // Non-JSON consumers keep the exact string through the documented field.
    expect(message.body).toBe(body);
  });

  it("fails an empty body deterministically on every access", () => {
    const message = firstMessageOf(makeEnvelope({ body: "" }));

    const firstError = readPayloadError(message);
    expect(firstError).toMatchObject({ code: "QUEUE_BODY_DESERIALIZATION_FAILED" });
    expect(readPayloadError(message)).toBe(firstError);
    expect(message.body).toBe("");
  });

  it("does not parse anything while normalizing — only on first payload access", () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const batch = normalizeQueueBatch({ messages: [makeEnvelope()] });
      expect(parseSpy).not.toHaveBeenCalled();

      void batch.messages[0]!.payload;
      expect(parseSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("memoizes the decoded value so repeated accesses parse exactly once", () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const message = firstMessageOf(makeEnvelope());

      const first = message.payload;
      const second = message.payload;

      expect(parseSpy).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("keeps payloads independent across messages of one batch", () => {
    const batch = normalizeQueueBatch({
      messages: [
        makeEnvelope({ body: '{"n":1}', messageAttributes: {} }),
        makeEnvelope({ body: "not-json-at-all", messageAttributes: {} }),
      ],
    });
    const [first, second] = [batch.messages[0]!, batch.messages[1]!];

    expect(first.payload).toEqual({ n: 1 });
    // An undecodable sibling neither corrupts nor is corrupted; each message
    // carries its own memoized outcome.
    expect(readPayloadError(second)).toBeDefined();
    expect(first.payload).toEqual({ n: 1 });
    expect(second.body).toBe("not-json-at-all");
  });

  it("leaves a UTF-8 BOM prefixed body undecodable but byte-exact", () => {
    const body = "\uFEFF{}";
    const message = firstMessageOf(makeEnvelope({ body }));

    expect(readPayloadError(message)).toMatchObject({
      code: "QUEUE_BODY_DESERIALIZATION_FAILED",
    });
    expect(message.body.charCodeAt(0)).toBe(0xfeff);
  });
});

describe("custom body deserializer", () => {
  it("receives the exact raw body and the normalized message instance", () => {
    const seenBodies: string[] = [];
    const seenMessages: QueueMessage[] = [];

    const message = firstMessageOf(makeEnvelope({ body: "RAW-CONTENT" }), (body, seen) => {
      seenBodies.push(body);
      seenMessages.push(seen);
      return { length: body.length };
    });

    // Nothing runs until the payload is consumed.
    expect(seenBodies).toEqual([]);

    expect(message.payload).toEqual({ length: "RAW-CONTENT".length });
    expect(seenBodies).toEqual(["RAW-CONTENT"]);
    expect(seenMessages[0]).toBe(message);
  });

  it("replaces the JSON policy entirely for every delivered message", () => {
    const batch = normalizeQueueBatch(
      { messages: [makeEnvelope({ body: "one" }), makeEnvelope({ messageAttributes: {} })] },
      (body) => body.toUpperCase(),
    );

    expect(batch.messages.map((message) => message.payload)).toEqual([
      "ONE",
      '{"ORDERID":"ORDER-FIXTURE","ITEMS":3}',
    ]);
  });

  it("exposes returned undefined as a legitimate memoized payload value", () => {
    let invocations = 0;
    const message = firstMessageOf(makeEnvelope(), () => {
      invocations += 1;
      return undefined;
    });

    expect(message.payload).toBeUndefined();
    // Memoization must not confuse `undefined` with "not yet evaluated".
    expect(message.payload).toBeUndefined();
    expect(invocations).toBe(1);
  });

  it("propagates custom strategy failures verbatim, unwrapped and replayed", () => {
    const originalFailure = new Error("custom codec exploded");
    const message = firstMessageOf(makeEnvelope(), () => {
      throw originalFailure;
    });

    expect(readPayloadError(message)).toBe(originalFailure);
    expect(readPayloadError(message)).toBe(originalFailure);
  });
});

describe("deserialization mechanics", () => {
  it("keeps the default policy a plain strict-JSON decoder", () => {
    expect(jsonBodyDeserializer('{"a":[true,null]}', {} as QueueMessage)).toEqual({
      a: [true, null],
    });
    expect(() => jsonBodyDeserializer("{", firstMessageOf(makeEnvelope()))).toThrow(
      INVALID_JSON_MESSAGE_PATTERN,
    );
  });

  it("memoizes outcomes through the reader factory independent of normalization", () => {
    const fixture = { messageId: "m", body: "{}" } as QueueMessage;
    let calls = 0;
    const read = createPayloadReader(
      () => {
        calls += 1;
        return calls;
      },
      fixture.body,
      () => fixture,
    );

    expect(read()).toBe(1);
    expect(read()).toBe(1);
    expect(calls).toBe(1);
  });
});

describe("message attribute representation", () => {
  it("preserves Number-typed attribute values as their exact original strings", () => {
    const hugeNumber = "123456789012345678901234567890";
    const message = firstMessageOf(
      makeEnvelope({
        messageAttributes: { Attempt: { data_type: "Number", string_value: hugeNumber } },
        md5OfMessageAttributes: "d41d8cd98f00b204e9800998ecf8427e",
      }),
    );
    const attempt = message.messageAttributes["Attempt"]!;

    // No numeric coercion anywhere: precision-sensitive values survive
    // verbatim, conversion remains a deliberate consumer step.
    expect(attempt.dataType).toBe("Number");
    expect(attempt.stringValue).toBe(hugeNumber);
    expect(typeof attempt.stringValue).toBe("string");
    expect(message.md5OfMessageAttributes).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("preserves String-typed attributes verbatim", () => {
    const message = firstMessageOf(
      makeEnvelope({
        messageAttributes: { Scenario: { data_type: "String", string_value: "retry" } },
      }),
    );

    expect(message.messageAttributes["Scenario"]).toEqual({
      dataType: "String",
      stringValue: "retry",
    });
  });

  it("normalizes unknown future attribute data types instead of rejecting them", () => {
    const message = firstMessageOf(
      makeEnvelope({
        messageAttributes: {
          Checksum: { data_type: "Binary", string_value: "aGVsbG8=" },
        },
      }),
    );

    // Same stable shape for every data type; future kinds keep flowing.
    expect(message.messageAttributes["Checksum"]).toEqual({
      dataType: "Binary",
      stringValue: "aGVsbG8=",
    });
  });

  it("maps empty message_attributes to an empty record and keeps md5 passthrough", () => {
    const message = firstMessageOf(makeEnvelope({ md5OfMessageAttributes: "" }));

    expect(Object.keys(message.messageAttributes)).toHaveLength(0);
    expect(message.md5OfMessageAttributes).toBe("");
    expect(message.raw.details.message.md5_of_message_attributes).toBe("");
  });

  it("never decodes attribute values into numbers implicitly", () => {
    const message = firstMessageOf(
      makeEnvelope({
        messageAttributes: {
          SentTimestamp: { data_type: "Number", string_value: "1787328274187" },
        },
      }),
    );

    expect(Object.values(message.messageAttributes)).toEqual([
      { dataType: "Number", stringValue: "1787328274187" },
    ]);
  });
});
