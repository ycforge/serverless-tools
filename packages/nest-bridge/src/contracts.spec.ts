import type {
  HasRaw,
  NormalizedHttpRequest,
  QueueBatch,
  QueueMessage,
  RawHttpApiGatewayV2Event,
  RawQueueEvent,
  TransportAdapter,
  YandexCloudFunctionHandler,
  YandexExecutionContext,
} from "./index";

/**
 * These specs look like no-ops at runtime on purpose: their assertions are
 * compile-time. vitest + tsc refuse to run the suite unless every structural
 * claim below still holds, so any accidental change to a public contract
 * breaks CI here first. Synthetic fixtures follow the observed shapes
 * documented in AGENTS.md sections 4 and 5; all values are placeholders.
 */

describe("raw HTTP event contract", () => {
  it("accepts an observed-shaped API Gateway v2 event including unknown future fields", () => {
    const capturedEvent: RawHttpApiGatewayV2Event = {
      version: "2.0",
      rawPath: "/example",
      rawQueryString: "multi=one&multi=two&single=1",
      headers: { "content-type": "application/json" },
      queryStringParameters: { multi: "one,two", single: "1" },
      requestContext: {
        authorizer: {},
        http: {
          method: "GET",
          path: "/example",
          sourceIp: "203.0.113.10",
          userAgent: "fixture-agent",
        },
        requestId: "req-id-fixture",
        time: "22/Aug/2026:00:00:00 +0000",
        timeEpoch: 1771718400000,
      },
      body: "",
      isBase64Encoded: false,
      pathParameters: {},
      parameters: {},
      multiValueParameters: { multi: ["one", "two"], single: ["1"] },
      operationId: "op-fixture",
      // Additive fields must stay representable, never rejected (AGENTS.md §36).
      someFutureField: { nested: true },
    };

    expect(capturedEvent.version).toBe("2.0");

    // The gateway reports repeated parameters twice, in incompatible shapes
    // (observed): comma-joined strings and multiplicity-preserving lists.
    // Both must stay available verbatim instead of being merged.
    expect(capturedEvent.queryStringParameters["multi"]).toBe("one,two");
    expect(capturedEvent.multiValueParameters["multi"]).toEqual(["one", "two"]);
  });
});
describe("normalized HTTP request contract", () => {
  it("requires canonical path/query fields and binary-safe decoded body", () => {
    const normalizedRequest: NormalizedHttpRequest = {
      raw: {} as RawHttpApiGatewayV2Event,
      httpVersion: "2.0",
      method: "GET",
      path: "/example",
      rawQueryString: "",
      searchParams: new URLSearchParams(),
      queryStringParameters: {},
      multiValueParameters: {},
      pathParameters: {},
      headers: {},
      sourceIp: "203.0.113.10",
      userAgent: "fixture-agent",
      body: null,
      requestId: "req-id-fixture",
    };

    expect(normalizedRequest.httpVersion).toBe("2.0");
  });
  it("types repeated query values as read-only lists preserving multiplicity", () => {
    // Compile-time pin: the normalized model keeps multiplicity as readonly
    // arrays instead of collapsing it into comma-joined strings.
    const multiValueParameters: NormalizedHttpRequest["multiValueParameters"] = {
      multi: ["one", "two"],
    };

    const repeatedValues: readonly string[] = multiValueParameters["multi"] ?? [];

    expect(repeatedValues).toEqual(["one", "two"]);
  });
});

