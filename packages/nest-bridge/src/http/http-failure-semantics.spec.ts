import {
  BadRequestException,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Module,
  NestInterceptor,
  ServiceUnavailableException,
  UseInterceptors,
  type ArgumentsHost,
  type CallHandler,
} from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { catchError, throwError, type Observable } from "rxjs";
import { ConnectorError } from "../core/connector-error";
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "../core/create-yandex-handler";
import type { YandexHttpResponseFacade } from "./response-facade";
import type { RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Unified HTTP failure semantics through the public runtime (issue #10):
 * application exceptions become deterministic HTTP responses via the
 * framework's own exception machinery (filters/interceptors intact),
 * unexpected failures stay opaque and value-free, malformed invocation
 * events fail as boundary errors before any controller runs, and a failed
 * cold start rejects instead of answering with an envelope.
 *
 * Every test drives the public `createYandexHandler()` entry point with
 * observed-shape fixtures (DATA-ANALYSE.md sections B and D); decorators are
 * applied imperatively so the suite stays independent of decorator
 * compilation settings.
 */

interface EventOverrides {
  readonly method?: string;
  readonly path?: string;
  readonly rawQueryString?: string;
  readonly jsonBody?: unknown;
  readonly extraHeaders?: Record<string, string>;
}

function makeHttpEvent(overrides: EventOverrides = {}): RawHttpApiGatewayV2Event {
  const path = overrides.path ?? "/orders/ping";
  const rawQueryString = overrides.rawQueryString ?? "";
  let body = "";
  const headers: Record<string, string> = { ...(overrides.extraHeaders ?? {}) };
  if (overrides.jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
    body = Buffer.from(JSON.stringify(overrides.jsonBody), "utf8").toString("base64");
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
    isBase64Encoded: true,
    pathParameters: {},
    parameters: {},
    multiValueParameters: {},
    operationId: "41cf33042e33".padEnd(64, "0"),
  };
}

/** Observed-shape runtime context fixture (DATA-ANALYSE.md section D). */
const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-http-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

/** Sensitive values seeded into the failing request; none may ever echo back. */
const SECRET_AUTHORIZATION = "Bearer fixture-secret-iam-token";
const SECRET_COOKIE = "session=fixture-secret-cookie-value";
const SECRET_BODY_FRAGMENT = "4111-1111-1111-1111";
const SECRET_EXCEPTION_TEXT = "database password=hunter2";

class OrderController {
  ping(): object {
    return { pong: true };
  }

  rejected(): never {
    throw new BadRequestException("Invalid order id");
  }

  stale(): never {
    throw new HttpException({ code: "ORDER_STALE", hint: "reload the order" }, 409);
  }

  boom(): never {
    throw new Error(SECRET_EXCEPTION_TEXT);
  }
}

Controller("orders")(OrderController);

function orderDescriptor(name: string): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(OrderController.prototype, name);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${name}`);
  }
  return descriptor;
}

Get("ping")(OrderController.prototype, "ping", orderDescriptor("ping"));
Get("rejected")(OrderController.prototype, "rejected", orderDescriptor("rejected"));
Get("stale")(OrderController.prototype, "stale", orderDescriptor("stale"));
Get("boom")(OrderController.prototype, "boom", orderDescriptor("boom"));

class OrderModule {}
Module({ controllers: [OrderController] })(OrderModule);

@Catch()
class GlobalFailureFilter implements ExceptionFilter {
  catch(_exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<YandexHttpResponseFacade>();
    response.status(503);
    response.json({ handledBy: "global-filter" });
  }
}

class GenericFailureController {
  boom(): never {
    throw new Error(SECRET_EXCEPTION_TEXT);
  }
}

Controller("generic")(GenericFailureController);
Get("boom")(
  GenericFailureController.prototype,
  "boom",
  Object.getOwnPropertyDescriptor(GenericFailureController.prototype, "boom")!,
);

class GlobalFilterModule {}
Module({
  controllers: [GenericFailureController],
  providers: [{ provide: APP_FILTER, useClass: GlobalFailureFilter }],
})(GlobalFilterModule);

class RemappingInterceptor implements NestInterceptor {
  intercept(_context: unknown, next: CallHandler): Observable<unknown> {
    // Application-level error translation: interceptors observe handler
    // failures first and may convert them into different exceptions whose
    // standard mapping then applies.
    return next.handle().pipe(
      catchError((error: unknown) => {
        void error;
        return throwError(() => new ServiceUnavailableException("remapped-by-interceptor"));
      }),
    );
  }
}

class InterceptedFailureController {
  boom(): never {
    throw new Error("original-intercepted-boom");
  }
}

Controller("intercepted")(InterceptedFailureController);
Get("boom")(
  InterceptedFailureController.prototype,
  "boom",
  Object.getOwnPropertyDescriptor(InterceptedFailureController.prototype, "boom")!,
);
UseInterceptors(RemappingInterceptor)(
  InterceptedFailureController.prototype,
  "boom",
  Object.getOwnPropertyDescriptor(InterceptedFailureController.prototype, "boom")!,
);

class InterceptorModule {}
Module({ controllers: [InterceptedFailureController] })(InterceptorModule);

async function capturedRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the invocation to reject");
}

function expectEnvelope(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null || !("statusCode" in result)) {
    throw new Error(`expected an HTTP response envelope, received ${String(result)}`);
  }
  return result as Record<string, unknown>;
}

describe("http failure semantics through the public runtime", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
    vi.restoreAllMocks();
  });

  it("maps HttpExceptions raised in handlers to deterministic status-code responses", async () => {
    const runtime = createYandexHandler(OrderModule);
    runtimes.push(runtime);

    const result = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/rejected" }), RUNTIME_CONTEXT),
    );

    expect(result.statusCode).toBe(400);
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(result.body as string)).toEqual({
      statusCode: 400,
      message: "Invalid order id",
      error: "Bad Request",
    });
    expect(result.isBase64Encoded).toBe(false);
  });

  it("preserves custom HttpException response objects and status codes verbatim", async () => {
    const runtime = createYandexHandler(OrderModule);
    runtimes.push(runtime);

    const result = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/stale" }), RUNTIME_CONTEXT),
    );

    // The application-defined body travels untouched — no envelope rewriting,
    // no injected defaults, status code exactly as thrown.
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string)).toEqual({
      code: "ORDER_STALE",
      hint: "reload the order",
    });
  });

  it("maps unexpected handler failures to the opaque 500 without leaking secrets or stack frames", async () => {
    const runtime = createYandexHandler(OrderModule);
    runtimes.push(runtime);

    const result = expectEnvelope(
      await runtime(
        makeHttpEvent({
          path: "/orders/boom",
          jsonBody: { card: SECRET_BODY_FRAGMENT },
          extraHeaders: { Authorization: SECRET_AUTHORIZATION, Cookie: SECRET_COOKIE },
        }),
        RUNTIME_CONTEXT,
      ),
    );

    // Platform parity: unexpected failures become one static envelope. The
    // response is value-free — no exception text, no stack frame, no echoed
    // request header values, cookies or body fragments (AGENTS.md section
    // 8.1, docs/ARCHITECTURE.md section 6.5).
    expect(result.statusCode).toBe(500);
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(result.body).toBe(JSON.stringify({ statusCode: 500, message: "Internal server error" }));
    expect(result.isBase64Encoded).toBe(false);
    const serialized = String(result.body) + JSON.stringify(result.headers);
    for (const secret of [
      SECRET_EXCEPTION_TEXT,
      "hunter2",
      SECRET_AUTHORIZATION,
      SECRET_COOKIE,
      SECRET_BODY_FRAGMENT,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps global exception filters registered through DI in charge of error mapping", async () => {
    const runtime = createYandexHandler(GlobalFilterModule);
    runtimes.push(runtime);

    const result = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/generic/boom" }), RUNTIME_CONTEXT),
    );

    // The connector installs no parallel error framework: a global filter
    // replaces the default mapping exactly like on any platform server.
    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body as string)).toEqual({ handledBy: "global-filter" });
  });

  it("keeps interceptors able to remap handler failures before exception mapping", async () => {
    const runtime = createYandexHandler(InterceptorModule);
    runtimes.push(runtime);

    const result = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/intercepted/boom" }), RUNTIME_CONTEXT),
    );

    expect(result.statusCode).toBe(503);
    const payload = JSON.parse(result.body as string) as { message?: string };
    expect(payload.message).toBe("remapped-by-interceptor");
  });

  it("never lets a failing invocation poison later warm invocations", async () => {
    const runtime = createYandexHandler(OrderModule);
    runtimes.push(runtime);

    const unexpected = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/boom" }), RUNTIME_CONTEXT),
    );
    const healthyAfterFailure = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/ping" }), RUNTIME_CONTEXT),
    );
    const expectedFailure = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/rejected" }), RUNTIME_CONTEXT),
    );
    const healthyAgain = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/ping" }), RUNTIME_CONTEXT),
    );

    // Each invocation observes its own deterministic outcome; nothing from
    // invocation N leaks into N+1 (AGENTS.md section 11).
    expect(unexpected.statusCode).toBe(500);
    expect(healthyAfterFailure.statusCode).toBe(200);
    expect(expectedFailure.statusCode).toBe(400);
    expect(healthyAgain.statusCode).toBe(200);
    expect(JSON.parse(healthyAgain.body as string)).toEqual({ pong: true });
  });

  it("fails malformed claimed events as boundary errors before any controller runs", async () => {
    const runtime = createYandexHandler(OrderModule);
    runtimes.push(runtime);

    // Passes the cheap discriminator (version 2.0 + canonical fields) but
    // violates the observed shape: headers must be a string record.
    const malformed = makeHttpEvent() as unknown as Record<string, unknown>;
    malformed["headers"] = "not-a-record";

    const failure = await capturedRejection(
      runtime(malformed as unknown as RawHttpApiGatewayV2Event, RUNTIME_CONTEXT),
    );

    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as ConnectorError).code).toBe("INVALID_INVOCATION_EVENT");
    expect(String(failure)).not.toContain("not-a-record");

    // The boundary held: no application code observed the malformed event.
    const healthy = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/ping" }), RUNTIME_CONTEXT),
    );
    expect(healthy.statusCode).toBe(200);
  });

  it("propagates bootstrap failures without any response envelope and stays retryable", async () => {
    const runtime = createYandexHandler(OrderModule);
    runtimes.push(runtime);

    const bootstrapFailure = new Error("cold-start-boom");
    vi.spyOn(NestFactory, "create").mockRejectedValueOnce(bootstrapFailure);

    const failure = await capturedRejection(runtime(makeHttpEvent(), RUNTIME_CONTEXT));

    // A failed cold start fails the invocation with the original error —
    // never wrapped into a falsely successful (or any) HTTP envelope.
    expect(failure).toBe(bootstrapFailure);
    expect(failure).not.toBeInstanceOf(ConnectorError);

    // The failed initialization is not cached: the next invocation retries
    // the cold start and succeeds (issue #3 contract, pinned for #10).
    const recovered = expectEnvelope(
      await runtime(makeHttpEvent({ path: "/orders/ping" }), RUNTIME_CONTEXT),
    );
    expect(recovered.statusCode).toBe(200);
    expect(JSON.parse(recovered.body as string)).toEqual({ pong: true });
  });
});
