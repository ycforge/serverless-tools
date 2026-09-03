import type { INestApplication } from "@nestjs/common";
import { buildYandexExecutionContext } from "../context/build-yandex-execution-context";
import {
  getInvocationScopeState,
  resolveInvocationExecutionContext,
  resolveInvocationQueueBatch,
  resolveInvocationQueueMessage,
  runInInvocationScope,
} from "../context/invocation-scope";
import { YandexContext } from "../context/yandex-context.decorator";
import type { InvocationResolutionContext } from "../core/transport";
import { discoverQueueHandlers, dispatchQueueHandlers } from "./dispatch";
import { normalizeQueueBatch } from "./normalize-batch";
import { QueueHandler } from "./queue-handler.decorator";
import { QueueMessage } from "./queue-message.decorator";
import type { RawQueueEvent, RawQueueMessageEvent } from "./raw-event";

/**
 * Unit specs for Message Queue handler discovery and dispatch (issue #8).
 *
 * Discovery runs against structural fakes of the @nestjs/core container
 * internals (verified against @nestjs/core 11, see src/mq/dispatch.ts), so
 * traversal rules can be pinned without bootstrapping Nest. Dispatch specs
 * run through the real invocation-scope machinery because per-message
 * isolation IS part of the contract.
 *
 * Fixtures mirror the sanitized captured trigger shape (DATA-ANALYSE.md
 * section C) — placeholder ids only, no captured credentials or payload data.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";
const EVENT_ID = "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8";

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-mq-dispatch-spec",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

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

function methodDescriptorOf(
  target: object,
  propertyKey: string | symbol,
): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${String(propertyKey)}`);
  }
  return descriptor;
}

/** Marks `propertyKey` on `target` as a queue handler, imperatively. */
function decorateQueueHandler(target: object, propertyKey: string | symbol): void {
  QueueHandler()(target, propertyKey, methodDescriptorOf(target, propertyKey));
}

interface FakeModuleInternals {
  readonly controllers?: ReadonlyMap<
    unknown,
    { token?: unknown; metatype?: unknown; instance?: unknown }
  >;
  readonly providers?: ReadonlyMap<
    unknown,
    { token?: unknown; metatype?: unknown; instance?: unknown }
  >;
}

/**
 * Structural fake of the warm application: only the container path discovery
 * reads exists, mirroring what `NestFactory.create(...).init()` exposes
 * through the proxied app object (plain property reads only).
 */
function fakeApplication(modules: FakeModuleInternals[]): INestApplication {
  return {
    container: {
      getModules: () => ({ values: () => modules.values() }),
    },
  } as unknown as INestApplication;
}

function providerWrapper(
  token: abstract new () => object,
  instance?: object,
): { token?: unknown; metatype?: unknown; instance?: unknown } {
  return {
    token,
    metatype: token,
    instance: instance ?? Object.create(token.prototype),
  };
}

/** Per-invocation container seam fake resolving pre-registered instances. */
function fakeInvocationContainer(instances: ReadonlyMap<unknown, object>): {
  resolve<T>(token: unknown, resolutionContext?: InvocationResolutionContext): Promise<T>;
} {
  return {
    async resolve<T>(token: unknown, resolutionContext?: InvocationResolutionContext): Promise<T> {
      void resolutionContext;
      const instance = instances.get(token);
      if (!instance) {
        throw new Error(`no instance registered for token ${String(token)}`);
      }
      // Spec-local narrowing: fixtures register exactly the instances the
      // dispatched handlers expect.
      return instance as T;
    },
  };
}

interface RecordedResolution {
  messageIdDuringResolve?: string;
  contextId?: { readonly id: number };
}

/**
 * Container fake recording every resolution together with the invocation
 * scope state observed WHILE resolving — proving resolution happens inside
 * the per-message scope extension and under one shared DI sub-tree id.
 */
function recordingInvocationContainer(instances: ReadonlyMap<unknown, object>): {
  resolve<T>(token: unknown, resolutionContext?: InvocationResolutionContext): Promise<T>;
  readonly resolutions: RecordedResolution[];
} {
  const resolutions: RecordedResolution[] = [];
  return {
    resolutions,
    async resolve<T>(token: unknown, resolutionContext?: InvocationResolutionContext): Promise<T> {
      const instance = instances.get(token);
      if (!instance) {
        throw new Error(`no instance registered for token ${String(token)}`);
      }
      resolutions.push({
        messageIdDuringResolve: getInvocationScopeState()?.queueMessage?.messageId,
        contextId: resolutionContext?.contextId,
      });
      // Spec-local narrowing: fixtures register exactly the instances the
      // dispatched handlers expect.
      return instance as T;
    },
  };
}