describe("queue contracts", () => {
  it("models a delivery as a message batch regardless of current trigger grouping", () => {
    const delivery: QueueBatch = {
      raw: {} as RawQueueEvent,
      messages: [],
    };

    expect(Array.isArray(delivery.messages)).toBe(true);
  });

  it("types QueueMessage<T> so payload is T while raw body stays a string", () => {
    // Compile-time pin for the issue #9 contract: the deserialized payload is
    // consumer-typed, the transport representation stays opaque, and message
    // attributes keep their lossless string form.
    interface FixturePayload {
      readonly id: string;
    }
    const message: QueueMessage<FixturePayload> = {
      raw: {} as RawQueueEvent["messages"][number],
      messageId: "m-fixture",
      md5OfBody: "md5-fixture",
      body: '{"id":"fixture"}',
      attributes: {},
      messageAttributes: {
        Attempt: { dataType: "Number", stringValue: "1" },
      },
      md5OfMessageAttributes: "",
      queueId: "queue-fixture",
      eventMetadata: {
        eventId: "m-fixture",
        eventType: "type",
        createdAt: "2026-08-21T21:44:34.266Z",
        tracingContext: null,
        cloudId: "cloud",
        folderId: "folder",
      },
      payload: { id: "fixture" },
    };

    const payloadId: string = message.payload.id;
    const rawBody: string = message.body;
    // Attribute values are strings by construction — no numeric coercion in
    // the type system either.
    const attemptValue: string = message.messageAttributes["Attempt"]!.stringValue;

    expect(payloadId).toBe("fixture");
    expect(rawBody).toBe('{"id":"fixture"}');
    expect(attemptValue).toBe("1");

    // QueueMessage without an argument defaults its payload to unknown.
    const untyped: QueueMessage = message;
    expect(typeof untyped.payload).toBe("object");
  });
});

describe("execution context contract", () => {
  it("keeps memoryLimitInMB a string exactly as observed on the runtime", () => {
    const executionContext: YandexExecutionContext = {
      awsRequestId: "req-fixture",
      trace_id: "req-fixture",
      functionName: "fn-fixture",
      functionVersion: "$LATEST",
      functionFolderId: "folder-fixture",
      memoryLimitInMB: "1024",
      deadlineMs: 1771718400000,
      logGroupName: "group-fixture",
      token: "REDACTED_TOKEN",
      uberTraceId: "trace-fixture",
      rawEvent: {},
      raw: {},
      toJSON: () => ({}),
    };

    const uncoercedLimit: string = executionContext.memoryLimitInMB;

    expect(uncoercedLimit).toBe("1024");
  });

  it("keeps the raw invocation event reachable as an explicit escape hatch", () => {
    const rawEventFixture = { version: "2.0", rawPath: "/example" };
    const executionContext: YandexExecutionContext = {
      awsRequestId: "req-fixture",
      trace_id: "req-fixture",
      functionName: "fn-fixture",
      functionVersion: "$LATEST",
      functionFolderId: "folder-fixture",
      memoryLimitInMB: "1024",
      deadlineMs: 1771718400000,
      logGroupName: "",
      rawEvent: rawEventFixture,
      raw: {},
      toJSON: () => ({}),
    };

    // The untouched event must survive normalization by reference, never
    // merged or cloned away from advanced use cases (AGENTS.md section 7.3).
    expect(executionContext.rawEvent).toBe(rawEventFixture);
  });
});

describe("transport adapter SPI", () => {
  it("is implementable with a narrowing supports() predicate", async () => {
    const httpTransport: TransportAdapter<RawHttpApiGatewayV2Event> = {
      id: "http",
      supports(rawEvent): rawEvent is RawHttpApiGatewayV2Event {
        return (
          typeof rawEvent === "object" &&
          rawEvent !== null &&
          "version" in rawEvent &&
          rawEvent.version === "2.0"
        );
      },
      async invoke(invocation) {
        return invocation.rawEvent.requestId;
      },
    };

    expect(httpTransport.supports({ version: "2.0" })).toBe(true);
    expect(httpTransport.supports({ version: "1.0" })).toBe(false);
    expect(httpTransport.supports("not-an-event")).toBe(false);
  });

  it("lets the function runtime invoke a plain two-argument handler", async () => {
    const handler: YandexCloudFunctionHandler = async () => ({ ok: true });

    await expect(handler({}, {})).resolves.toEqual({ ok: true });
  });
});

describe("raw preservation mixin", () => {
  it("attaches raw payloads to normalized models without constraining their kind", () => {
    const carryingString: HasRaw<string> = { raw: "raw-value" };
    const carryingObject: HasRaw<{ id: number }> = { raw: { id: 1 } };

    expect(carryingString.raw).toBe("raw-value");
    expect(carryingObject.raw).toEqual({ id: 1 });
  });
});
