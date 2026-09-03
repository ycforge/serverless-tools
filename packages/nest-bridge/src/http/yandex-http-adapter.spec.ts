import { normalizeHttpRequest } from "./normalize-request";
import type { RawHttpApiGatewayV2Event } from "./raw-event";
import type { YandexFunctionHttpResponse } from "./response";
import type { YandexHttpRequestFacade } from "./request-facade";
import type { YandexHttpResponseFacade } from "./response-facade";
import { YandexHttpAdapter } from "./yandex-http-adapter";

/**
 * Adapter-level dispatch specs (issue #6): registration, request facade
 * semantics, response serialization and the error layer, driven directly
 * through {@link YandexHttpAdapter.dispatch} with observed-shape gateway
 * fixtures. NestJS pipeline integration lives in controller-dispatch.spec.
 */

function makeEvent(overrides: Record<string, unknown> = {}): RawHttpApiGatewayV2Event {
  return {
    version: "2.0",
    rawPath: "/probe",
    rawQueryString: "",
    headers: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {},
      http: {
        method: "GET",
        path: "/probe?",
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

async function dispatch(adapter: YandexHttpAdapter, event: RawHttpApiGatewayV2Event) {
  return adapter.dispatch(normalizeHttpRequest(event));
}

describe("yandex http adapter response serialization", () => {
  it("serializes returned objects as JSON with the application/json content type", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/probe", (_requestFacade, responseFacade) => {
      responseFacade.json({ ok: true, count: 2 });
    });

    const result = await dispatch(adapter, makeEvent());

    expect(result).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, count: 2 }),
      isBase64Encoded: false,
    });
  });

  it("serializes plain strings as text without corrupting them", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/probe", (_requestFacade, responseFacade) => {
      responseFacade.send("héllo wörld");
    });

    const result = await dispatch(adapter, makeEvent());

    expect(result).toEqual({
      statusCode: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "héllo wörld",
      isBase64Encoded: false,
    });
  });

  it("round-trips binary buffers as base64 with isBase64Encoded set", async () => {
    const binaryBytes = Buffer.from([0x00, 0xff, 0x10, 0xfe, 0x7f]);
    const adapter = new YandexHttpAdapter();
    adapter.get("/binary", (_requestFacade, responseFacade) => {
      responseFacade.send(binaryBytes);
    });

    const result = await dispatch(adapter, makeEvent({ rawPath: "/binary" }));

    expect(result.isBase64Encoded).toBe(true);
    expect(Buffer.from(result.body, "base64")).toEqual(binaryBytes);
    expect(result.headers["content-type"]).toBe("application/octet-stream");
  });

  it("keeps handler-set status codes and explicit headers", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.post("/created", (_requestFacade, responseFacade) => {
      responseFacade.statusCode = 201;
      responseFacade.setHeader("X-Request-Tracker", "fixture-tracker");
      responseFacade.json({ created: true });
    });

    const result = await dispatch(
      adapter,
      makeEvent({
        rawPath: "/created",
        requestContext: {
          authorizer: {},
          http: {
            method: "POST",
            path: "/created?",
            sourceIp: "203.0.113.10",
            userAgent: "fixture-agent/1.0",
          },
          requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
          time: "21/Aug/2026:16:16:30 +0000",
          timeEpoch: 1787328990,
        },
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(result.headers["x-request-tracker"]).toBe("fixture-tracker");
  });

  it("emits repeated header appends through multiValueHeaders instead of comma-joining them", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/cookies", (_requestFacade, responseFacade) => {
      responseFacade.appendHeader("Set-Cookie", "first=1; Path=/");
      responseFacade.appendHeader("Set-Cookie", "second=2; Path=/; HttpOnly");
      responseFacade.end();
    });

    const result = await dispatch(adapter, makeEvent({ rawPath: "/cookies" }));

    // A comma is legal inside cookie attributes, so joining would be lossy;
    // the documented multi-value field carries both values verbatim and the
    // flat map stays free of the name (platform rule: it wins over headers).
    expect(result.multiValueHeaders).toEqual({
      "set-cookie": ["first=1; Path=/", "second=2; Path=/; HttpOnly"],
    });
    expect(Object.keys(result.headers)).not.toContain("set-cookie");
  });

  it("keeps single-valued responses in the exact four-field envelope shape", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/plain", (_requestFacade, responseFacade) => {
      responseFacade.end();
    });

    const result: YandexFunctionHttpResponse = await dispatch(
      adapter,
      makeEvent({ rawPath: "/plain" }),
    );

    expect(result).toEqual({
      statusCode: 200,
      headers: {},
      body: "",
      isBase64Encoded: false,
    });
    expect("multiValueHeaders" in result).toBe(false);
  });
});

