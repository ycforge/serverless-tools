import {
  Body,
  CanActivate,
  Catch,
  Controller,
  ExecutionContext,
  ExceptionFilter,
  Get,
  Module,
  NestInterceptor,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  RequestMethod,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ArgumentsHost,
  type CallHandler,
  type MiddlewareConsumer,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { httpApiGatewayV2Transport } from "./adapter";
import type { RawHttpApiGatewayV2Event } from "./raw-event";
import {
  createInvocationRuntime,
  type ClosableYandexCloudFunctionHandler,
} from "../core/create-yandex-handler";
import type { YandexHttpRequestFacade } from "./request-facade";
import type { YandexHttpResponseFacade } from "./response-facade";

/**
 * End-to-end dispatch integration specs (issue #6): real NestJS controllers
 * driven through the public runtime and the built-in HTTP transport, proving
 * conventional controllers produce wire-valid Yandex envelopes.
 *
 * These tests intentionally exercise framework features (guards, interceptors,
 * pipes, filters, functional middleware) so a refactor of the connector's
 * dispatch layer fails here whenever it diverges from actual NestJS
 * semantics — not merely from its own router expectations.
 *
 * Decorators are applied imperatively (exactly what legacy decorator
 * desugaring does) so the suite stays independent of this repository's
 * decorator compilation settings.
 */

const BINARY_BYTES = [0x00, 0xff, 0x10, 0xfe, 0x7f] as const;

class ProbeController {
  ping(): object {
    return { pong: true };
  }

  search(queryValue: unknown): object {
    return { queryValue };
  }

  create(body: unknown): object {
    return { received: body };
  }

  missing(): never {
    throw new NotFoundException("item absent");
  }

  boom(): never {
    throw new Error("controller-boom");
  }

  binary(): Buffer {
    return Buffer.from(BINARY_BYTES);
  }

  cookies(responseFacade: YandexHttpResponseFacade): object {
    responseFacade.appendHeader("Set-Cookie", "session=abc; Path=/");
    responseFacade.appendHeader("Set-Cookie", "tracking=off; Path=/; Secure");
    return { attached: true };
  }

  // Declared last so the :userId pattern never shadows the static routes
  // above: routers resolve first-match-wins over declaration order.
  user(userId: string): object {
    return { userId };
  }
}

Controller("probe")(ProbeController);

function methodDescriptor(name: string): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(ProbeController.prototype, name);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${name}`);
  }
  return descriptor;
}

Get("ping")(ProbeController.prototype, "ping", methodDescriptor("ping"));

Get("search")(ProbeController.prototype, "search", methodDescriptor("search"));
Query("q")(ProbeController.prototype, "search", 0);

Post("items")(ProbeController.prototype, "create", methodDescriptor("create"));
Body()(ProbeController.prototype, "create", 0);

Get("missing")(ProbeController.prototype, "missing", methodDescriptor("missing"));
Get("boom")(ProbeController.prototype, "boom", methodDescriptor("boom"));
Get("binary")(ProbeController.prototype, "binary", methodDescriptor("binary"));

Get("cookies")(ProbeController.prototype, "cookies", methodDescriptor("cookies"));
Res({ passthrough: true })(ProbeController.prototype, "cookies", 0);

// Declared last on the class (see ProbeController): static routes must
// register before the parameterized pattern.
Get(":userId")(ProbeController.prototype, "user", methodDescriptor("user"));
Param("userId")(ProbeController.prototype, "user", 0);

class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

interface EventOverrides {
  readonly method?: string;
  readonly path?: string;
  readonly rawQueryString?: string;
  readonly jsonBody?: unknown;
  readonly rawJsonBody?: string;
}

function makeHttpEvent(overrides: EventOverrides = {}): RawHttpApiGatewayV2Event {
  const path = overrides.path ?? "/probe/ping";
  const rawQueryString = overrides.rawQueryString ?? "";
  let body = "";
  let isBase64Encoded = true;
  const headers: Record<string, string> = {};
  if (overrides.rawJsonBody !== undefined || overrides.jsonBody !== undefined) {
    const text = overrides.rawJsonBody ?? JSON.stringify(overrides.jsonBody);
    headers["Content-Type"] = "application/json";
    body = Buffer.from(text, "utf8").toString("base64");
    isBase64Encoded = true;
  }
  return {
    version: "2.0",
    rawPath: path,
    rawQueryString,
    headers,
    queryStringParameters: {},
    requestContext: {
      authorizer: {},
      http: {
        method: overrides.method ?? "GET",
        path: `${path}?${rawQueryString}`,
        sourceIp: "203.0.113.10",
        userAgent: "fixture-agent/1.0",
      },
      requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      time: "21/Aug/2026:16:16:30 +0000",
      timeEpoch: 1787328990,
    },
    body,
    isBase64Encoded,
    pathParameters: {},
    parameters: {},
    multiValueParameters: {},
    operationId: "41cf33042e33".padEnd(64, "0"),
  };
}

/** Observed-shape runtime context (DATA-ANALYSE.md section D), placeholder values only. */
const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-http-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

describe("controller dispatch through the public runtime", () => {
  let runtime: ClosableYandexCloudFunctionHandler;

  beforeEach(() => {
    runtime = createInvocationRuntime(ProbeModule, [httpApiGatewayV2Transport]);
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
    }
  });

  it("serializes a controller's returned object as a JSON envelope", async () => {
    const result = (await runtime(makeHttpEvent(), RUNTIME_CONTEXT)) as Record<string, unknown>;

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(result.body as string)).toEqual({ pong: true });
    expect(result.isBase64Encoded).toBe(false);
  });

  it("injects matched route parameters through @Param()", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/probe/user-42" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ userId: "user-42" });
  });

  it("hands @Query() repeated parameters as arrays from the canonical query string", async () => {
    const result = (await runtime(
      makeHttpEvent({
        path: "/probe/search",
        rawQueryString: "q=alpha&q=beta&flag=on",
      }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(200);
    // Multiplicity survives: no comma-folded "alpha,beta" anywhere.
    expect(JSON.parse(result.body as string)).toEqual({
      queryValue: ["alpha", "beta"],
    });
  });

  it("parses declared JSON bodies into @Body()", async () => {
    const result = (await runtime(
      makeHttpEvent({ method: "POST", path: "/probe/items", jsonBody: { name: "widget" } }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    // Platform parity: POST routes default to 201 Created.
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body as string)).toEqual({ received: { name: "widget" } });
    expect((result.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("maps malformed JSON bodies to a deterministic 400 through the exception layer", async () => {
    const result = (await runtime(
      makeHttpEvent({
        method: "POST",
        path: "/probe/items",
        rawJsonBody: "{ definitely-not-json",
      }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(400);
    const payload = JSON.parse(result.body as string);
    expect(payload.error).toBe("Bad Request");
    expect(typeof payload.message).toBe("string");
  });

  it("maps HttpExceptions raised by controllers to their status codes", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/probe/missing" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body as string)).toEqual(
      expect.objectContaining({ message: "item absent", statusCode: 404 }),
    );
  });

  it("maps unhandled controller failures to the deterministic 500 without leaking internals", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/probe/boom" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    // Platform parity: unexpected failures become an opaque internal server
    // error; neither the message nor any stack frame reaches the client.
    expect(result).toEqual({
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statusCode: 500, message: "Internal server error" }),
      isBase64Encoded: false,
    });
    expect(String(result.body)).not.toContain("controller-boom");
  });

  it("returns binary buffers base64-encoded without corruption", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/probe/binary" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.isBase64Encoded).toBe(true);
    expect([...Buffer.from(result.body as string, "base64")]).toEqual([...BINARY_BYTES]);
    expect((result.headers as Record<string, string>)["content-type"]).toBe(
      "application/octet-stream",
    );
  });

  it("emits multiple Set-Cookie appends through multiValueHeaders", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/probe/cookies" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ attached: true });
    expect(result.multiValueHeaders).toEqual({
      "set-cookie": ["session=abc; Path=/", "tracking=off; Path=/; Secure"],
    });
    expect(Object.keys(result.headers as object)).not.toContain("set-cookie");
  });

  it("keeps invocations isolated on the warm application across sequential requests", async () => {
    const first = (await runtime(
      makeHttpEvent({ method: "POST", path: "/probe/items", jsonBody: { n: 1 } }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;
    const second = (await runtime(
      makeHttpEvent({ method: "POST", path: "/probe/items", jsonBody: { n: 2 } }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    // Invocation N's payload never appears in N+1 (AGENTS.md section 11).
    expect(JSON.parse(first.body as string)).toEqual({ received: { n: 1 } });
    expect(JSON.parse(second.body as string)).toEqual({ received: { n: 2 } });
    expect(first).not.toBe(second);
  });
});

// -----------------------------------------------------------------------------
// Framework semantics through the public runtime.
//
// Every fixture below relies on behavior that lives INSIDE Nest's route
// proxies (guards, interceptors, pipes, filters) or in framework ordering
// rules (body parser before functional middleware). If the connector's
// dispatch layer ever stops delegating these to the framework, these tests
// fail — they cannot pass against a merely self-consistent custom router.
// -----------------------------------------------------------------------------

class RejectingGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

class WrappingInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, nextHandler: CallHandler): Observable<unknown> {
    return nextHandler.handle().pipe(map((payload) => ({ wrapped: payload })));
  }
}

class FrameworkError extends Error {}

@Catch(FrameworkError)
class FrameworkFilter implements ExceptionFilter {
  catch(_exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<YandexHttpResponseFacade>();
    response.status(418);
    response.json({ handledBy: "framework-filter" });
  }
}

class FrameworkController {
  guarded(): object {
    return { reached: true };
  }

  intercepted(): object {
    return { original: true };
  }

  piped(q: number): object {
    return { q, type: typeof q };
  }

  filtered(): never {
    throw new FrameworkError("brew failure");
  }

  circular(): object {
    const payload: Record<string, unknown> = {};
    payload["self"] = payload;
    return payload;
  }

  typed(responseFacade: YandexHttpResponseFacade): void {
    // An explicit content type must survive serialization untouched; only
    // absent content types gain an implicit one.
    responseFacade.setHeader("Content-Type", "application/vnd.vendor+json");
    responseFacade.send(JSON.stringify({ vendor: true }));
  }

  echo(body: unknown): object {
    return { received: body };
  }
}

Controller("fw")(FrameworkController);

function frameworkDescriptor(name: string): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(FrameworkController.prototype, name);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${name}`);
  }
  return descriptor;
}

