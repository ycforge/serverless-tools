import { Injectable, Module, Scope, type Type } from "@nestjs/common";
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "../core/create-yandex-handler";
import { resolveInvocationQueueBatch } from "../context/invocation-scope";
import { YandexContext } from "../context/yandex-context.decorator";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { ConnectorError } from "../core/connector-error";
import type { QueueBatch } from "./message";
import { QueueHandler } from "./queue-handler.decorator";
// Merged export: the decorator factory plus the normalized message type.
import { QueueMessage } from "./queue-message.decorator";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * Integration specs for Message Queue handler dispatch through the public
 * connector API (issue #8): real NestJS bootstraps, real dependency
 * injection, real invocation scopes — covering exactly the behaviors the
 * transport-level specs cannot observe from inside user code.
 *
 * Fixtures mirror the sanitized captured trigger shape (DATA-ANALYSE.md
 * section C) — placeholder ids only, no captured credentials or payload data.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";
const EVENT_ID = "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8";

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-mq-dispatch-integration",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

function makeMessageEnvelope(messageId: string = EVENT_ID, body?: string): RawQueueMessageEvent {
  const resolvedBody = body ?? '{"orderId":"order-fixture","items":3}';
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
        // Checksums are fixtures only: the connector passes them through
        // verbatim and never verifies them against the body.
        md5_of_body: "9e107d9d372bb6826bd81d3542a419d6",
        body: resolvedBody,
        attributes: {
          ApproximateReceiveCount: "1",
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

interface ObservedRound {
  messageId?: string;
  requestId?: string;
  rawMessageIdentity?: unknown;
  scopedBatchRawIdentity?: unknown;
}

/**
 * Records every handler round. Statics keep assertions independent of how
 * Nest scopes the instances; they are reset before every spec.
 */
class RecordingConsumer {
  static readonly rounds: ObservedRound[] = [];

  handle(message: QueueMessage, executionContext: YandexExecutionContext): void {
    RecordingConsumer.rounds.push({
      messageId: message?.messageId,
      requestId: executionContext?.awsRequestId,
      rawMessageIdentity: message?.raw,
      scopedBatchRawIdentity: resolveInvocationQueueBatch().raw,
    });
  }
}

const RECORDING_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  RecordingConsumer.prototype,
  "handle",
)!;
QueueHandler()(RecordingConsumer.prototype, "handle", RECORDING_DESCRIPTOR);
QueueMessage()(RecordingConsumer.prototype, "handle", 0);
YandexContext()(RecordingConsumer.prototype, "handle", 1);

class FailingConsumer {
  handle(message: QueueMessage): void {
    throw new Error(`fixture handler rejected ${String(message.messageId)}`);
  }
}

const FAILING_DESCRIPTOR = Object.getOwnPropertyDescriptor(FailingConsumer.prototype, "handle")!;
QueueHandler()(FailingConsumer.prototype, "handle", FAILING_DESCRIPTOR);
QueueMessage()(FailingConsumer.prototype, "handle", 0);

class RecordingModule {}
Module({ providers: [RecordingConsumer] })(RecordingModule);

/**
 * Payload-level fixtures (issue #9): the consumer types the injected message
 * generically and reads the deserialized payload, while raw fields stay
 * observable beside it.
 */
interface OrderPayload {
  orderId?: string;
  items?: number;
}

class PayloadConsumer {
  static readonly rounds: {
    messageId?: string;
    orderId?: string;
    items?: number;
    bodyLength?: number;
    rawBodyPresent?: boolean;
  }[] = [];

  handle(message: QueueMessage<OrderPayload>): void {
    PayloadConsumer.rounds.push({
      messageId: message?.messageId,
      orderId: message?.payload?.orderId,
      items: message?.payload?.items,
      bodyLength: message?.body?.length,
      rawBodyPresent: typeof message?.raw?.details?.message?.body === "string",
    });
  }
}

const PAYLOAD_DESCRIPTOR = Object.getOwnPropertyDescriptor(PayloadConsumer.prototype, "handle")!;
QueueHandler()(PayloadConsumer.prototype, "handle", PAYLOAD_DESCRIPTOR);
QueueMessage()(PayloadConsumer.prototype, "handle", 0);

class TextConsumer {
  static readonly payloads: string[] = [];

  handle(message: QueueMessage<string>): void {
    TextConsumer.payloads.push(message.payload);
  }
}

QueueHandler()(
  TextConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(TextConsumer.prototype, "handle")!,
);
QueueMessage()(TextConsumer.prototype, "handle", 0);

class PayloadModule {}
Module({ providers: [PayloadConsumer] })(PayloadModule);

class TextModule {}
Module({ providers: [TextConsumer] })(TextModule);

class FailingModule {}
Module({ providers: [FailingConsumer] })(FailingModule);

/**
 * Provider-lifecycle fixtures (real NestJS scopes, no decorator compilation
 * involved): instance ids come from one shared counter so specs can observe
 * exactly when Nest creates a new instance. Statics are reset per spec.
 */
let lifecycleInstanceCounter = 0;

interface LifecycleRound {
  messageId?: string;
  requestId?: string;
  instanceId: number;
}

class RequestScopedConsumer {
  static readonly rounds: LifecycleRound[] = [];

  readonly instanceId = ++lifecycleInstanceCounter;

  handle(message: QueueMessage, executionContext: YandexExecutionContext): void {
    RequestScopedConsumer.rounds.push({
      messageId: message?.messageId,
      requestId: executionContext?.awsRequestId,
      instanceId: this.instanceId,
    });
  }
}
Injectable({ scope: Scope.REQUEST })(RequestScopedConsumer);
QueueHandler()(
  RequestScopedConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(RequestScopedConsumer.prototype, "handle")!,
);
QueueMessage()(RequestScopedConsumer.prototype, "handle", 0);
YandexContext()(RequestScopedConsumer.prototype, "handle", 1);

class TransientScopedConsumer {
  static readonly rounds: LifecycleRound[] = [];

  readonly instanceId = ++lifecycleInstanceCounter;

  handle(message: QueueMessage): void {
    TransientScopedConsumer.rounds.push({
      messageId: message?.messageId,
      instanceId: this.instanceId,
    });
  }
}
Injectable({ scope: Scope.TRANSIENT })(TransientScopedConsumer);
QueueHandler()(
  TransientScopedConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(TransientScopedConsumer.prototype, "handle")!,
);
QueueMessage()(TransientScopedConsumer.prototype, "handle", 0);

class SingletonScopedConsumer {
  static readonly rounds: LifecycleRound[] = [];

  readonly instanceId = ++lifecycleInstanceCounter;

  handle(message: QueueMessage): void {
    SingletonScopedConsumer.rounds.push({
      messageId: message?.messageId,
      instanceId: this.instanceId,
    });
  }
}
Injectable()(SingletonScopedConsumer);
QueueHandler()(
  SingletonScopedConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(SingletonScopedConsumer.prototype, "handle")!,
);
QueueMessage()(SingletonScopedConsumer.prototype, "handle", 0);

/**
 * Two handler methods on ONE request-scoped provider: dispatch must resolve
 * both methods against the same DI sub-tree per message, so every handler
 * call of a delivery observes the identical request-scoped `this`.
 */
class SharedSubtreeConsumer {
  static readonly rounds: { method: string; messageId?: string; instanceId: number }[] = [];

  readonly instanceId = ++lifecycleInstanceCounter;

  handleFirst(message: QueueMessage): void {
    SharedSubtreeConsumer.rounds.push({
      method: "first",
      messageId: message?.messageId,
      instanceId: this.instanceId,
    });
  }

  handleSecond(message: QueueMessage): void {
    SharedSubtreeConsumer.rounds.push({
      method: "second",
      messageId: message?.messageId,
      instanceId: this.instanceId,
    });
  }
}
Injectable({ scope: Scope.REQUEST })(SharedSubtreeConsumer);
for (const methodName of ["handleFirst", "handleSecond"] as const) {
  QueueHandler()(
    SharedSubtreeConsumer.prototype,
    methodName,
    Object.getOwnPropertyDescriptor(SharedSubtreeConsumer.prototype, methodName)!,
  );
  QueueMessage()(SharedSubtreeConsumer.prototype, methodName, 0);
}

class LifecycleModule {}
Module({
  providers: [
    RequestScopedConsumer,
    TransientScopedConsumer,
    SingletonScopedConsumer,
    SharedSubtreeConsumer,
  ],
})(LifecycleModule);

describe("queue handler dispatch through the public runtime", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  beforeEach(() => {
    RecordingConsumer.rounds.length = 0;
    PayloadConsumer.rounds.length = 0;
    TextConsumer.payloads.length = 0;
    RequestScopedConsumer.rounds.length = 0;
    TransientScopedConsumer.rounds.length = 0;
    SingletonScopedConsumer.rounds.length = 0;
    SharedSubtreeConsumer.rounds.length = 0;
    lifecycleInstanceCounter = 0;
  });

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  function makeRuntime(
    appModule: Type<unknown> = RecordingModule,
  ): ClosableYandexCloudFunctionHandler {
    const runtime = createYandexHandler(appModule);
    runtimes.push(runtime);
    return runtime;
  }

  it("delivers every message of a multi-message batch to the handler in order", async () => {
    const runtime = makeRuntime();
    const delivery = makeQueueDelivery("m-one", "m-two", "m-three");

    const result = (await runtime(delivery, RUNTIME_CONTEXT)) as QueueBatch;

    // Sequential fan-out over the whole batch: one handler round per
    // message, in delivery order, regardless of the trigger's current
    // grouped-message limit of 1 (**observed**, DATA-ANALYSE.md section C).
    expect(RecordingConsumer.rounds.map((round) => round.messageId)).toEqual([
      "m-one",
      "m-two",
      "m-three",
    ]);
    expect(result.messages).toHaveLength(3);
    await runtime.close();
  });

  it("injects @QueueMessage() and @YandexContext() through real dependency injection", async () => {
    const runtime = makeRuntime();
    const delivery = makeQueueDelivery();

    await runtime(delivery, RUNTIME_CONTEXT);

    const round = RecordingConsumer.rounds[0];
    expect(round?.messageId).toBe(EVENT_ID);
    expect(round?.requestId).toBe(RUNTIME_CONTEXT.awsRequestId);
    await runtime.close();
  });

  it("hands the untouched raw references to user code", async () => {
    const runtime = makeRuntime();
    const delivery = makeQueueDelivery();

    await runtime(delivery, RUNTIME_CONTEXT);

    // The raw escape hatches survive all the way into handler parameters
    // (AGENTS.md section 36): the message keeps its exact raw envelope and
    // the invocation-scoped batch keeps the untouched delivery object.
    expect(RecordingConsumer.rounds[0]?.rawMessageIdentity).toBe(delivery.messages[0]);
    expect(RecordingConsumer.rounds[0]?.scopedBatchRawIdentity).toBe(delivery);
    await runtime.close();
  });

  it("keeps handler observations isolated across sequential invocations", async () => {
    const runtime = makeRuntime();

    await runtime(makeQueueDelivery("seq-first"), RUNTIME_CONTEXT);
    expect(RecordingConsumer.rounds.map((round) => round.messageId)).toEqual(["seq-first"]);

    await runtime(makeQueueDelivery("seq-second"), RUNTIME_CONTEXT);
    expect(RecordingConsumer.rounds.map((round) => round.messageId)).toEqual([
      "seq-first",
      "seq-second",
    ]);
    await runtime.close();
  });

  it("pairs each message with its own invocation context under concurrency", async () => {
    const runtime = makeRuntime();
    const ids = ["cc-first", "cc-second", "cc-third"];

    await Promise.all(
      ids.map(async (messageId, index) => {
        const context = {
          ...RUNTIME_CONTEXT,
          awsRequestId: `concurrent-request-${index}`,
        };
        await runtime(makeQueueDelivery(messageId), context);
      }),
    );

    // Warm-application concurrency: every recorded round pairs the message
    // of one invocation with THAT invocation's execution context — never a
    // sibling's (AGENTS.md section 11).
    expect(RecordingConsumer.rounds).toHaveLength(ids.length);
    for (const round of RecordingConsumer.rounds) {
      const index = ids.indexOf(round.messageId ?? "");
      expect(round.requestId).toBe(`concurrent-request-${index}`);
    }
    await runtime.close();
  });

  it("propagates handler failures as failed invocations", async () => {
    const runtime = makeRuntime(FailingModule);

    // Failures must stay failures so Yandex Message Queue retry/dead-letter
    // configuration observes them (AGENTS.md section 8.2) — the original
    // error surfaces unwrapped, not absorbed into a successful response.
    await expect(runtime(makeQueueDelivery("doomed-id"), RUNTIME_CONTEXT)).rejects.toThrow(
      "fixture handler rejected doomed-id",
    );
    await runtime.close();
  });

  it("resolves a fresh REQUEST-scoped handler instance for each message of one batch", async () => {
    const runtime = makeRuntime(LifecycleModule);
    const delivery = makeQueueDelivery("rq-first", "rq-second");

    await runtime(delivery, RUNTIME_CONTEXT);

    // One delivery = one request per MESSAGE: every message observes its own
    // request-scoped instance, never one shared across the batch.
    const rounds = RequestScopedConsumer.rounds;
    expect(rounds.map((round) => round.messageId)).toEqual(["rq-first", "rq-second"]);
    expect(rounds[0]?.instanceId).not.toBe(rounds[1]?.instanceId);
    // @YandexContext() keeps resolving the invocation context in both rounds.
    expect(rounds.map((round) => round.requestId)).toEqual([
      RUNTIME_CONTEXT.awsRequestId,
      RUNTIME_CONTEXT.awsRequestId,
    ]);
    await runtime.close();
  });

  it("observes one REQUEST-scoped DI sub-tree across all handler calls of a message", async () => {
    const runtime = makeRuntime(LifecycleModule);

    await runtime(makeQueueDelivery("st-first", "st-second"), RUNTIME_CONTEXT);

    // Both decorated methods belong to the same provider: within one message
    // they must observe the identical instance (one DI sub-tree per message,
    // like one platform request), while the next message gets its own.
    const rounds = SharedSubtreeConsumer.rounds;
    expect(rounds.map((round) => `${round.messageId}:${round.method}`)).toEqual([
      "st-first:first",
      "st-first:second",
      "st-second:first",
      "st-second:second",
    ]);
    expect(rounds[0]?.instanceId).toBe(rounds[1]?.instanceId);
    expect(rounds[2]?.instanceId).toBe(rounds[3]?.instanceId);
    expect(rounds[0]?.instanceId).not.toBe(rounds[2]?.instanceId);
    await runtime.close();
  });

  it("gives TRANSIENT handlers a fresh instance per message", async () => {
    const runtime = makeRuntime(LifecycleModule);

    await runtime(makeQueueDelivery("tr-first", "tr-second"), RUNTIME_CONTEXT);

    const rounds = TransientScopedConsumer.rounds;
    expect(rounds.map((round) => round.messageId)).toEqual(["tr-first", "tr-second"]);
    expect(rounds[0]?.instanceId).not.toBe(rounds[1]?.instanceId);
    await runtime.close();
  });

  it("keeps DEFAULT-scoped handlers as singletons across messages and warm invocations", async () => {
    const runtime = makeRuntime(LifecycleModule);

    await runtime(makeQueueDelivery("sg-first"), RUNTIME_CONTEXT);
    await runtime(makeQueueDelivery("sg-second"), RUNTIME_CONTEXT);

    // Same instance through both messages AND both invocations: singleton
    // caching is untouched by queue dispatch (AGENTS.md sections 10-11).
    const instanceIds = new Set(SingletonScopedConsumer.rounds.map((round) => round.instanceId));
    expect(SingletonScopedConsumer.rounds.map((round) => round.messageId)).toEqual([
      "sg-first",
      "sg-second",
    ]);
    expect(instanceIds.size).toBe(1);
    await runtime.close();
  });

  it("isolates REQUEST-scoped state between concurrent invocations", async () => {
    const runtime = makeRuntime(LifecycleModule);
    const deliveries = [
      { messageId: "cx-first", requestId: "cx-request-a" },
      { messageId: "cx-second", requestId: "cx-request-b" },
    ];

    await Promise.all(
      deliveries.map(({ messageId, requestId }) =>
        runtime(makeQueueDelivery(messageId), { ...RUNTIME_CONTEXT, awsRequestId: requestId }),
      ),
    );

    // Concurrent invocations each get their own request-scoped sub-tree:
    // distinct instances, each paired with exactly its own execution context.
    const rounds = RequestScopedConsumer.rounds;
    expect(rounds).toHaveLength(deliveries.length);
    expect(new Set(rounds.map((round) => round.instanceId)).size).toBe(deliveries.length);
    for (const round of rounds) {
      const expected = deliveries.find((entry) => entry.messageId === round.messageId);
      expect(round.requestId).toBe(expected?.requestId);
    }
    await runtime.close();
  });

  it("resolves successful dispatch to the batch without HTTP response semantics", async () => {
    const runtime = makeRuntime();

    const result = (await runtime(makeQueueDelivery(), RUNTIME_CONTEXT)) as Record<string, unknown>;

    // A queue delivery has no response envelope: the result carries the
    // normalized batch only, never status codes or header maps.
    expect(Object.keys(result)).toEqual(expect.arrayContaining(["messages", "raw"]));
    expect(result).not.toHaveProperty("statusCode");
    expect(result).not.toHaveProperty("isBase64Encoded");
    expect(result).not.toHaveProperty("headers");
    await runtime.close();
  });

  it("injects the decoded typed payload while raw representations stay accessible", async () => {
    const runtime = makeRuntime(PayloadModule);

    await runtime(makeQueueDelivery(), RUNTIME_CONTEXT);

    const round = PayloadConsumer.rounds[0];
    // The generic QueueMessage<OrderPayload> surfaces payload.orderId at
    // compile time; at runtime it is the JSON-decoded body.
    expect(round?.orderId).toBe("order-fixture");
    expect(round?.items).toBe(3);
    // Raw transport representation remains byte-identical beside the payload.
    expect(round?.bodyLength).toBe('{"orderId":"order-fixture","items":3}'.length);
    expect(round?.rawBodyPresent).toBe(true);
    await runtime.close();
  });

  it("pairs every message of a batch with its own decoded payload", async () => {
    const runtime = makeRuntime(PayloadModule);
    const delivery: RawQueueEvent = {
      messages: [
        makeMessageEnvelope("pl-first", '{"orderId":"first","items":1}'),
        makeMessageEnvelope("pl-second", '{"orderId":"second","items":2}'),
        makeMessageEnvelope("pl-third", '{"orderId":"third","items":3}'),
      ],
    };

    await runtime(delivery, RUNTIME_CONTEXT);

    // Per-message memoization: order preserved, payloads never crossed.
    expect(PayloadConsumer.rounds.map((round) => `${round.messageId}:${round.orderId}`)).toEqual([
      "pl-first:first",
      "pl-second:second",
      "pl-third:third",
    ]);
    await runtime.close();
  });

  it("fails invocations whose payload cannot be decoded under the default policy", async () => {
    const runtime = makeRuntime(PayloadModule);
    const delivery: RawQueueEvent = {
      messages: [
        makeMessageEnvelope("broken-json"),
        makeMessageEnvelope("broken-json-2", "definitely not json"),
      ],
    };

    let caught: unknown;
    try {
      await runtime(delivery, RUNTIME_CONTEXT);
    } catch (error) {
      caught = error;
    }

    // Deterministic boundary failure, not a silent arbitrary object; the
    // first message was consumed before the poisoned one stopped the run.
    expect(caught).toBeInstanceOf(ConnectorError);
    expect((caught as ConnectorError).code).toBe("QUEUE_BODY_DESERIALIZATION_FAILED");
    expect(PayloadConsumer.rounds.map((round) => round.messageId)).toEqual(["broken-json"]);
    await runtime.close();
  });

  it("decodes bodies through a configured custom deserializer", async () => {
    const configured = createYandexHandler(TextModule, {
      queue: { deserializeBody: (body) => `decoded:${body}` },
    });
    runtimes.push(configured);
    const delivery: RawQueueEvent = {
      messages: [makeMessageEnvelope(EVENT_ID, "plain text")],
    };

    await configured(delivery, RUNTIME_CONTEXT);

    // Plain-text queues stay usable when an explicit strategy is installed.
    expect(TextConsumer.payloads).toEqual(["decoded:plain text"]);
    await configured.close();
  });

  it("isolates payload decoding between concurrent invocations", async () => {
    const runtime = makeRuntime(PayloadModule);

    await Promise.all([
      runtime(
        { messages: [makeMessageEnvelope("cx-payload-a", '{"orderId":"a"}')] },
        RUNTIME_CONTEXT,
      ),
      runtime(
        { messages: [makeMessageEnvelope("cx-payload-b", '{"orderId":"b"}')] },
        RUNTIME_CONTEXT,
      ),
    ]);

    // Warm-application concurrency: each invocation decodes its own message
    // and no payload crosses the isolation boundary.
    expect(new Set(PayloadConsumer.rounds.map((round) => round.orderId))).toEqual(
      new Set(["a", "b"]),
    );
    for (const round of PayloadConsumer.rounds) {
      expect(round.orderId).toBe(round.messageId?.replace("cx-payload-", ""));
    }
    await runtime.close();
  });
});