describe("yandex http adapter request facade semantics", () => {
  it("binds route parameters per request like a platform router", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/users/:userId/items/:itemId", (requestFacade, responseFacade) => {
      responseFacade.json(requestFacade.params);
    });

    const result = await dispatch(adapter, makeEvent({ rawPath: "/users/42/items/key-9" }));

    expect(JSON.parse(result.body)).toEqual({ userId: "42", itemId: "key-9" });
  });

  it("preserves repeated query parameters as arrays parsed from the canonical raw query string", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/search", (requestFacade, responseFacade) => {
      // Deliberately reads the parsed view, never the comma-folded
      // queryStringParameters field (AGENTS.md section 4.3).
      responseFacade.json(requestFacade.query);
    });

    const result = await dispatch(
      adapter,
      makeEvent({
        rawPath: "/search",
        rawQueryString: "multi=one&multi=two&flag=1",
        queryStringParameters: { multi: "one,two", flag: "1" },
        multiValueParameters: { multi: ["one", "two"], flag: ["1"] },
      }),
    );

    expect(JSON.parse(result.body)).toEqual({ multi: ["one", "two"], flag: "1" });
  });

  it("exposes lowercased header keys while leaving the normalized request untouched", async () => {
    const adapter = new YandexHttpAdapter();
    let seenByHandler: Record<string, unknown> | undefined;
    adapter.get("/headers", (requestFacade, responseFacade) => {
      seenByHandler = { ...requestFacade.headers };
      responseFacade.end();
    });

    await dispatch(
      adapter,
      makeEvent({
        rawPath: "/headers",
        headers: { "Content-Type": "text/plain", "X-Marker": "m1" },
      }),
    );

    // Gateway header keys are Pascal-Cased (observed); the facade mirrors
    // platform routers by exposing them lowercased.
    expect(seenByHandler).toEqual({ "content-type": "text/plain", "x-marker": "m1" });
  });

  it("parses declared JSON bodies into req.body only when the parser is enabled", async () => {
    const jsonPayload = JSON.stringify({ name: "widget", tags: ["a", "b"] });
    const event = makeEvent({
      rawPath: "/widgets",
      requestContext: {
        authorizer: {},
        http: {
          method: "POST",
          path: "/widgets?",
          sourceIp: "203.0.113.10",
          userAgent: "fixture-agent/1.0",
        },
        requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
        time: "21/Aug/2026:16:16:30 +0000",
        timeEpoch: 1787328990,
      },
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(jsonPayload, "utf8").toString("base64"),
      isBase64Encoded: true,
    });

    const enabled = new YandexHttpAdapter();
    enabled.registerParserMiddleware();
    let parsedBody: unknown;
    enabled.post("/widgets", (requestFacade, responseFacade) => {
      parsedBody = requestFacade.body;
      responseFacade.end();
    });
    await dispatch(enabled, event);
    expect(parsedBody).toEqual({ name: "widget", tags: ["a", "b"] });

    // Mirrors Nest's `bodyParser: false`: bodies stay opaque bytes and the
    // application decides how to interpret them.
    const disabled = new YandexHttpAdapter();
    let disabledBody: unknown;
    disabled.post("/widgets", (requestFacade, responseFacade) => {
      disabledBody = requestFacade.body;
      responseFacade.end();
    });
    await dispatch(disabled, event);
    expect(disabledBody).toBeUndefined();
  });

  it("funnels malformed JSON through the registered error layer like the platform parser", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.registerParserMiddleware();

    const capturedErrors: unknown[] = [];
    adapter.setErrorHandler((error, _requestFacade, responseFacade) => {
      capturedErrors.push(error);
      responseFacade.status(400);
      responseFacade.json({ statusCode: 400, message: (error as Error).message });
    });
    adapter.post("/submit", (_requestFacade, responseFacade) => {
      responseFacade.json({ reached: true });
    });

    const result = await dispatch(
      adapter,
      makeEvent({
        rawPath: "/submit",
        requestContext: {
          authorizer: {},
          http: {
            method: "POST",
            path: "/submit?",
            sourceIp: "203.0.113.10",
            userAgent: "fixture-agent/1.0",
          },
          requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
          time: "21/Aug/2026:16:16:30 +0000",
          timeEpoch: 1787328990,
        },
        headers: { "Content-Type": "application/json" },
        body: Buffer.from("{ not json", "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    );

    expect(capturedErrors).toHaveLength(1);
    expect(capturedErrors[0]).toBeInstanceOf(SyntaxError);
    expect(result.statusCode).toBe(400);
  });

  it("keeps form and unknown content types unparsed at the transport boundary", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.registerParserMiddleware();
    let seenBody: unknown;
    let seenRawLength: number | undefined;
    adapter.post("/form", (requestFacade, responseFacade) => {
      seenBody = requestFacade.body;
      seenRawLength = requestFacade.rawBody?.byteLength;
      responseFacade.end();
    });

    await dispatch(
      adapter,
      makeEvent({
        rawPath: "/form",
        requestContext: {
          authorizer: {},
          http: {
            method: "POST",
            path: "/form?",
            sourceIp: "203.0.113.10",
            userAgent: "fixture-agent/1.0",
          },
          requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
          time: "21/Aug/2026:16:16:30 +0000",
          timeEpoch: 1787328990,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: Buffer.from("a=1&b=2", "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    );

    // AGENTS.md section 31: no automatic form parsing — the raw bytes stay
    // reachable, interpretation belongs to the application.
    expect(seenBody).toBeUndefined();
    expect(seenRawLength).toBe(7);
  });
});

describe("yandex http adapter routing behavior", () => {
  it("answers HEAD requests with GET handlers when no HEAD route exists", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.get("/resource", (_requestFacade, responseFacade) => {
      responseFacade.setHeader("X-From-Get", "yes");
      responseFacade.json({ id: 1 });
    });

    const result = await dispatch(
      adapter,
      makeEvent({
        rawPath: "/resource",
        requestContext: {
          authorizer: {},
          http: {
            method: "HEAD",
            path: "/resource?",
            sourceIp: "203.0.113.10",
            userAgent: "fixture-agent/1.0",
          },
          requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
          time: "21/Aug/2026:16:16:30 +0000",
          timeEpoch: 1787328990,
        },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers["x-from-get"]).toBe("yes");
  });

  it("returns the deterministic not-found envelope when no route matches", async () => {
    const adapter = new YandexHttpAdapter();

    const result = await dispatch(adapter, makeEvent({ rawPath: "/missing" }));

    expect(result).toEqual({
      statusCode: 404,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: 404, message: "Cannot GET /missing" }),
      isBase64Encoded: false,
    });
  });

  it("rejects method mismatches instead of treating them as matches", async () => {
    const adapter = new YandexHttpAdapter();
    let reached = false;
    adapter.get("/only-get", () => {
      reached = true;
    });

    const result = await dispatch(
      adapter,
      makeEvent({
        requestContext: {
          authorizer: {},
          http: {
            method: "DELETE",
            path: "/only-get?",
            sourceIp: "203.0.113.10",
            userAgent: "fixture-agent/1.0",
          },
          requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
          time: "21/Aug/2026:16:16:30 +0000",
          timeEpoch: 1787328990,
        },
      }),
    );

    expect(reached).toBe(false);
    expect(result.statusCode).toBe(404);
  });

  it("falls through to later matching routes when a handler calls next() without responding", async () => {
    const adapter = new YandexHttpAdapter();
    const callOrder: string[] = [];

    // Express router semantics: a matched handler that forwards via next()
    // continues the scan into subsequent layers instead of ending the
    // exchange; only stack exhaustion reaches the terminal not-found proxy.
    adapter.get("/probe", (_requestFacade, responseFacade, next) => {
      callOrder.push("first");
      responseFacade.setHeader("X-Passed-First", "yes");
      next();
    });
    adapter.get("/probe", (_requestFacade, responseFacade) => {
      callOrder.push("second");
      responseFacade.setHeader("X-Passed-Second", "yes");
      responseFacade.json({ reached: "second" });
    });

    const result = await dispatch(adapter, makeEvent());

    expect(callOrder).toEqual(["first", "second"]);
    expect(JSON.parse(result.body)).toEqual({ reached: "second" });
    expect(result.headers["x-passed-first"]).toBe("yes");
    expect(result.headers["x-passed-second"]).toBe("yes");
  });

  it("runs middleware before routes and lets responses short-circuit the chain", async () => {
    const adapter = new YandexHttpAdapter();
    const callOrder: string[] = [];

    adapter.use(
      "/",
      (
        requestFacade: YandexHttpRequestFacade,
        responseFacade: YandexHttpResponseFacade,
        next: (error?: unknown) => void,
      ) => {
        callOrder.push("gatekeeper");
        if (requestFacade.headers["x-token"] !== "expected") {
          responseFacade.statusCode = 401;
          responseFacade.json({ statusCode: 401, message: "Unauthorized" });
          return;
        }
        next();
      },
    );
    adapter.get("/protected", () => {
      callOrder.push("handler");
    });

    const denied = await dispatch(adapter, makeEvent({ rawPath: "/protected" }));
    expect(callOrder).toEqual(["gatekeeper"]);
    expect(denied.statusCode).toBe(401);

    callOrder.length = 0;
    const allowed = await dispatch(
      adapter,
      makeEvent({ rawPath: "/protected", headers: { "X-Token": "expected" } }),
    );
    expect(callOrder).toEqual(["gatekeeper", "handler"]);
    expect(allowed.statusCode).toBe(200);
  });

  it("does not run middleware mounted under an unrelated prefix", async () => {
    const adapter = new YandexHttpAdapter();
    let adminMiddlewareRan = false;

    adapter.use("/admin", () => {
      adminMiddlewareRan = true;
    });
    adapter.get("/public/info", (_requestFacade, responseFacade) => {
      responseFacade.json({ area: "public" });
    });

    const result = await dispatch(adapter, makeEvent({ rawPath: "/public/info" }));

    expect(adminMiddlewareRan).toBe(false);
    expect(JSON.parse(result.body)).toEqual({ area: "public" });
  });
});

describe("yandex http adapter invocation isolation", () => {
  it("leaks nothing of one dispatch into the next on the warm adapter", async () => {
    const adapter = new YandexHttpAdapter();
    adapter.registerParserMiddleware();

    const seenBodies: unknown[] = [];
    const seenParams: Array<Record<string, string>> = [];
    adapter.post("/items/:shelf", (requestFacade, responseFacade) => {
      seenBodies.push(requestFacade.body);
      seenParams.push({ ...requestFacade.params });
      responseFacade.json({ shelf: requestFacade.params["shelf"] });
    });

    const postEvent = (shelf: string, payload: object) =>
      makeEvent({
        rawPath: `/items/${shelf}`,
        requestContext: {
          authorizer: {},
          http: {
            method: "POST",
            path: `/items/${shelf}?`,
            sourceIp: "203.0.113.10",
            userAgent: "fixture-agent/1.0",
          },
          requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
          time: "21/Aug/2026:16:16:30 +0000",
          timeEpoch: 1787328990,
        },
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
        isBase64Encoded: true,
      });

    const first = await dispatch(adapter, postEvent("shelves", { item: "first" }));
    const second = await dispatch(adapter, postEvent("other-shelf", { item: "second" }));

    expect(seenBodies[0]).toEqual({ item: "first" });
    expect(seenBodies[1]).toEqual({ item: "second" });
    expect(seenParams[0]).toEqual({ shelf: "shelves" });
    expect(seenParams[1]).toEqual({ shelf: "other-shelf" });
    expect(JSON.parse(first.body)).toEqual({ shelf: "shelves" });
    expect(JSON.parse(second.body)).toEqual({ shelf: "other-shelf" });
  });
});