Get("guarded")(FrameworkController.prototype, "guarded", frameworkDescriptor("guarded"));
UseGuards(RejectingGuard)(FrameworkController.prototype, "guarded", frameworkDescriptor("guarded"));

Get("intercepted")(
  FrameworkController.prototype,
  "intercepted",
  frameworkDescriptor("intercepted"),
);
UseInterceptors(WrappingInterceptor)(
  FrameworkController.prototype,
  "intercepted",
  frameworkDescriptor("intercepted"),
);

Get("piped")(FrameworkController.prototype, "piped", frameworkDescriptor("piped"));
Query("q", ParseIntPipe)(FrameworkController.prototype, "piped", 0);

Get("filtered")(FrameworkController.prototype, "filtered", frameworkDescriptor("filtered"));
UseFilters(FrameworkFilter)(
  FrameworkController.prototype,
  "filtered",
  frameworkDescriptor("filtered"),
);

Get("circular")(FrameworkController.prototype, "circular", frameworkDescriptor("circular"));
Post("echo")(FrameworkController.prototype, "echo", frameworkDescriptor("echo"));
Body()(FrameworkController.prototype, "echo", 0);

Get("typed")(FrameworkController.prototype, "typed", frameworkDescriptor("typed"));
Res({ passthrough: true })(FrameworkController.prototype, "typed", 0);