async function capturedRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to reject");
}

describe("queue handler discovery", () => {
  it("discovers handlers on controllers before providers within one module", () => {
    const ControllerToken = class {
      handle(): void {}
    };
    decorateQueueHandler(ControllerToken.prototype, "handle");
    const ServiceToken = class {
      handle(): void {}
    };
    decorateQueueHandler(ServiceToken.prototype, "handle");

    const handlers = discoverQueueHandlers(
      fakeApplication([
        {
          controllers: new Map([[ControllerToken, providerWrapper(ControllerToken)]]),
          providers: new Map([[ServiceToken, providerWrapper(ServiceToken)]]),
        },
      ]),
    );

    // Controllers lead the fan-out order: they mirror how Nest treats
    // controllers as an application's primary consumers.
    expect(handlers.map((handler) => handler.token)).toEqual([ControllerToken, ServiceToken]);
    expect(handlers.every((handler) => handler.methodName === "handle")).toBe(true);
  });

  it("walks modules in insertion order so earlier modules fan out first", () => {
    const FirstToken = class {
      handle(): void {}
    };
    decorateQueueHandler(FirstToken.prototype, "handle");
    const SecondToken = class {
      handle(): void {}
    };
    decorateQueueHandler(SecondToken.prototype, "handle");

    const handlers = discoverQueueHandlers(
      fakeApplication([
        { providers: new Map([[FirstToken, providerWrapper(FirstToken)]]) },
        { providers: new Map([[SecondToken, providerWrapper(SecondToken)]]) },
      ]),
    );

    expect(handlers.map((handler) => handler.token)).toEqual([FirstToken, SecondToken]);
  });

  it("dedupes shared providers surfaced under several module contexts", () => {
    const SharedService = class {
      handle(): void {}
    };
    decorateQueueHandler(SharedService.prototype, "handle");
    const wrapper = providerWrapper(SharedService);

    // Re-exported/shared providers appear once per importing module; each
    // surface must not multiply the handler registration.
    const handlers = discoverQueueHandlers(
      fakeApplication([
        { providers: new Map([[SharedService, wrapper]]) },
        { providers: new Map([[SharedService, wrapper]]) },
      ]),
    );

    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toMatchObject({ token: SharedService, methodName: "handle" });
  });

  it("falls back to token identity for owners without a metatype", () => {
    // Value/factory providers carry no class prototype: their decorated
    // instance objects are the only discovery target, and the injection
    // token is the only stable owner identity across module surfaces.
    const decoratedInstance = {
      handle(): void {},
    };
    decorateQueueHandler(decoratedInstance, "handle");

    const handlers = discoverQueueHandlers(
      fakeApplication([
        {
          providers: new Map([
            ["value-token", { token: "value-token", instance: decoratedInstance }],
          ]),
        },
        {
          providers: new Map([
            ["value-token", { token: "value-token", instance: decoratedInstance }],
          ]),
        },
      ]),
    );

    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.token).toBe("value-token");
  });

  it("caches discovery per application and rescans fresh applications", () => {
    const CachedToken = class {
      handle(): void {}
    };
    decorateQueueHandler(CachedToken.prototype, "handle");
    const LateToken = class {
      handle(): void {}
    };
    decorateQueueHandler(LateToken.prototype, "handle");

    const modules: FakeModuleInternals[] = [
      { providers: new Map([[CachedToken, providerWrapper(CachedToken)]]) },
    ];
    const application = fakeApplication(modules);

    const first = discoverQueueHandlers(application);
    const second = discoverQueueHandlers(application);
    expect(second).toBe(first);

    // Registrations are static code structure: later container growth must
    // not change an already-scanned application (mirrors route recording).
    modules.push({ providers: new Map([[LateToken, providerWrapper(LateToken)]]) });
    expect(discoverQueueHandlers(application)).toEqual(first);

    const freshApplication = fakeApplication([
      { providers: new Map([[LateToken, providerWrapper(LateToken)]]) },
    ]);
    expect(discoverQueueHandlers(freshApplication).map((handler) => handler.token)).toEqual([
      LateToken,
    ]);
  });

  it("fails loudly when the application container is inaccessible", () => {
    // Impossible while the connector owns the bootstrap, so this guards
    // against silent handler-less behavior rather than a supported shape.
    expect(() => discoverQueueHandlers({} as INestApplication)).toThrow(
      /could not access the NestJS application container/,
    );
  });
});

