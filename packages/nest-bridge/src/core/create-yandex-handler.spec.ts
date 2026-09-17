import type { MockInstance } from "vitest";
import { Injectable, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { resolveInvocationExecutionContext } from "../context/invocation-scope";
import { YandexContext } from "../context/yandex-context.decorator";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { ConnectorError } from "./connector-error";
import {
  createInvocationRuntime,
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "./create-yandex-handler";
import type {
  InvocationContainer,
  TransportAdapter,
  TransportId,
  TransportInvocation,
} from "./transport";

/**
 * Lifecycle specs for the central runtime (issue #3) plus the
 * invocation-scoped execution context integration specs (issue #4). They
 * bootstrap real NestJS standalone application contexts and drive the full
 * detect -> init -> dispatch flow through the same code path the public
 * factory uses, with fixture transports standing in for the HTTP (#5) and
 * Message Queue (#7) adapters.
 *
 * Nest decorators are applied imperatively (exactly what legacy decorator
 * desugaring does) so the suite stays independent of decorator compilation
 * settings of this repository.
 */

const STRING_TOKEN = "PROBE_STRING_TOKEN";

let probeInstanceCounter = 0;

class ProbeService {
  readonly instanceId = ++probeInstanceCounter;
}
Injectable()(ProbeService);

class RootModule {}
Module({
  providers: [ProbeService, { provide: STRING_TOKEN, useValue: "string-token-value" }],
})(RootModule);

interface FixtureEvent {
  readonly kind: string;
}

interface ProbeResolution {
  readonly probeInstanceId: number;
  readonly stringTokenValue: string;
}

interface CapturingTransport extends TransportAdapter<FixtureEvent, ProbeResolution> {
  readonly invocations: TransportInvocation<FixtureEvent>[];
}

/**
 * Resolves providers from the invocation container and records every
 * invocation it served; used by the warm-reuse and isolation specs.
 */
function createResolvingTransport(id: TransportId, claimedKind: string): CapturingTransport {
  const invocations: TransportInvocation<FixtureEvent>[] = [];

  return {
    id,
    invocations,
    supports(rawEvent): rawEvent is FixtureEvent {
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        rawEvent.kind === claimedKind
      );
    },
    async invoke(invocation) {
      invocations.push(invocation);
      const [probe, stringTokenValue] = await Promise.all([
        invocation.container.resolve(ProbeService),
        invocation.container.resolve<string>(STRING_TOKEN),
      ]);
      return { probeInstanceId: probe.instanceId, stringTokenValue };
    },
  };
}

/** Returns a fixed payload without touching the container; used by routing specs. */
function createFixedTransport(
  id: TransportId,
  claimedKind: string,
  result: unknown,
): TransportAdapter<FixtureEvent, unknown> & {
  readonly invocations: TransportInvocation<FixtureEvent>[];
} {
  const invocations: TransportInvocation<FixtureEvent>[] = [];

  return {
    id,
    invocations,
    supports(rawEvent): rawEvent is FixtureEvent {
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        rawEvent.kind === claimedKind
      );
    },
    async invoke(invocation) {
      invocations.push(invocation);
      return result;
    },
  };
}

const HTTP_EVENT: FixtureEvent = Object.freeze({ kind: "api-gateway-v2", rawPath: "/probe" });
const QUEUE_EVENT: FixtureEvent = Object.freeze({
  kind: "message-queue-trigger",
  messageId: "m1",
});

/**
 * Observed-shaped runtime context fixture (DATA-ANALYSE.md section D): the
 * lifecycle specs pass it as the raw second handler argument so every
 * invocation carries a realistic platform context.
 */
function makeRuntimeContext(awsRequestId: string): Record<string, unknown> {
  return {
    awsRequestId,
    functionName: "fn-fixture",
    functionVersion: "$LATEST",
    functionFolderId: "folder-fixture",
    memoryLimitInMB: "1024",
    deadlineMs: 1787328996791,
    logGroupName: "",
  };
}

/**
 * Minimal observed-shape API Gateway v2 event (DATA-ANALYSE.md section B):
 * every field the HTTP transport (#5) validates is present with placeholder
 * values only — no captured credentials or client data.
 */
