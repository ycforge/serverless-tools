import { Module } from "@nestjs/common";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { YandexContext } from "../context/yandex-context.decorator";
import { ConnectorError } from "../core/connector-error";
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "../core/create-yandex-handler";
import type { QueueBatch } from "./message";
import { QueueHandler } from "./queue-handler.decorator";
// Merged export: the decorator factory plus the normalized message type.
import { QueueMessage } from "./queue-message.decorator";
import type { RawQueueMessageEvent } from "./raw-event";

/**
 * Message Queue failure semantics through the public runtime (issue #10).
 *
 * Pinned here, end to end through `createYandexHandler()`:
 * - handler failures propagate verbatim out of the function invocation;
 * - payload deserialization failures are a distinct failure class
 *   (`QUEUE_BODY_DESERIALIZATION_FAILED`) yet fail the invocation just the
 *   same — with the raw body/message intact for user code;
 * - batch iteration is sequential and fail-fast in BOTH directions: the first
 *   failing round stops later messages, and earlier successful messages are
 *   never replayed inside the same invocation;
 * - successful processing resolves to the normalized batch — never an
 *   HTTP-style response envelope;
 * - concurrent invocations share neither errors nor message state.
 *
 * Acknowledgement, deletion, retry counters and dead-letter management are
 * deliberately absent: Yandex Message Queue owns them, and the failed
 * invocation is exactly the signal its retry/DLQ configuration consumes.
 * Fixtures mirror the sanitized captured trigger shape (DATA-ANALYSE.md
 * section C) — placeholder ids only.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";

function makeMessageEnvelope(
  messageId: string,
  body = '{"orderId":"order-fixture","items":3}',
): RawQueueMessageEvent {
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
        body,
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

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-mq-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

async function capturedRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the invocation to reject");
}

// ---------------------------------------------------------------------------
// Success-path consumer: proves a fully processed delivery resolves to the
// normalized batch instead of any HTTP-style envelope.
// ---------------------------------------------------------------------------

class SuccessConsumer {
  handle(message: QueueMessage): void {
    void message;
  }
}

QueueHandler()(
  SuccessConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(SuccessConsumer.prototype, "handle")!,
);
QueueMessage()(SuccessConsumer.prototype, "handle", 0);

class SuccessModule {}
Module({ providers: [SuccessConsumer] })(SuccessModule);

// ---------------------------------------------------------------------------
// Scripted consumer: records every round as `<requestId>:<messageId>` and
// fails the message ids configured by the running test.
// ---------------------------------------------------------------------------

const ATTEMPTS: string[] = [];
let failOnMessageIds: ReadonlySet<string> = new Set();
let seededFailure = new Error("unconfigured scripted failure");
/** When set, the matching message's handler parks on the gate first. */
let gatedMessageId: string | undefined;
let gateForGatedMessage: Promise<void> = Promise.resolve();

class ScriptedConsumer {
  async handle(message: QueueMessage, executionContext: YandexExecutionContext): Promise<void> {
    if (gatedMessageId === message.messageId) {
      await gateForGatedMessage;
    }
    ATTEMPTS.push(`${executionContext.awsRequestId}:${message.messageId}`);
    if (failOnMessageIds.has(message.messageId)) {
      throw seededFailure;
    }
  }
}

QueueHandler()(
  ScriptedConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(ScriptedConsumer.prototype, "handle")!,
);
QueueMessage()(ScriptedConsumer.prototype, "handle", 0);
YandexContext()(ScriptedConsumer.prototype, "handle", 1);

class ScriptedModule {}
Module({ providers: [ScriptedConsumer] })(ScriptedModule);

// ---------------------------------------------------------------------------
// Payload-reading consumer: touches the untouched representations FIRST so
// tests can prove raw availability even when decoding then fails.
// ---------------------------------------------------------------------------

interface RawObservation {
  readonly requestId: string;
  readonly messageId: string;
  readonly body: string;
  readonly rawMessageId: string;
}

const RAW_OBSERVATIONS: RawObservation[] = [];