describe("queue handler dispatch", () => {
  function makeDispatchContext(rawEvent: RawQueueEvent) {
    return buildYandexExecutionContext(rawEvent, RUNTIME_CONTEXT);
  }

  it("rejects deliveries when no queue handler is registered", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);

    const failure = (await capturedRejection(
      runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(fakeInvocationContainer(new Map()), [], batch),
      ),
    )) as { code?: string; transportId?: string };

    // A valid delivery nobody consumes is its own boundary condition: fail
    // loudly so MQ retry/dead-letter configuration sees it (AGENTS.md 8.2).
    expect(failure.code).toBe("NO_QUEUE_HANDLER");
    expect(failure.transportId).toBe("message-queue");
  });

  it("invokes every discovered handler once per message in discovery order", async () => {
    const delivery = makeQueueDelivery("m-first", "m-second");
    const batch = normalizeQueueBatch(delivery);

    const callLog: string[] = [];
    const First = class {
      handle(): void {
        callLog.push(`first:${getInvocationScopeState()?.queueMessage?.messageId}`);
      }
    };
    decorateQueueHandler(First.prototype, "handle");
    const Second = class {
      handle(): void {
        callLog.push(`second:${getInvocationScopeState()?.queueMessage?.messageId}`);
      }
    };
    decorateQueueHandler(Second.prototype, "handle");

    // Fan-out: EVERY handler receives EVERY message, and all handlers for
    // message N complete before message N+1 starts (sequential batch order).
    await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
      dispatchQueueHandlers(
        fakeInvocationContainer(
          new Map<unknown, object>([
            [First, new First()],
            [Second, new Second()],
          ]),
        ),
        [
          { token: First, methodName: "handle" },
          { token: Second, methodName: "handle" },
        ],
        batch,
      ),
    );

    expect(callLog).toEqual([
      "first:m-first",
      "second:m-first",
      "first:m-second",
      "second:m-second",
    ]);
  });

  it("fills @QueueMessage() and @YandexContext() positions with scoped values", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);
    const executionContext = makeDispatchContext(delivery);

    const receivedParameters: unknown[][] = [];
    const Probe = class {
      handle(...parameters: unknown[]): void {
        receivedParameters.push(parameters);
      }
    };
    QueueMessage()(Probe.prototype, "handle", 0);
    YandexContext()(Probe.prototype, "handle", 1);

    await runInInvocationScope({ executionContext }, () =>
      dispatchQueueHandlers(
        fakeInvocationContainer(new Map([[Probe, new Probe()]])),
        [{ token: Probe, methodName: "handle" }],
        batch,
      ),
    );

    expect(receivedParameters).toEqual([[batch.messages[0], executionContext]]);
  });

  it("keeps undecorated parameters undefined and pads up to the highest decorated index", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);

    const receivedParameters: unknown[][] = [];
    const Probe = class {
      handle(...parameters: unknown[]): void {
        receivedParameters.push(parameters);
      }
    };
    // Only position 2 wants anything: sparse decoration must not shift or
    // drop other positions, and undecorated ones stay explicitly undefined.
    QueueMessage()(Probe.prototype, "handle", 2);

    await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
      dispatchQueueHandlers(
        fakeInvocationContainer(new Map([[Probe, new Probe()]])),
        [{ token: Probe, methodName: "handle" }],
        batch,
      ),
    );

    const parameters = receivedParameters[0]!;
    expect(parameters).toHaveLength(3);
    expect(parameters[0]).toBeUndefined();
    expect(parameters[1]).toBeUndefined();
    expect(parameters[2]).toBe(batch.messages[0]);
  });

  it("prefers the execution context when both decorators share one parameter", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);
    const executionContext = makeDispatchContext(delivery);

    const receivedParameters: unknown[][] = [];
    const Probe = class {
      handle(...parameters: unknown[]): void {
        receivedParameters.push(parameters);
      }
    };
    QueueMessage()(Probe.prototype, "handle", 0);
    YandexContext()(Probe.prototype, "handle", 0);

    await runInInvocationScope({ executionContext }, () =>
      dispatchQueueHandlers(
        fakeInvocationContainer(new Map([[Probe, new Probe()]])),
        [{ token: Probe, methodName: "handle" }],
        batch,
      ),
    );

    // Documented precedence: the context wins on a shared position so a
    // mis-decorated signature degrades deterministically, not randomly.
    expect(receivedParameters[0]).toEqual([executionContext]);
  });

  it("publishes exactly the current message inside the invocation scope during dispatch", async () => {
    const delivery = makeQueueDelivery("m-one", "m-two");
    const batch = normalizeQueueBatch(delivery);
    const executionContext = makeDispatchContext(delivery);

    interface ObservedRound {
      messageId?: string;
      batchIdentity?: unknown;
      awsRequestId?: string;
    }
    const observedRounds: ObservedRound[] = [];

    const ScopeProbe = class {
      async handle(): Promise<void> {
        const message = resolveInvocationQueueMessage();
        observedRounds.push({
          messageId: message.messageId,
          batchIdentity: resolveInvocationQueueBatch(),
          awsRequestId: resolveInvocationExecutionContext().awsRequestId,
        });
      }
    };
    decorateQueueHandler(ScopeProbe.prototype, "handle");

    await runInInvocationScope({ executionContext, queueBatch: batch }, () =>
      dispatchQueueHandlers(
        fakeInvocationContainer(new Map([[ScopeProbe, new ScopeProbe()]])),
        [{ token: ScopeProbe, methodName: "handle" }],
        batch,
      ),
    );

    // Each round observes its own message plus the invocation-wide batch and
    // context; the batch identity never changes across rounds.
    expect(observedRounds.map((round) => round.messageId)).toEqual(["m-one", "m-two"]);
    expect(observedRounds[0]?.batchIdentity).toBe(batch);
    expect(observedRounds[1]?.batchIdentity).toBe(batch);
    expect(observedRounds[1]?.awsRequestId).toBe(executionContext.awsRequestId);
  });

  it("ends the per-message scope when dispatch completes", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);

    const Probe = class {
      async handle(): Promise<void> {
        void resolveInvocationQueueMessage();
      }
    };
    decorateQueueHandler(Probe.prototype, "handle");

    await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, async () => {
      await dispatchQueueHandlers(
        fakeInvocationContainer(new Map([[Probe, new Probe()]])),
        [{ token: Probe, methodName: "handle" }],
        batch,
      );

      // Between and after handler rounds nothing may read a stale message;
      // resolution fails loudly instead (AGENTS.md section 11).
      expect(() => resolveInvocationQueueMessage()).toThrow(/no Message Queue message/);
      expect(getInvocationScopeState()?.queueMessage).toBeUndefined();
    });
  });

  it("resolves every handler once per message under one shared DI sub-tree id", async () => {
    const delivery = makeQueueDelivery("m-one", "m-two");
    const batch = normalizeQueueBatch(delivery);

    const First = class {
      handle(): void {}
    };
    decorateQueueHandler(First.prototype, "handle");
    const Second = class {
      handle(): void {}
    };
    decorateQueueHandler(Second.prototype, "handle");

    const container = recordingInvocationContainer(
      new Map<unknown, object>([
        [First, new First()],
        [Second, new Second()],
      ]),
    );

    await runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
      dispatchQueueHandlers(
        container,
        [
          { token: First, methodName: "handle" },
          { token: Second, methodName: "handle" },
        ],
        batch,
      ),
    );

    // One resolution per handler per message — never one per invocation.
    expect(container.resolutions).toHaveLength(4);
    // Resolution ran INSIDE each message's scope extension: the resolving
    // call observes exactly that message (AGENTS.md section 11).
    expect(container.resolutions.map((entry) => entry.messageIdDuringResolve)).toEqual([
      "m-one",
      "m-one",
      "m-two",
      "m-two",
    ]);
    // Both handlers of one message resolve under the SAME DI sub-tree id...
    const firstRoundContextId = container.resolutions[0]?.contextId;
    expect(firstRoundContextId).toBeDefined();
    expect(container.resolutions[1]?.contextId).toBe(firstRoundContextId);
    // ...and every new message gets its own sub-tree.
    const secondRoundContextId = container.resolutions[2]?.contextId;
    expect(secondRoundContextId).toBeDefined();
    expect(secondRoundContextId).not.toBe(firstRoundContextId);
    expect(container.resolutions[3]?.contextId).toBe(secondRoundContextId);
  });

  it("stops processing when a resolution fails mid-batch and propagates the original failure", async () => {
    const delivery = makeQueueDelivery("m-ok", "m-doomed", "m-never");
    const batch = normalizeQueueBatch(delivery);
    const doomedError = new Error("provider factory exploded");

    const handledBy: string[] = [];
    const Reliable = class {
      handle(): void {
        handledBy.push(`reliable:${getInvocationScopeState()?.queueMessage?.messageId}`);
      }
    };
    decorateQueueHandler(Reliable.prototype, "handle");
    const ExplodingResolution = class {
      handle(): void {
        handledBy.push(`exploding:${getInvocationScopeState()?.queueMessage?.messageId}`);
      }
    };
    decorateQueueHandler(ExplodingResolution.prototype, "handle");

    let resolutionCount = 0;
    const failure = await capturedRejection(
      runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          {
            async resolve<T>(token: unknown): Promise<T> {
              if (token === Reliable) {
                return Object.create(Reliable.prototype) as T;
              }
              resolutionCount += 1;
              if (resolutionCount === 2) {
                throw doomedError;
              }
              return Object.create(ExplodingResolution.prototype) as T;
            },
          },
          [
            { token: Reliable, methodName: "handle" },
            { token: ExplodingResolution, methodName: "handle" },
          ],
          batch,
        ),
      ),
    );

    // The original factory error surfaces unwrapped; m-ok completed fully,
    // m-doomed aborted at its failing resolution before any handler ran, and
    // m-never was never attempted.
    expect(failure).toBe(doomedError);
    expect(handledBy).toEqual(["reliable:m-ok", "exploding:m-ok"]);
  });

  it("stops the delivery at the first failing handler and propagates the original failure", async () => {
    const delivery = makeQueueDelivery("m-ok", "m-doomed", "m-never");
    const batch = normalizeQueueBatch(delivery);
    const doomedError = new Error("handler exploded on m-doomed");

    const handledBy: string[] = [];
    const Reliable = class {
      handle(): void {
        handledBy.push(`reliable:${getInvocationScopeState()?.queueMessage?.messageId}`);
      }
    };
    decorateQueueHandler(Reliable.prototype, "handle");

    const Failing = class {
      async handle(): Promise<void> {
        const messageId = getInvocationScopeState()?.queueMessage?.messageId;
        handledBy.push(`failing:${messageId}`);
        if (messageId === "m-doomed") {
          throw doomedError;
        }
      }
    };
    decorateQueueHandler(Failing.prototype, "handle");

    const failure = await capturedRejection(
      runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(
            new Map<unknown, object>([
              [Reliable, new Reliable()],
              [Failing, new Failing()],
            ]),
          ),
          [
            { token: Reliable, methodName: "handle" },
            { token: Failing, methodName: "handle" },
          ],
          batch,
        ),
      ),
    );

    // The original error surfaces unwrapped so retry/DLQ semantics see the
    // real cause, and messages after the failing one are never attempted.
    expect(failure).toBe(doomedError);
    expect(handledBy).toEqual([
      "reliable:m-ok",
      "failing:m-ok",
      "reliable:m-doomed",
      "failing:m-doomed",
    ]);
  });

  it("propagates failures from handler resolution itself", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);

    const UnresolvableToken = class {
      handle(): void {}
    };
    decorateQueueHandler(UnresolvableToken.prototype, "handle");
    let handlerWasCalled = false;
    const NeverCalled = class {
      handle(): void {
        handlerWasCalled = true;
      }
    };
    decorateQueueHandler(NeverCalled.prototype, "handle");

    const failure = await capturedRejection(
      runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map()),
          [
            { token: UnresolvableToken, methodName: "handle" },
            { token: NeverCalled, methodName: "handle" },
          ],
          batch,
        ),
      ),
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("no instance registered for token");
    expect(handlerWasCalled).toBe(false);
  });

  it("ignores handler return values while keeping successful dispatch resolving", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);

    const ValueReturning = class {
      async handle(): Promise<string> {
        return "ignored-by-design";
      }
    };
    decorateQueueHandler(ValueReturning.prototype, "handle");

    // The queue transport has no response envelope: handler results are not
    // collected, transformed, or turned into any HTTP-like payload.
    await expect(
      runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[ValueReturning, new ValueReturning()]])),
          [{ token: ValueReturning, methodName: "handle" }],
          batch,
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("fails when the resolved provider lost its handler method", async () => {
    const delivery = makeQueueDelivery();
    const batch = normalizeQueueBatch(delivery);

    const MutatedToken = class {
      handle(): void {}
    };
    decorateQueueHandler(MutatedToken.prototype, "handle");

    const failure = await capturedRejection(
      runInInvocationScope({ executionContext: makeDispatchContext(delivery) }, () =>
        // Instance whose prototype chain no longer exposes "handle" (e.g. a
        // value/factory provider replaced after discovery ran).
        dispatchQueueHandlers(
          fakeInvocationContainer(new Map([[MutatedToken, {}]])),
          [{ token: MutatedToken, methodName: "handle" }],
          batch,
        ),
      ),
    );

    expect((failure as Error).message).toContain("is no longer a function");
  });
});
