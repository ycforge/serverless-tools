import { buildYandexExecutionContext } from "../../src/context/build-yandex-execution-context";
import {
  getInvocationScopeState,
  runInInvocationScope,
} from "../../src/context/invocation-scope";
import { dispatchQueueHandlers } from "../../src/mq/dispatch";
import { normalizeQueueBatch } from "../../src/mq/normalize-batch";
import { QueueHandler } from "../../src/mq/queue-handler.decorator";
import type { QueueTransportOptions } from "../../src/core/handler-options";
import type { RawQueueEvent, RawQueueMessageEvent } from "../../src/mq/raw-event";

/**
 * Integration specs for partial failure handling (issue #005).
 *
 * These tests verify the full degrade-path flow: per-message continuation,
 * outcome collection, DLQ republishing (mocked), and observability
 * correlation — through the real dispatch machinery.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";

const RUNTIME_CONTEXT = {
  awsRequestId: "trace-id-integration-001",
  functionName: "fn-partial-failure-integration",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

function makeMessageEnvelope(messageId: string, body?: string): RawQueueMessageEvent {
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
        body: body ?? '{"data":"fixture"}',
        attributes: {},
        message_attributes: {},
        md5_of_message_attributes: "",
      },
    },
  };
}

function makeQueueDelivery(...messageIds: string[]): RawQueueEvent {
  return { messages: messageIds.map((id) => makeMessageEnvelope(id)) };
}

function methodDescriptorOf(target: object, propertyKey: string | symbol) {
  const d = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!d) throw new Error(`missing descriptor for ${String(propertyKey)}`);
  return d;
}

function decorateQueueHandler(target: object, propertyKey: string | symbol): void {
  QueueHandler()(target, propertyKey, methodDescriptorOf(target, propertyKey));
}

function fakeInvocationContainer(instances: ReadonlyMap<unknown, object>) {
  return {
    async resolve<T>(token: unknown): Promise<T> {
      const instance = instances.get(token);
      if (!instance) throw new Error(`no instance for ${String(token)}`);
      return instance as T;
    },
  };
}

describe("partial failure integration", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const DEGRADE_OPTIONS: QueueTransportOptions = {
    partialFailure: { enabled: true },
  };
  const DEGRADE_WITH_DLQ: QueueTransportOptions = {
    partialFailure: { enabled: true, deadLetterQueueId: "dlq-queue" },
  };

  function makeDispatchContext(rawEvent: RawQueueEvent) {
    return buildYandexExecutionContext(rawEvent, RUNTIME_CONTEXT);
  }

  it("US1/AC1: degrade mode attempts all messages after a failure", async () => {
    const delivery = makeQueueDelivery("m-0", "m-fail", "m-2");
    const batch = normalizeQueueBatch(delivery);
    const order: string[] = [];

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        order.push(msg?.messageId ?? "?");
        if (msg?.messageId === "m-fail") throw new Error("poison");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
      dispatchQueueHandlers(
        fakeInvocationContainer(new Map([[Handler, new Handler()]])),
        [{ token: Handler, methodName: "handle" }],
        batch,
        DEGRADE_OPTIONS,
      ),
    );

    expect(order).toEqual(["m-0", "m-fail", "m-2"]);
  });

  it("US1/AC2: default fail-fast stops at first failure", async () => {
    const delivery = makeQueueDelivery("m-0", "m-fail", "m-never");
    const batch = normalizeQueueBatch(delivery);
    const order: string[] = [];

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        order.push(msg?.messageId ?? "?");
        if (msg?.messageId === "m-fail") throw new Error("poison");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const error = await (async () => {
      try {
        await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
          dispatchQueueHandlers(
            fakeInvocationContainer(new Map([[Handler, new Handler()]])),
            [{ token: Handler, methodName: "handle" }],
            batch,
          ),
        );
        return null;
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    expect(order).toEqual(["m-0", "m-fail"]);
  });

  it("US2/AC3: per-message result does not expose payload values", async () => {
    const delivery = makeQueueDelivery("m-ok", "m-fail");
    const batch = normalizeQueueBatch(delivery);
    const warnings: string[] = [];

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        if (msg?.messageId === "m-fail") throw new Error("secret-value-leak");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[Handler, new Handler()]])),
          [{ token: Handler, methodName: "handle" }],
          batch,
          DEGRADE_OPTIONS,
        ),
      );
    } finally {
      console.warn = originalWarn;
    }

    // Warning should not contain the error message content or payload.
    for (const w of warnings) {
      expect(w).not.toContain("secret-value-leak");
      expect(w).not.toContain("body");
      expect(w).not.toContain("token");
    }
  });

  it("US2/AC2: per-message failure records carry the invocation trace_id and messageId", async () => {
    const delivery = makeQueueDelivery("m-ok", "m-fail");
    const batch = normalizeQueueBatch(delivery);

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        if (msg?.messageId === "m-fail") throw new Error("boom");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[Handler, new Handler()]])),
          [{ token: Handler, methodName: "handle" }],
          batch,
          DEGRADE_OPTIONS,
        ),
      );
    } finally {
      console.warn = originalWarn;
    }

    // The per-message failure record names the failing message and carries the
    // invocation-wide trace_id/awsRequestId (FR-009, US2/AC2).
    const perMessage = warnings.find((w) => w.includes("message m-fail failed"));
    expect(perMessage).toBeDefined();
    expect(perMessage!).toContain("trace-id-integration-001");
    expect(perMessage!).toContain("m-fail");
    // Error class only — never the error message or payload values (FR-010).
    expect(perMessage!).toContain("Error");
    expect(perMessage!).not.toContain("boom");
  });

  it("US2/AC2: per-message failure records are emitted in degrade+DLQ mode too", async () => {
    // DLQ republishing is mocked; the per-message record must still appear
    // regardless of deadLetterQueueId (T023) and stay free of payload values.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "mock-token", expires_in: 3600 }),
    });

    const delivery = makeQueueDelivery("m-ok", "m-fail");
    const batch = normalizeQueueBatch(delivery);

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        if (msg?.messageId === "m-fail") throw new Error("boom");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[Handler, new Handler()]])),
          [{ token: Handler, methodName: "handle" }],
          batch,
          DEGRADE_WITH_DLQ,
        ),
      );
    } finally {
      console.warn = originalWarn;
    }

    const perMessage = warnings.find((w) => w.includes("message m-fail failed"));
    expect(perMessage).toBeDefined();
    expect(perMessage!).toContain("trace-id-integration-001");
    expect(perMessage!).toContain("m-fail");
    expect(perMessage!).not.toContain("boom");
    for (const w of warnings) {
      expect(w).not.toContain("body");
      expect(w).not.toContain("token");
    }
  });

  it("US3/AC1: degrade + DLQ does not log data loss warning", async () => {
    // Mock fetch for DlqSender HTTP calls
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "mock-token", expires_in: 3600 }),
    });

    const delivery = makeQueueDelivery("m-ok", "m-fail");
    const batch = normalizeQueueBatch(delivery);
    const warnings: string[] = [];

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        if (msg?.messageId === "m-fail") throw new Error("boom");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[Handler, new Handler()]])),
          [{ token: Handler, methodName: "handle" }],
          batch,
          DEGRADE_WITH_DLQ,
        ),
      );
    } finally {
      console.warn = originalWarn;
    }

    // With deadLetterQueueId configured, no data-loss warning is emitted.
    expect(warnings.some((w) => w.includes("will be lost"))).toBe(false);
  });

  it("US3/AC2-degrade-DLQ: failed DLQ republish logs warning correlated with awsRequestId/messageId and invocation still resolves", async () => {
    // IAM metadata call succeeds; every MQ DLQ send fails (HTTP 503).
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("169.254.169.254")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ access_token: "mock-token", expires_in: 3600 }),
        });
      }
      return Promise.resolve({ ok: false, status: 503 });
    });

    const delivery = makeQueueDelivery("m-ok", "m-fail");
    const batch = normalizeQueueBatch(delivery);
    const warnings: string[] = [];

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        if (msg?.messageId === "m-fail") throw new Error("boom");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[Handler, new Handler()]])),
          [{ token: Handler, methodName: "handle" }],
          batch,
          DEGRADE_WITH_DLQ,
        ),
      );
    } finally {
      console.warn = originalWarn;
    }

    // The invocation resolves successfully (transport acks the delivery) even
    // though the DLQ republish failed — fail-open, FR-011.
    const dlqWarning = warnings.find((w) => w.includes("[dlq]"));
    expect(dlqWarning).toBeDefined();
    expect(dlqWarning!).toContain("trace-id-integration-001");
    expect(dlqWarning!).toContain("message m-fail");
    expect(dlqWarning!).toContain("dlq-queue");
    expect(dlqWarning!).toContain("HTTP 503");
    // No payload / token values leak into the warning (FR-010).
    const failedEnvelope = makeMessageEnvelope("m-fail").details.message.body;
    for (const w of warnings) {
      expect(w).not.toContain("fixture");
      expect(w).not.toContain(String(failedEnvelope));
      expect(w).not.toContain("mock-token");
      expect(w).not.toContain("boom");
    }
  });

  it("US3/AC2: degrade without DLQ logs data loss warning", async () => {
    const delivery = makeQueueDelivery("m-ok", "m-fail");
    const batch = normalizeQueueBatch(delivery);
    const warnings: string[] = [];

    const Handler = class {
      async handle(): Promise<void> {
        const msg = getInvocationScopeState()?.queueMessage;
        if (msg?.messageId === "m-fail") throw new Error("boom");
      }
    };
    decorateQueueHandler(Handler.prototype, "handle");

    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[Handler, new Handler()]])),
          [{ token: Handler, methodName: "handle" }],
          batch,
          DEGRADE_OPTIONS,
        ),
      );
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.some((w) => w.includes("will be lost"))).toBe(true);
  });
});
