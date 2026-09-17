import type { MockInstance } from "vitest";
import { Module } from "@nestjs/common";
import { ConnectorError } from "../core/connector-error";
import {
  createInvocationRuntime,
  type ClosableYandexCloudFunctionHandler,
} from "../core/create-yandex-handler";
import { NestFactory } from "@nestjs/core";
import { httpApiGatewayV2Transport } from "./adapter";
import type { RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Specs for the API Gateway v2 HTTP transport adapter itself (issue #5):
 * the cheap detection predicate, the deep value-free validation behind
 * `INVALID_INVOCATION_EVENT`, and the dispatch behavior visible at the
 * runtime boundary while response mapping still belongs to issue #6.
 *
 * Fixtures mirror the observed payload structure (DATA-ANALYSE.md section B)
 * with placeholder values only.
 */

class RootModule {}
Module({})(RootModule);

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-http-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

function makeHttpEvent(overrides: Record<string, unknown> = {}): RawHttpApiGatewayV2Event {
  return {
    version: "2.0",
    rawPath: "/test/simple",
    rawQueryString: "",
    headers: { Accept: "*/*", Host: "functions.yandexcloud.net" },
    queryStringParameters: {},
    requestContext: {
      authorizer: {},
      http: {
        method: "GET",
        path: "/test/simple?",
        sourceIp: "203.0.113.10",
        userAgent: "fixture-agent/1.0",
      },
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
    ...overrides,
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

function expectInvalidInvocationEvent(error: unknown): ConnectorError {
  if (!(error instanceof ConnectorError)) {
    throw new Error(`expected ConnectorError, received ${String(error)}`);
  }
  expect(error.code).toBe("INVALID_INVOCATION_EVENT");
  expect(error.transportId).toBe("http");
  return error;
}

describe("http api gateway v2 transport supports()", () => {
  it("claims observed-shape API Gateway v2 events via the version discriminator plus canonical fields", () => {
    expect(httpApiGatewayV2Transport.supports(makeHttpEvent())).toBe(true);
    // Minimal claimable shape: only what detection needs before deeper
    // validation runs inside invoke() (docs/ARCHITECTURE.md section 4).
    expect(
      httpApiGatewayV2Transport.supports({ version: "2.0", rawPath: "/", rawQueryString: "" }),
    ).toBe(true);
  });

  it("rejects payloads without the observed v2 discriminator or canonical fields", () => {
    expect(httpApiGatewayV2Transport.supports(null)).toBe(false);
    expect(httpApiGatewayV2Transport.supports(undefined)).toBe(false);
    expect(httpApiGatewayV2Transport.supports("version=2.0")).toBe(false);
    expect(httpApiGatewayV2Transport.supports(42)).toBe(false);
    expect(httpApiGatewayV2Transport.supports([])).toBe(false);
    expect(httpApiGatewayV2Transport.supports({})).toBe(false);
    // Wrong format versions are never silently treated as HTTP.
    expect(
      httpApiGatewayV2Transport.supports({ version: "1.0", rawPath: "/", rawQueryString: "" }),
    ).toBe(false);
    expect(
      httpApiGatewayV2Transport.supports({ version: 2, rawPath: "/", rawQueryString: "" }),
    ).toBe(false);
    // Missing canonical fields keep half-shaped objects unclaimed.
    expect(httpApiGatewayV2Transport.supports({ version: "2.0" })).toBe(false);
    expect(httpApiGatewayV2Transport.supports({ version: "2.0", rawQueryString: "" })).toBe(false);
    expect(
      httpApiGatewayV2Transport.supports({ version: "2.0", rawPath: "/", rawQueryString: 0 }),
    ).toBe(false);
  });

  it("never claims Message Queue trigger deliveries", () => {
    const queueDelivery = {
      messages: [
        {
          event_metadata: {},
          details: { queue_id: "yrn:yc:ymq", message: { message_id: "m-fixture", body: "" } },
        },
      ],
    };

    expect(httpApiGatewayV2Transport.supports(queueDelivery)).toBe(false);
  });
});

describe("http api gateway v2 transport validation", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  function makeRuntime(): ClosableYandexCloudFunctionHandler {
    const runtime = createInvocationRuntime(RootModule, [httpApiGatewayV2Transport]);
    runtimes.push(runtime);
    return runtime;
  }

  it.each([
    ["headers missing", { headers: undefined }, 'expected field "headers" to be an object'],
    [
      "header value is not a string",
      { headers: { Authorization: 12345 } },
      'expected every value of field "headers" to be a string',
    ],
    [
      "queryStringParameters is an array",
      { queryStringParameters: [] },
      'expected field "queryStringParameters" to be an object',
    ],
    [
      "multiValueParameters value is not an array",
      { multiValueParameters: { q: "one" } },
      'expected every value of field "multiValueParameters" to be a string array',
    ],
    ["body is not a string", { body: null }, 'expected field "body" to be a string'],
    [
      "isBase64Encoded is a string flag",
      { isBase64Encoded: "true" },
      'expected field "isBase64Encoded" to be a boolean',
    ],
    [
      "requestContext.http.method is missing",
      { requestContext: { authorizer: {}, http: {}, requestId: "r", time: "t", timeEpoch: 1 } },
      'expected field "requestContext.http.method" to be a string',
    ],
    [
      "operationId is missing",
      { operationId: undefined },
      'expected field "operationId" to be a string',
    ],
  ])(
    "fails a claimed event with %s as INVALID_INVOCATION_EVENT",
    async (_label, overrides, reason) => {
      const runtime = makeRuntime();
      const malformed = makeHttpEvent(overrides);

      const failure = await capturedRejection(runtime(malformed, RUNTIME_CONTEXT));

      const error = expectInvalidInvocationEvent(failure);
      expect(error.message).toContain(reason);
    },
  );

  it("accepts sensitive client headers without echoing them anywhere", async () => {
    const runtime = makeRuntime();

    // Authorization/Cookie are valid request data: their presence must never
    // fail validation nor surface in any diagnostic (AGENTS.md section 6.2).
    const result = await runtime(
      makeHttpEvent({
        headers: { Authorization: "Bearer SUPER-SECRET-TOKEN", Cookie: "session=TOP-SECRET-VALUE" },
      }),
      RUNTIME_CONTEXT,
    );

    // The invocation completes through full dispatch; credentials never
    // surface anywhere in the envelope (AGENTS.md section 6.2).
    expect(result).toEqual({
      statusCode: 404,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Cannot GET /test/simple",
        error: "Not Found",
        statusCode: 404,
        trace_id: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      }),
      isBase64Encoded: false,
    });
    expect(JSON.stringify(result)).not.toContain("SUPER-SECRET");
    expect(JSON.stringify(result)).not.toContain("TOP-SECRET");
  });

  it("keeps credential and personal-data values out of validation diagnostics", async () => {
    const runtime = makeRuntime();
    const malformedWithSecrets = makeHttpEvent({
      headers: { Authorization: "Bearer SUPER-SECRET-TOKEN", Cookie: "session=TOP-SECRET-VALUE" },
      queryStringParameters: { token: "QUERY-SECRET-VALUE" },
      multiValueParameters: { q: "one" },
    });

    const failure = await capturedRejection(runtime(malformedWithSecrets, RUNTIME_CONTEXT));

    const error = expectInvalidInvocationEvent(failure);
    expect(error.message).not.toContain("SUPER-SECRET");
    expect(error.message).not.toContain("TOP-SECRET");
    expect(error.message).not.toContain("QUERY-SECRET");
  });

  it("rejects claimed-but-malformed events with INVALID_INVOCATION_EVENT while unclaimed shapes stay UNKNOWN", async () => {
    const runtime = makeRuntime();

    const invalidFailure = await capturedRejection(
      runtime(makeHttpEvent({ body: 17 }), RUNTIME_CONTEXT),
    );
    expectInvalidInvocationEvent(invalidFailure);

    // A Message Queue-shaped delivery violates the HTTP claim check first,
    // so no transport claims it at all (AGENTS.md section 8.3).
    const unknownFailure = await capturedRejection(
      runtime({ messages: [{ event_metadata: {} }] }, RUNTIME_CONTEXT),
    );
    if (!(unknownFailure instanceof ConnectorError)) {
      throw new Error(`expected ConnectorError, received ${String(unknownFailure)}`);
    }
    expect(unknownFailure.code).toBe("UNKNOWN_INVOCATION_EVENT");
    expect(unknownFailure.transportId).toBeUndefined();
  });
});

describe("http api gateway v2 transport dispatch behavior", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];
  let bootstrapSpy: MockInstance;

  // RootModule registers no controllers, so every fixture request ends at
  // the not-found layer: the deterministic platform-shaped 404 envelope the
  // NotFoundException filter produces.
  const UNMATCHED_ROUTE_RESPONSE = {
    statusCode: 404,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Cannot GET /test/simple",
      error: "Not Found",
      statusCode: 404,
      trace_id: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
    }),
    isBase64Encoded: false,
  };

  beforeEach(() => {
    bootstrapSpy = vi.spyOn(NestFactory, "create");
  });

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
    bootstrapSpy.mockRestore();
  });

  function makeRuntime(): ClosableYandexCloudFunctionHandler {
    const runtime = createInvocationRuntime(RootModule, [httpApiGatewayV2Transport]);
    runtimes.push(runtime);
    return runtime;
  }

  it("returns a wire-valid Yandex function response envelope for a valid request", async () => {
    const runtime = makeRuntime();

    const result = await runtime(makeHttpEvent(), RUNTIME_CONTEXT);

    // Without controllers the deterministic not-found envelope is the
    // wire-valid outcome of a fully dispatched request (issue #6).
    expect(result).toEqual(UNMATCHED_ROUTE_RESPONSE);
  });

  it("reuses one warm application across sequential HTTP invocations", async () => {
    const runtime = makeRuntime();

    await runtime(makeHttpEvent(), RUNTIME_CONTEXT);
    await runtime(makeHttpEvent(), RUNTIME_CONTEXT);

    // Warm-invocation discipline survives the real transport registration
    // (AGENTS.md section 10.2).
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it("completes concurrent invocations against the shared warm application", async () => {
    const runtime = makeRuntime();

    const results = await Promise.all([
      runtime(makeHttpEvent(), RUNTIME_CONTEXT),
      runtime(makeHttpEvent(), RUNTIME_CONTEXT),
      runtime(makeHttpEvent(), RUNTIME_CONTEXT),
    ]);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toEqual(UNMATCHED_ROUTE_RESPONSE);
    }
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it("requires the core-managed invocation scope around its dispatch", async () => {
    // Invoking the adapter outside the AsyncLocalStorage scope the core sets
    // up must fail loudly instead of silently skipping per-invocation state:
    // every real dispatch runs inside that scope.
    await expect(
      httpApiGatewayV2Transport.invoke({
        rawEvent: makeHttpEvent(),
        rawContext: RUNTIME_CONTEXT,
        executionContext: {
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
        },
        container: {
          resolve: () => Promise.reject(new Error("unused")),
          getApplication: () => {
            throw new Error("unused");
          },
        },
      }),
    ).rejects.toThrow(/can only be extended while handling a Yandex Cloud Function invocation/);
  });
});