class PayloadReadingConsumer {
  async handle(message: QueueMessage, executionContext: YandexExecutionContext): Promise<void> {
    RAW_OBSERVATIONS.push({
      requestId: executionContext.awsRequestId,
      messageId: message.messageId,
      body: message.body,
      rawMessageId: message.raw.details.message.message_id,
    });
    // First payload access performs the decode under the configured policy.
    void message.payload;
  }
}

QueueHandler()(
  PayloadReadingConsumer.prototype,
  "handle",
  Object.getOwnPropertyDescriptor(PayloadReadingConsumer.prototype, "handle")!,
);
QueueMessage()(PayloadReadingConsumer.prototype, "handle", 0);
YandexContext()(PayloadReadingConsumer.prototype, "handle", 1);

class PayloadModule {}
Module({ providers: [PayloadReadingConsumer] })(PayloadModule);

describe("message queue failure semantics through the public runtime", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  beforeEach(() => {
    failOnMessageIds = new Set();
    seededFailure = new Error("unconfigured scripted failure");
    gatedMessageId = undefined;
    gateForGatedMessage = Promise.resolve();
    ATTEMPTS.length = 0;
    RAW_OBSERVATIONS.length = 0;
  });

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  it("resolves successful deliveries to the normalized batch without any response envelope", async () => {
    const runtime = createYandexHandler(SuccessModule);
    runtimes.push(runtime);

    const result = await runtime({ messages: [makeMessageEnvelope("m-ok")] }, RUNTIME_CONTEXT);

    const batch = result as QueueBatch;
    expect(batch.messages.map((message) => message.messageId)).toEqual(["m-ok"]);
    // A queue delivery has no envelope: none of the HTTP response fields may
    // appear on the transport result (docs/ARCHITECTURE.md section 6.2).
    expect(result).not.toHaveProperty("statusCode");
    expect(result).not.toHaveProperty("body");
    expect(result).not.toHaveProperty("isBase64Encoded");
  });

  it("propagates queue handler failures verbatim out of the function invocation", async () => {
    const runtime = createYandexHandler(ScriptedModule);
    runtimes.push(runtime);

    const consumerFailure = new Error("consumer-boom");
    failOnMessageIds = new Set(["m-bad"]);
    seededFailure = consumerFailure;

    const failure = await capturedRejection(
      runtime({ messages: [makeMessageEnvelope("m-bad")] }, RUNTIME_CONTEXT),
    );

    // Verbatim identity: not wrapped, not converted, not swallowed — the
    // exact error the handler threw rejects the invocation.
    expect(failure).toBe(consumerFailure);
    expect(failure).not.toBeInstanceOf(ConnectorError);
  });

  it("stops at the first failing message and never attempts later ones", async () => {
    const runtime = createYandexHandler(ScriptedModule);
    runtimes.push(runtime);

    const consumerFailure = new Error("first-message-boom");
    failOnMessageIds = new Set(["m-1"]);
    seededFailure = consumerFailure;

    const failure = await capturedRejection(
      runtime(
        {
          messages: [
            makeMessageEnvelope("m-1"),
            makeMessageEnvelope("m-2"),
            makeMessageEnvelope("m-3"),
          ],
        },
        RUNTIME_CONTEXT,
      ),
    );

    expect(failure).toBe(consumerFailure);
    expect(ATTEMPTS).toEqual([`${RUNTIME_CONTEXT.awsRequestId}:m-1`]);
  });

  it("never replays earlier successful messages within the same invocation when a later one fails", async () => {
    const runtime = createYandexHandler(ScriptedModule);
    runtimes.push(runtime);

    const consumerFailure = new Error("third-message-boom");
    failOnMessageIds = new Set(["m-3"]);
    seededFailure = consumerFailure;

    const failure = await capturedRejection(
      runtime(
        {
          messages: [
            makeMessageEnvelope("m-1"),
            makeMessageEnvelope("m-2"),
            makeMessageEnvelope("m-3"),
          ],
        },
        RUNTIME_CONTEXT,
      ),
    );

    expect(failure).toBe(consumerFailure);
    // Every round ran exactly once, in delivery order; retrying earlier
    // messages is Yandex Message Queue's redelivery decision, never the
    // connector's (docs/ARCHITECTURE.md section 6.2).
    expect(ATTEMPTS).toEqual([
      `${RUNTIME_CONTEXT.awsRequestId}:m-1`,
      `${RUNTIME_CONTEXT.awsRequestId}:m-2`,
      `${RUNTIME_CONTEXT.awsRequestId}:m-3`,
    ]);
  });

  it("fails payload deserialization as QUEUE_BODY_DESERIALIZATION_FAILED while keeping raw access intact", async () => {
    const runtime = createYandexHandler(PayloadModule);
    runtimes.push(runtime);

    const undecodableBody = "definitely-not-json{";
    const failure = await capturedRejection(
      runtime({ messages: [makeMessageEnvelope("m-text", undecodableBody)] }, RUNTIME_CONTEXT),
    );

    // Distinct failure class: a boundary deserialization error carrying the
    // stable code, unlike plain handler failures which propagate unwrapped.
    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as ConnectorError).code).toBe("QUEUE_BODY_DESERIALIZATION_FAILED");

    // The handler had already observed the untouched representations before
    // the decode failed: nothing about the failure corrupts raw access.
    expect(RAW_OBSERVATIONS).toHaveLength(1);
    expect(RAW_OBSERVATIONS[0]?.body).toBe(undecodableBody);
    expect(RAW_OBSERVATIONS[0]?.rawMessageId).toBe("m-text");

    // Diagnostics stay value-free: no body fragment inside the boundary error.
    expect(String(failure)).not.toContain(undecodableBody);
  });

  it("applies the same fail-fast contract to mid-batch deserialization failures", async () => {
    const runtime = createYandexHandler(PayloadModule);
    runtimes.push(runtime);

    const failure = await capturedRejection(
      runtime(
        {
          messages: [
            makeMessageEnvelope("m-good"),
            makeMessageEnvelope("m-bad", "{ truncated"),
            makeMessageEnvelope("m-good-after-bad"),
          ],
        },
        RUNTIME_CONTEXT,
      ),
    );

    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as ConnectorError).code).toBe("QUEUE_BODY_DESERIALIZATION_FAILED");
    expect(RAW_OBSERVATIONS.map((observation) => observation.messageId)).toEqual([
      "m-good",
      "m-bad",
    ]);
  });

  it("isolates errors and message state across concurrent invocations on the warm application", async () => {
    const runtime = createYandexHandler(ScriptedModule);
    runtimes.push(runtime);

    const contextA = { ...RUNTIME_CONTEXT, awsRequestId: "inv-concurrent-a" };
    const contextB = { ...RUNTIME_CONTEXT, awsRequestId: "inv-concurrent-b" };
    const failureA = new Error("delivery-a-boom");

    // Delivery A parks inside its handler until delivery B has fully settled,
    // forcing real interleave on the shared warm application.
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolveGate) => {
      releaseA = resolveGate;
    });
    gatedMessageId = "m-a1";
    gateForGatedMessage = gateA;

    failOnMessageIds = new Set(["m-a1"]);
    seededFailure = failureA;

    const invocationA = runtime(
      { messages: [makeMessageEnvelope("m-a1")] },
      contextA,
    ) as Promise<unknown>;
    const invocationB = runtime(
      { messages: [makeMessageEnvelope("m-b1"), makeMessageEnvelope("m-b2")] },
      contextB,
    ) as Promise<QueueBatch>;

    let settledB = false;
    void invocationB.then(
      () => {
        settledB = true;
      },
      () => {
        settledB = true;
      },
    );
    while (!settledB) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    releaseA();

    const batchB = await invocationB;
    const rejectionA = await capturedRejection(invocationA);

    // B completed unaffected while A was parked and eventually failed...
    expect(batchB.messages.map((message) => message.messageId)).toEqual(["m-b1", "m-b2"]);
    expect(rejectionA).toBe(failureA);

    // ...and every recorded round carries its own invocation's correlation id:
    // neither errors nor scoped message state crossed invocations (AGENTS.md
    // section 11).
    expect(ATTEMPTS.sort()).toEqual([
      "inv-concurrent-a:m-a1",
      "inv-concurrent-b:m-b1",
      "inv-concurrent-b:m-b2",
    ]);
  });
});
