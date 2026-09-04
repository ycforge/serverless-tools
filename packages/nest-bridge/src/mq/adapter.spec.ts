import type { MockInstance } from "vitest";
import { Module, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { buildYandexExecutionContext } from "../context/build-yandex-execution-context";
import {
  extendInvocationScope,
  getInvocationScopeState,
  resolveInvocationQueueBatch,
  runInInvocationScope,
} from "../context/invocation-scope";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { ConnectorError } from "../core/connector-error";
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "../core/create-yandex-handler";
import { detectTransport } from "../core/detect-transport";
import type { TransportInvocation } from "../core/transport";
import { BUILTIN_TRANSPORTS } from "../core/transports";
import { httpApiGatewayV2Transport } from "../http/adapter";
import type { QueueBatch } from "./message";
import { messageQueueTransport } from "./adapter";
import { normalizeQueueBatch } from "./normalize-batch";
import { QueueHandler } from "./queue-handler.decorator";
// Merged export: the decorator factory plus the normalized message type.
import { QueueMessage } from "./queue-message.decorator";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * End-to-end specs for the Message Queue trigger transport (issue #7): the
 * cheap detection predicate and its exclusivity against the HTTP transport,
 * the full runtime path through `createYandexHandler`, invocation isolation
 * across warm/concurrent deliveries, and the boundary failure taxonomy.
 *
 * Fixtures mirror the sanitized captured trigger shape (DATA-ANALYSE.md
 * section C) — placeholder ids only, no captured credentials or payload data.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";
const EVENT_ID = "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8";

function makeMessageEnvelope(messageId: string = EVENT_ID): RawQueueMessageEvent {
  return {
    event_metadata: {
      event_id: messageId,
      event_type: "yandex.cloud.events.messagequeue.QueueMessage",
      created_at: "2026-08-21T21:44:34.266Z",
      tracing_context: null,
      cloud_id: "a1b2c3d4000000000000",
      folder_id: "e5f6a7b8000000000000",
    },
    details: {
      queue_id: QUEUE_ID,
      message: {
        message_id: messageId,
        md5_of_body: "9e107d9d372bb6826bd81d3542a419d6",
        body: '{"orderId":"order-fixture","items":3}',
        attributes: {
          ApproximateFirstReceiveTimestamp: "1787328274291",
          ApproximateReceiveCount: "1",
          SenderId: "AFIXTURESENDERID00001",
          SentTimestamp: "1787328274187",
        },
        message_attributes: {},
        md5_of_message_attributes: "",
      },
    },
  };
}

function makeQueueDelivery(...messageIds: string[]): RawQueueEvent {
  return {
    messages: (messageIds.length > 0 ? messageIds : [EVENT_ID]).map((id) =>
      makeMessageEnvelope(id),
    ),
  };
}

/** Minimal observed-shaped HTTP v2 event; used exclusively for exclusivity checks. */
const HTTP_EVENT = {
  version: "2.0",
  rawPath: "/fixture",
  rawQueryString: "",
};

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-mq-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

class RootModule {}
Module({})(RootModule);

/**
 * Recording consumer for the success-path specs: a plain NestJS provider
 * whose decorated method records each delivery. Since issue #8 a successful
 * queue invocation requires at least one @QueueHandler() registration.
 */
const HANDLED_MESSAGES: QueueMessage[] = [];

class ProbeQueueConsumer {
  handle(message: QueueMessage): void {
    HANDLED_MESSAGES.push(message);
  }
}

const PROBE_DESCRIPTOR = methodDescriptorOf(ProbeQueueConsumer.prototype, "handle");
QueueHandler()(ProbeQueueConsumer.prototype, "handle", PROBE_DESCRIPTOR);
QueueMessage()(ProbeQueueConsumer.prototype, "handle", 0);

class HandledModule {}
Module({ providers: [ProbeQueueConsumer] })(HandledModule);

function methodDescriptorOf(target: object, propertyKey: string): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${propertyKey}`);
  }
  return descriptor;
}

async function capturedRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the invocation to reject");
}

describe("message queue transport supports()", () => {
  it("claims observed-shape trigger deliveries via the messages fingerprint", () => {
    expect(messageQueueTransport.supports(makeQueueDelivery())).toBe(true);
    // Minimal claimable shape: only the cheap discriminator paths before
    // deeper validation runs inside invoke() (docs/ARCHITECTURE.md section 4).
    expect(
      messageQueueTransport.supports({
        messages: [
          {
            event_metadata: {},
            details: {
              queue_id: QUEUE_ID,
              message: { message_id: EVENT_ID },
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("claims multi-message deliveries without assuming a fixed batch size", () => {
    expect(
      messageQueueTransport.supports(
        makeQueueDelivery(EVENT_ID, "8b2f-d02a3f5c7b94416ac2e10d8f-63e5f9"),
      ),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "messages"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
    ["an empty messages array", { messages: [] }],
    ["a non-array messages field", { messages: "one" }],
    ["null message elements", { messages: [null] }],
    [
      "elements without event_metadata",
      {
        messages: [{ details: { queue_id: QUEUE_ID, message: { message_id: EVENT_ID } } }],
      },
    ],
    ["elements without details", { messages: [{ event_metadata: {} }] }],
    [
      "elements without details.queue_id",
      {
        messages: [{ event_metadata: {}, details: { message: { message_id: EVENT_ID } } }],
      },
    ],
    [
      "elements without details.message.message_id",
      { messages: [{ event_metadata: {}, details: { queue_id: QUEUE_ID, message: {} } }] },
    ],
  ])("never claims %s", (_label, candidate) => {
    expect(messageQueueTransport.supports(candidate)).toBe(false);
  });

  it("keeps HTTP / API Gateway events and Message Queue deliveries mutually exclusive", () => {
    const delivery = makeQueueDelivery();

    // The MQ fingerprint never matches an API Gateway v2 payload...
    expect(messageQueueTransport.supports(HTTP_EVENT)).toBe(false);
    // ...and the HTTP discriminator never matches a queue delivery.
    expect(httpApiGatewayV2Transport.supports(delivery)).toBe(false);

    // Through the real registry each shape is claimed by exactly one
    // transport, in deterministic registration order.
    expect(BUILTIN_TRANSPORTS.map((transport) => transport.id)).toEqual(["http", "message-queue"]);
    expect(detectTransport(BUILTIN_TRANSPORTS, HTTP_EVENT).id).toBe("http");
    expect(detectTransport(BUILTIN_TRANSPORTS, delivery).id).toBe("message-queue");
  });
});

describe("message queue transport through the runtime", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];
  let bootstrapSpy: MockInstance;

  beforeEach(() => {
    bootstrapSpy = vi.spyOn(NestFactory, "create");
    HANDLED_MESSAGES.length = 0;
  });

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
    bootstrapSpy.mockRestore();
  });

  function makeRuntime(
    appModule: Type<unknown> = HandledModule,
  ): ClosableYandexCloudFunctionHandler {
    // The public factory registers both built-in transports; queue events
    // must flow through the exact same detect -> init -> dispatch path.
    const runtime = createYandexHandler(appModule);
    runtimes.push(runtime);
    return runtime;
  }

  it("converts one delivery into its typed batch envelope end-to-end", async () => {
    const runtime = makeRuntime();
    const delivery = makeQueueDelivery();

    const result = (await runtime(delivery, RUNTIME_CONTEXT)) as QueueBatch;

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0]!;
    expect(message.messageId).toBe(EVENT_ID);
    expect(message.queueId).toBe(QUEUE_ID);
    expect(message.eventMetadata.eventType).toBe("yandex.cloud.events.messagequeue.QueueMessage");
    expect(message.attributes["ApproximateReceiveCount"]).toBe("1");
    // Issue #8: the normalized message reached the registered handler.
    expect(HANDLED_MESSAGES.map((handled) => handled.messageId)).toEqual([EVENT_ID]);

    await runtime.close();
  });

  it("fails deliveries of an application without any queue handler as NO_QUEUE_HANDLER", async () => {
    const runtime = makeRuntime(RootModule);

    const failure = await capturedRejection(runtime(makeQueueDelivery(), RUNTIME_CONTEXT));

    if (!(failure instanceof ConnectorError)) {
      throw new Error(`expected ConnectorError, received ${String(failure)}`);
    }
    // A handler-less application must not silently acknowledge messages
    // nobody consumed (AGENTS.md section 8.3); the event itself was valid,
    // so this is its own boundary code, not INVALID_INVOCATION_EVENT.
    expect(failure.code).toBe("NO_QUEUE_HANDLER");
    expect(failure.transportId).toBe("message-queue");

    await runtime.close();
  });

  it("preserves raw references by identity through the full runtime path", async () => {
    const runtime = makeRuntime();
    const delivery = makeQueueDelivery();

    const result = (await runtime(delivery, RUNTIME_CONTEXT)) as QueueBatch;

    expect(result.raw).toBe(delivery);
    expect(result.messages[0]!.raw).toBe(delivery.messages[0]);
  });

  it("reuses one warm application across sequential queue invocations", async () => {
    const runtime = makeRuntime();

    await runtime(makeQueueDelivery(), RUNTIME_CONTEXT);
    await runtime(makeQueueDelivery(), RUNTIME_CONTEXT);

    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it("leaks nothing between sequential invocations", async () => {
    const runtime = makeRuntime();

    const firstId = EVENT_ID;
    const secondId = "8b2f-d02a3f5c7b94416ac2e10d8f-63e5f9";
    const first = (await runtime(makeQueueDelivery(firstId), RUNTIME_CONTEXT)) as QueueBatch;
    const second = (await runtime(makeQueueDelivery(secondId), RUNTIME_CONTEXT)) as QueueBatch;

    // Invocation N+1 observes only its own delivery: different message id,
    // different raw references, nothing carried over (AGENTS.md section 11).
    expect(second.messages[0]!.messageId).toBe(secondId);
    expect(second.messages[0]!.raw).not.toBe(first.messages[0]!.raw);
    expect(second.raw).not.toBe(first.raw);
  });

  it("isolates concurrent invocations interleaving on the same warm application", async () => {
    const runtime = makeRuntime();
    const ids = [
      EVENT_ID,
      "8b2f-d02a3f5c7b94416ac2e10d8f-63e5f9",
      "c31a-e94b5f6d70a25271d3f21e9a04c6g1a",
    ];

    const results = (await Promise.all(
      ids.map(async (messageId, index) => {
        const context = {
          ...RUNTIME_CONTEXT,
          awsRequestId: `concurrent-invocation-${index}`,
        };
        return {
          messageId,
          result: (await runtime(makeQueueDelivery(messageId), context)) as QueueBatch,
        };
      }),
    )) as { messageId: string; result: QueueBatch }[];

    // Every concurrent invocation normalized exactly its own delivery.
    expect(results.map((entry) => entry.result.messages[0]!.messageId)).toEqual(ids);
    expect(new Set(results.map((entry) => entry.result.raw)).size).toBe(ids.length);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizes deep-frozen deliveries without mutating the raw event", async () => {
    const runtime = makeRuntime();
    const envelope = makeMessageEnvelope();
    const delivery = Object.freeze({
      messages: [
        Object.freeze({
          event_metadata: Object.freeze({ ...envelope.event_metadata }),
          details: Object.freeze({
            queue_id: envelope.details.queue_id,
            message: Object.freeze({ ...envelope.details.message }),
          }),
        }),
      ],
    }) as unknown as RawQueueEvent;

    // Assignments to frozen objects throw in strict mode; a successful run
    // proves normalization is transformation, not mutation (AGENTS.md §7.3).
    const result = (await runtime(delivery, RUNTIME_CONTEXT)) as QueueBatch;

    expect(result.messages[0]!.body).toBe(envelope.details.message.body);
  });

  it("fails claimed-but-malformed deliveries as INVALID_INVOCATION_EVENT", async () => {
    const runtime = makeRuntime();
    // Break a field below the cheap fingerprint so detection still claims
    // the delivery and deep validation rejects it.
    const malformed = makeQueueDelivery();
    const message = malformed.messages[0]!.details.message as Record<string, unknown>;
    message["body"] = 42;

    const failure = await capturedRejection(runtime(malformed, RUNTIME_CONTEXT));

    if (!(failure instanceof ConnectorError)) {
      throw new Error(`expected ConnectorError, received ${String(failure)}`);
    }
    expect(failure.code).toBe("INVALID_INVOCATION_EVENT");
    expect(failure.transportId).toBe("message-queue");
    expect(failure.message).toContain('field "messages[0].details.message.body"');
  });

  it("rejects near-miss shapes as UNKNOWN_INVOCATION_EVENT without any cold start", async () => {
    const runtime = makeRuntime();

    const failure = await capturedRejection(
      runtime({ messages: [{ event_metadata: {} }] }, RUNTIME_CONTEXT),
    );

    if (!(failure instanceof ConnectorError)) {
      throw new Error(`expected ConnectorError, received ${String(failure)}`);
    }
    // Not claimed by any transport: honest rejection instead of being
    // silently absorbed as an empty queue delivery (AGENTS.md section 8.3).
    expect(failure.code).toBe("UNKNOWN_INVOCATION_EVENT");
    expect(failure.transportId).toBeUndefined();
    // Detection precedes initialization: garbage traffic never pays for a
    // Nest bootstrap.
    expect(bootstrapSpy).not.toHaveBeenCalled();
  });

  it("requires the core-managed invocation scope around its dispatch", async () => {
    // Invoking the adapter outside the AsyncLocalStorage scope the core sets
    // up must fail loudly instead of skipping per-invocation state: every
    // real dispatch runs inside that scope.
    const executionContext: YandexExecutionContext = {
      awsRequestId: "req-fixture",
      trace_id: "req-fixture",
      functionName: "fn-fixture",
      functionVersion: "$LATEST",
      functionFolderId: "folder-fixture",
      memoryLimitInMB: "1024",
      deadlineMs: 1787328996791,
      logGroupName: "",
      rawEvent: {},
      raw: {},
      toJSON: () => ({}),
    };
    const invocation: TransportInvocation<RawQueueEvent> = {
      rawEvent: makeQueueDelivery(),
      rawContext: RUNTIME_CONTEXT,
      executionContext,
      container: {
        resolve: () => Promise.reject(new Error("unused")),
        getApplication: () => {
          throw new Error("unused");
        },
      },
    };

    await expect(messageQueueTransport.invoke(invocation)).rejects.toThrow(
      /can only be extended while handling a Yandex Cloud Function invocation/,
    );
  });

  it("keeps the published delivery scoped to exactly one running invocation", async () => {
    const delivery = makeQueueDelivery();
    const executionContext = buildYandexExecutionContext(delivery, RUNTIME_CONTEXT);

    // Mirrors the core's wrapping plus the transport's extension: user code
    // reached through the warm container reads the delivery from the
    // invocation scope while it runs (consumed by @QueueMessage() in issue
    // #8), concurrent chains stay isolated and nothing survives completion
    // (AGENTS.md section 11).
    const batch = normalizeQueueBatch(delivery);
    await runInInvocationScope({ executionContext }, () =>
      extendInvocationScope({ queueBatch: batch }, async () => {
        expect(resolveInvocationQueueBatch()).toBe(batch);
        // The execution context survives the extension untouched.
        expect(getInvocationScopeState()?.executionContext.awsRequestId).toBe(
          executionContext.awsRequestId,
        );
      }),
    );

    expect(() => resolveInvocationQueueBatch()).toThrow(/no Message Queue delivery/);
  });
});