const middlewareObservations: Array<{ readonly sawBody: unknown }> = [];

class AuditingMiddleware {
  use(requestFacade: YandexHttpRequestFacade, _responseFacade: unknown, next: () => void): void {
    middlewareObservations.push({ sawBody: requestFacade.body });
    next();
  }
}

class FrameworkModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditingMiddleware).forRoutes({
      path: "fw/echo",
      method: RequestMethod.POST,
    });
  }
}

Module({ controllers: [FrameworkController] })(FrameworkModule);

describe("framework semantics through the public runtime", () => {
  let runtime: ClosableYandexCloudFunctionHandler;

  beforeEach(() => {
    runtime = createInvocationRuntime(FrameworkModule, [httpApiGatewayV2Transport]);
    middlewareObservations.length = 0;
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
    }
  });

  it("runs route guards inside the framework proxy and maps rejections to 403", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/fw/guarded" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body as string)).toEqual(expect.objectContaining({ statusCode: 403 }));
  });

  it("applies interceptors around handlers so responses can be transformed", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/fw/intercepted" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ wrapped: { original: true } });
  });

  it("runs parameter pipes and maps validation failures to a deterministic 400", async () => {
    const rejected = (await runtime(
      makeHttpEvent({ path: "/fw/piped", rawQueryString: "q=not-a-number" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(rejected.statusCode).toBe(400);
    expect((JSON.parse(rejected.body as string) as { error?: string }).error).toBe("Bad Request");

    const accepted = (await runtime(
      makeHttpEvent({ path: "/fw/piped", rawQueryString: "q=7" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(JSON.parse(accepted.body as string)).toEqual({ q: 7, type: "number" });
  });

  it("dispatches controller-scoped exception filters with full facade access", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/fw/filtered" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    expect(result.statusCode).toBe(418);
    expect(JSON.parse(result.body as string)).toEqual({ handledBy: "framework-filter" });
  });

  it("maps unserializable handler payloads to the platform 500 through the exception filters", async () => {
    const result = (await runtime(
      makeHttpEvent({ path: "/fw/circular" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    // JSON.stringify runs at payload-write time inside the route proxy, so a
    // circular structure surfaces as an ordinary handler failure mapped by
    // the framework filters — never as a post-dispatch crash.
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body as string)).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
  });

  it("preserves explicit handler-set content types over implicit defaults", async () => {
    const result = (await runtime(makeHttpEvent({ path: "/fw/typed" }), RUNTIME_CONTEXT)) as Record<
      string,
      unknown
    >;

    expect(result.statusCode).toBe(200);
    expect((result.headers as Record<string, string>)["content-type"]).toBe(
      "application/vnd.vendor+json",
    );
    expect(JSON.parse(result.body as string)).toEqual({ vendor: true });
  });

  it("registers the body parser before functional middleware like platform servers do", async () => {
    const result = (await runtime(
      makeHttpEvent({ method: "POST", path: "/fw/echo", jsonBody: { n: 5 } }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    // The auditing middleware registers through FrameworkModule.configure
    // during init — after the parser joined the stack. Platform ordering is
    // parser → functional middleware → route, so the middleware observes the
    // already-parsed body object rather than raw bytes.
    expect(middlewareObservations).toEqual([{ sawBody: { n: 5 } }]);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body as string)).toEqual({ received: { n: 5 } });
  });
});

class ItemsController {
  // Declared before "byId": NestJS explores methods in class-declaration
  // order (MetadataScanner over getOwnPropertyNames), so static multi-path
  // routes must not sit behind the ":id" pattern.
  shared(): object {
    return { via: "multi" };
  }

  byId(id: string): object {
    return { id };
  }
}

Controller("items")(ItemsController);

function itemsDescriptor(name: string): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(ItemsController.prototype, name);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${name}`);
  }
  return descriptor;
}

// Static/multi-path registrations precede the parameterized route exactly
// like on platform routers: first-match-wins over declaration order would
// otherwise shadow them behind ":id".
Get(["legacy", "renamed"])(ItemsController.prototype, "shared", itemsDescriptor("shared"));
// NestJS flattens multi-path decorators into one registration per entry
// (verified against @nestjs/core 11 RouterExplorer), so the matcher sees two
// ordinary strings.
Get(":id")(ItemsController.prototype, "byId", itemsDescriptor("byId"));
Param("id")(ItemsController.prototype, "byId", 0);

class RoutePatternModule {}
Module({ controllers: [ItemsController] })(RoutePatternModule);

const wildcardObservations: string[] = [];

class WildcardObserver {
  use(_requestFacade: unknown, _responseFacade: unknown, next: () => void): void {
    wildcardObservations.push("seen");
    next();
  }
}

class WildcardModule {
  configure(consumer: MiddlewareConsumer): void {
    // forRoutes('*') is the canonical catch-all mount; without a global
    // prefix Nest's extractor hands it to the adapter as "/*".
    consumer.apply(WildcardObserver).forRoutes("*");
  }
}

Module({ controllers: [ProbeController] })(WildcardModule);

describe("route pattern compatibility through the public runtime", () => {
  let runtime: ClosableYandexCloudFunctionHandler;

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
    }
  });

  it("captures :param segments under a controller prefix", async () => {
    runtime = createInvocationRuntime(RoutePatternModule, [httpApiGatewayV2Transport]);
    const result = (await runtime(makeHttpEvent({ path: "/items/42" }), RUNTIME_CONTEXT)) as Record<
      string,
      unknown
    >;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ id: "42" });
  });

  it("serves every path of a multi-path decorator as an independent registration", async () => {
    runtime = createInvocationRuntime(RoutePatternModule, [httpApiGatewayV2Transport]);

    for (const path of ["/items/legacy", "/items/renamed"]) {
      const result = (await runtime(makeHttpEvent({ path }), RUNTIME_CONTEXT)) as Record<
        string,
        unknown
      >;
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body as string)).toEqual({ via: "multi" });
    }
  });

  it("runs catch-all middleware mounts on matched and unmatched requests alike", async () => {
    runtime = createInvocationRuntime(WildcardModule, [httpApiGatewayV2Transport]);
    wildcardObservations.length = 0;

    const matched = (await runtime(makeHttpEvent(), RUNTIME_CONTEXT)) as Record<string, unknown>;
    const unmatched = (await runtime(
      makeHttpEvent({ path: "/nowhere" }),
      RUNTIME_CONTEXT,
    )) as Record<string, unknown>;

    // The observer ran for the matched ping and the unmatched request alike:
    // mount matching is prefix-wide, not route-bound.
    expect(wildcardObservations).toHaveLength(2);
    expect(matched.statusCode).toBe(200);
    expect(unmatched.statusCode).toBe(404);
  });

  it("fails cold start with UNSUPPORTED_ROUTE_PATTERN for regex-style route parameters", async () => {
    class BrokenController {
      byCode(): object {
        return {};
      }
    }

    Controller("broken")(BrokenController);
    const descriptor = Object.getOwnPropertyDescriptor(BrokenController.prototype, "byCode");
    if (!descriptor) {
      throw new Error("missing descriptor for byCode");
    }
    Get(":code(\\d+)")(BrokenController.prototype, "byCode", descriptor);

    class BrokenModule {}
    Module({ controllers: [BrokenController] })(BrokenModule);

    runtime = createInvocationRuntime(BrokenModule, [httpApiGatewayV2Transport]);

    await expect(runtime(makeHttpEvent(), RUNTIME_CONTEXT)).rejects.toMatchObject({
      name: "ConnectorError",
      code: "UNSUPPORTED_ROUTE_PATTERN",
      message: expect.stringContaining("/broken/:code(\\d+)"),
    });
  });
});