function makeObservedHttpEvent(): Record<string, unknown> {
  return {
    version: "2.0",
    rawPath: "/fixture",
    rawQueryString: "",
    headers: { Accept: "*/*", Host: "fixture.local" },
    queryStringParameters: {},
    requestContext: {
      authorizer: {},
      http: { method: "GET", path: "/fixture?", sourceIp: "203.0.113.10", userAgent: "fixture" },
      requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      time: "21/Aug/2026:16:16:30 +0000",
      timeEpoch: 1787328990,
    },
    body: "",
    isBase64Encoded: true,
    pathParameters: {},
    parameters: {},
    multiValueParameters: {},
    operationId: "41cf33042e33".padEnd(64, "0"),
  };
}

async function capturedRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the invocation to reject");
}

function expectConnectorErrorCode(error: unknown, code: string): void {
  if (!(error instanceof ConnectorError)) {
    throw new Error(`expected ConnectorError, received ${String(error)}`);
  }
  expect(error.code).toBe(code);
}

describe("core invocation runtime lifecycle", () => {
  let createSpy: MockInstance;
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  function makeRuntime(
    transports: readonly TransportAdapter[],
  ): ClosableYandexCloudFunctionHandler {
    const runtime = createInvocationRuntime(RootModule, transports);
    runtimes.push(runtime);
    return runtime;
  }

  beforeEach(() => {
    probeInstanceCounter = 0;
    // Since issue #6 the runtime bootstraps over NestFactory.create with the
    // connector's in-memory HTTP adapter (docs/ARCHITECTURE.md section 3.2).
    createSpy = vi.spyOn(NestFactory, "create");
  });

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
    createSpy.mockRestore();
  });

  it("bootstraps the Nest application exactly once across sequential warm invocations", async () => {
    const http = createResolvingTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    const first = await runtime(HTTP_EVENT, makeRuntimeContext("inv-1"));
    const second = await runtime(HTTP_EVENT, makeRuntimeContext("inv-2"));

    expect(createSpy).toHaveBeenCalledTimes(1);
    // Deep-equal resolutions imply the identical singleton probe instance was
    // resolved from the same cached container in both invocations (AGENTS.md
    // section 10.2).
    expect(second).toEqual({
      probeInstanceId: expect.any(Number),
      stringTokenValue: "string-token-value",
    });
    expect(second).toEqual(first);
  });

  it("shares a single cold start between concurrent first invocations", async () => {
    const http = createResolvingTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    // All five invocations race the cold start; the shared initialization
    // promise must yield one application instead of five duplicates
    // (AGENTS.md section 10.3).
    const resolutions = await Promise.all([
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
    ]);

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [first, ...rest] = resolutions;
    for (const resolution of rest) {
      expect(resolution).toEqual(first);
    }
  });

  it("propagates bootstrap failures to all concurrent cold invocations and retries afterwards", async () => {
    createSpy.mockRejectedValueOnce(new Error("cold-start-boom"));
    const http = createResolvingTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    const attempts = [
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
      runtime(HTTP_EVENT, makeRuntimeContext("inv-warm")),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow("cold-start-boom");
    }

    // The failed cold start is not cached as a permanent failure: the next
    // invocation retries initialization from scratch.
    expect(createSpy).toHaveBeenCalledTimes(1);
    await expect(runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"))).resolves.toBeDefined();
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it("propagates transport failures verbatim without wrapping or swallowing them", async () => {
    const handlerFailure = new Error("handler-boom");
    const failing: TransportAdapter<FixtureEvent, never> = {
      id: "http",
      supports(rawEvent): rawEvent is FixtureEvent {
        return (
          typeof rawEvent === "object" &&
          rawEvent !== null &&
          "kind" in rawEvent &&
          rawEvent.kind === "api-gateway-v2"
        );
      },
      invoke: () => Promise.reject(handlerFailure),
    };
    const runtime = makeRuntime([failing]);

    await expect(runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"))).rejects.toBe(handlerFailure);
  });

  it("routes every invocation to the transport claiming its event shape", async () => {
    const http = createResolvingTransport("http", "api-gateway-v2");
    const queue = createFixedTransport("message-queue", "message-queue-trigger", {
      acknowledged: true,
    });
    const runtime = makeRuntime([http, queue]);

    await expect(runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"))).resolves.toEqual({
      probeInstanceId: expect.any(Number),
      stringTokenValue: "string-token-value",
    });
    await expect(runtime(QUEUE_EVENT, makeRuntimeContext("inv-queue"))).resolves.toEqual({
      acknowledged: true,
    });
    await expect(runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"))).resolves.toBeDefined();

    expect(http.invocations).toHaveLength(2);
    expect(queue.invocations).toHaveLength(1);
    // Each transport received its own event, never the other's.
    expect(http.invocations[0]?.rawEvent).toBe(HTTP_EVENT);
    expect(http.invocations[1]?.rawEvent).toBe(HTTP_EVENT);
    expect(queue.invocations[0]?.rawEvent).toBe(QUEUE_EVENT);
  });

  it("hands untouched raw references to each invocation without state leaking between them", async () => {
    const http = createResolvingTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    const contextOne = makeRuntimeContext("inv-1");
    const contextTwo = makeRuntimeContext("inv-2");
    await runtime(HTTP_EVENT, contextOne);
    await runtime(HTTP_EVENT, contextTwo);

    expect(http.invocations).toHaveLength(2);
    // Raw event/context pass through verbatim, per invocation...
    expect(http.invocations[0]?.rawContext).toBe(contextOne);
    expect(http.invocations[0]?.rawEvent).toBe(HTTP_EVENT);
    // ...and nothing from invocation N survives into invocation N+1
    // (AGENTS.md section 11).
    expect(http.invocations[1]?.rawContext).toBe(contextTwo);
    expect(http.invocations[1]).not.toBe(http.invocations[0]);
    expect(http.invocations[1]?.container).not.toBe(http.invocations[0]?.container);
  });

  it("rejects events no transport claims before spending any cold-start effort", async () => {
    const http = createResolvingTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    const failure = await capturedRejection(runtime({ unrecognized: true }, {}));
    expectConnectorErrorCode(failure, "UNKNOWN_INVOCATION_EVENT");

    // Detection precedes initialization: garbage traffic never pays for a
    // Nest bootstrap.
    expect(createSpy).not.toHaveBeenCalled();
  });

  describe("close()", () => {
    it("releases the cached application so the next invocation performs a fresh cold start", async () => {
      const http = createResolvingTransport("http", "api-gateway-v2");
      const runtime = makeRuntime([http]);

      const warm = await runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"));
      await runtime.close();

      // A fresh application yields a new probe singleton, so the resolution
      // differs from the pre-close warm value.
      const afterClose = await runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"));
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(afterClose).not.toEqual(warm);
    });

    it("performs no bootstrap when closed before any invocation", async () => {
      const http = createResolvingTransport("http", "api-gateway-v2");
      const runtime = makeRuntime([http]);

      await expect(runtime.close()).resolves.toBeUndefined();

      expect(createSpy).not.toHaveBeenCalled();
    });

    it("is idempotent after releasing the application", async () => {
      const http = createResolvingTransport("http", "api-gateway-v2");
      const runtime = makeRuntime([http]);

      await runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"));
      await runtime.close();

      await expect(runtime.close()).resolves.toBeUndefined();
      await expect(runtime.close()).resolves.toBeUndefined();
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it("awaits an in-flight initialization before releasing the application", async () => {
      // A fixed-payload transport keeps the gated invocation independent of
      // the stub application's (absent) container.
      const http = createFixedTransport("http", "api-gateway-v2", { handled: true });
      const runtime = makeRuntime([http]);

      let releaseGate!: (application: INestApplication) => void;
      const gate = new Promise<INestApplication>((resolveGate) => {
        releaseGate = resolveGate;
      });
      createSpy.mockImplementationOnce(() => gate);

      // Only close()/initialization are exercised on this gated path; a stub
      // keeps the test independent of real bootstrap timing. The core chains
      // `init()` after create, so the stub exposes it as a no-op; spec 003
      // added global-guard wiring between create and init, which the stub
      // satisfies with no-op get/useGlobalGuards.
      const stubClose = vi.fn(() => Promise.resolve());
      const stubApplication = {
        init: () => Promise.resolve(stubApplication),
        close: stubClose,
        get: () => ({ canActivate: () => true }),
        useGlobalGuards: () => stubApplication,
        resolve: () => Promise.reject(new Error("stub application resolves nothing")),
      } as unknown as INestApplication;

      const inFlightInvocation = runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"));
      const closing = runtime.close();
      releaseGate(stubApplication);

      // The invocation completes on the gated initialization, then close()
      // releases exactly that application.
      await expect(inFlightInvocation).resolves.toBeDefined();
      await closing;
      expect(stubClose).toHaveBeenCalledTimes(1);

      // The released environment cold-starts again on demand.
      await runtime(HTTP_EVENT, makeRuntimeContext("inv-warm"));
      expect(createSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("createYandexHandler public entry point", () => {
    it("wires the built-in transport registry behind the stable handler signature", async () => {
      const handler = createYandexHandler(RootModule);
      runtimes.push(handler);

      // The built-in registry ships with the HTTP / API Gateway adapter
      // (issue #5); Message Queue follows with issue #7. An event no
      // transport claims must still fail clearly instead of being guessed
      // as one of the known kinds (AGENTS.md section 8.3).
      const failure = await capturedRejection(
        handler(HTTP_EVENT, makeRuntimeContext("inv-public")),
      );
      expectConnectorErrorCode(failure, "UNKNOWN_INVOCATION_EVENT");
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("routes a realistic API Gateway v2 event through the full public lifecycle", async () => {
      const handler = createYandexHandler(RootModule);
      runtimes.push(handler);

      const result = await handler(makeObservedHttpEvent(), makeRuntimeContext("inv-public-http"));

      // RootModule registers no controllers, so the dispatched request lands
      // at the deterministic not-found layer (issue #6): a wire-valid,
      // platform-shaped 404 envelope instead of an arbitrary payload.
      expect(result).toEqual({
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Cannot GET /fixture",
          error: "Not Found",
          statusCode: 404,
          trace_id: "inv-public-http",
        }),
        isBase64Encoded: false,
      });
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Integration specs for the normalized execution context (issue #4): they
 * drive `@YandexContext()` injection end-to-end through both fixture
 * transports exactly the way the real adapters (#5, #7/#8) will dispatch —
 * resolve the provider from the invocation container, discover decorated
 * parameters, then call the method with the context resolved from the
 * invocation scope.
 */

class ContextCapturingHandler {
  readonly captured: YandexExecutionContext[] = [];

  capture(executionContext: YandexExecutionContext): YandexExecutionContext {
    this.captured.push(executionContext);
    return executionContext;
  }
}
Injectable()(ContextCapturingHandler);
YandexContext()(ContextCapturingHandler.prototype, "capture", 0);

class ContextModule {}
Module({ providers: [ContextCapturingHandler] })(ContextModule);

/** Transport-agnostic dispatch: fills @YandexContext() parameters from scope. */
function invokeCapturingHandler(container: InvocationContainer): Promise<YandexExecutionContext> {
  return container
    .resolve(ContextCapturingHandler)
    .then((capturer) => capturer.capture(resolveInvocationExecutionContext()));
}

/** Fixture transport whose dispatch honors @YandexContext() like the real adapters. */
function createContextTransport(id: TransportId, claimedKind: string): TransportAdapter {
  return {
    id,
    supports(rawEvent): rawEvent is FixtureEvent {
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        (rawEvent as FixtureEvent).kind === claimedKind
      );
    },
    invoke(invocation) {
      return invokeCapturingHandler(invocation.container);
    },
  };
}

const HTTP_RUNTIME_CONTEXT = {
  awsRequestId: "11111111-2222-4333-8444-555555555555",
  functionName: "fn-http-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

const QUEUE_RUNTIME_CONTEXT = {
  ...HTTP_RUNTIME_CONTEXT,
  awsRequestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};

describe("invocation-scoped execution context integration", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  function makeRuntime(
    transports: readonly TransportAdapter[],
  ): ClosableYandexCloudFunctionHandler {
    const runtime = createInvocationRuntime(ContextModule, transports);
    runtimes.push(runtime);
    return runtime;
  }

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  it("injects the normalized context through both the HTTP and Message Queue paths", async () => {
    const http = createContextTransport("http", "api-gateway-v2");
    const queue = createContextTransport("message-queue", "message-queue-trigger");
    const runtime = makeRuntime([http, queue]);

    const viaHttp = (await runtime(HTTP_EVENT, HTTP_RUNTIME_CONTEXT)) as YandexExecutionContext;
    const viaQueue = (await runtime(QUEUE_EVENT, QUEUE_RUNTIME_CONTEXT)) as YandexExecutionContext;

    // Identical abstraction on both paths; each invocation carries its own
    // correlation id (acceptance criteria of issue #4).
    expect(viaHttp.awsRequestId).toBe("11111111-2222-4333-8444-555555555555");
    expect(viaHttp.memoryLimitInMB).toBe("1024");
    expect(viaQueue.awsRequestId).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(viaQueue).not.toBe(viaHttp);
  });

  it("hands transports and user code one shared normalized context per invocation", async () => {
    let seenInvocation: TransportInvocation | undefined;
    const observing: TransportAdapter = {
      id: "http",
      supports(rawEvent): rawEvent is FixtureEvent {
        return (
          typeof rawEvent === "object" &&
          rawEvent !== null &&
          "kind" in rawEvent &&
          (rawEvent as FixtureEvent).kind === "api-gateway-v2"
        );
      },
      invoke(invocation) {
        seenInvocation = invocation;
        return invokeCapturingHandler(invocation.container);
      },
    };
    const runtime = makeRuntime([observing]);

    const rawEvent = { kind: "api-gateway-v2" };
    const injected = (await runtime(rawEvent, HTTP_RUNTIME_CONTEXT)) as YandexExecutionContext;

    // Built once by the core from the untouched pair...
    expect(seenInvocation?.executionContext).toBe(injected);
    expect(injected.rawEvent).toBe(rawEvent);
    expect(injected.raw).toBe(HTTP_RUNTIME_CONTEXT);
    // ...and resolved as the exact same instance for user code.
    expect(seenInvocation).toBeDefined();
  });

  it("leaks nothing of invocation N into invocation N+1", async () => {
    const http = createContextTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    const first = (await runtime(HTTP_EVENT, HTTP_RUNTIME_CONTEXT)) as YandexExecutionContext;
    const second = (await runtime(HTTP_EVENT, QUEUE_RUNTIME_CONTEXT)) as YandexExecutionContext;

    // Sequential warm invocations must observe strictly their own context
    // (AGENTS.md section 11).
    expect(first.awsRequestId).toBe("11111111-2222-4333-8444-555555555555");
    expect(second.awsRequestId).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(second).not.toBe(first);
  });

  it("isolates concurrent invocations racing the same cold start", async () => {
    const http = createContextTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    const results = (await Promise.all([
      runtime(HTTP_EVENT, { ...HTTP_RUNTIME_CONTEXT, awsRequestId: "concurrent-1" }),
      runtime(HTTP_EVENT, { ...HTTP_RUNTIME_CONTEXT, awsRequestId: "concurrent-2" }),
      runtime(HTTP_EVENT, { ...HTTP_RUNTIME_CONTEXT, awsRequestId: "concurrent-3" }),
    ])) as YandexExecutionContext[];

    expect(results.map((context) => context.awsRequestId).sort()).toEqual([
      "concurrent-1",
      "concurrent-2",
      "concurrent-3",
    ]);
  });

  it("fails an invocation loudly when the runtime context violates its observed shape", async () => {
    const http = createContextTransport("http", "api-gateway-v2");
    const runtime = makeRuntime([http]);

    // memoryLimitInMB must stay a string (observed); a numeric value must
    // fail value-free instead of flowing a coerced type into user code
    // (AGENTS.md section 5).
    const malformed = { ...HTTP_RUNTIME_CONTEXT, memoryLimitInMB: 1024 };
    const failure = await capturedRejection(runtime(HTTP_EVENT, malformed));

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('expected field "memoryLimitInMB" to be a string');
    expect((failure as Error).message).not.toContain("1024");
  });
});
