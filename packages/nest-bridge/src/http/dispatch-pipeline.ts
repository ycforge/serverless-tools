import type { NormalizedHttpRequest } from "./normalized-request";
import type { CompiledPathPattern } from "./path-matching";
import type { YandexHttpRequestFacade, YandexRequestHandler } from "./request-facade";
import { createRequestFacade } from "./request-facade";
import type { YandexHttpResponseFacade } from "./response-facade";
import { createResponseFacade } from "./response-facade";
import type { YandexFunctionHttpResponse } from "./response";
import { serializeResponse } from "./serialize-response";

/**
 * One entry of the in-memory dispatch stack.
 *
 * The stack mirrors the registration order of a platform server (verified
 * against @nestjs/core 11 `NestApplication.init()`): body parsers register
 * before middleware, middleware before routes, and the framework's not-found
 * handler is terminal. The connector only replays this order per invocation —
 * every layer itself is an opaque `(req, res, next)` proxy built by NestJS,
 * which is where guards, interceptors, pipes, filters and status defaults
 * live.
 */
export interface DispatchLayer {
  readonly kind: "middleware" | "route";
  /** Uppercase verb for routes (`"*"` for `@All()`), always `"*"` for middleware. */
  readonly method: string;
  readonly pattern: CompiledPathPattern;
  readonly handler: YandexRequestHandler;
}

/**
 * Error-layer proxy as installed by NestJS during init
 * (`RoutesResolver.registerExceptionHandler` → `setErrorHandler`): receives a
 * failure, runs exception filters and writes the mapped response. The
 * connector never inspects or wraps it.
 */
export type ErrorLayerProxy = (
  error: unknown,
  requestFacade: YandexHttpRequestFacade,
  responseFacade: YandexHttpResponseFacade,
  next: () => void,
) => unknown;

export interface DispatchPlan {
  readonly request: NormalizedHttpRequest;
  readonly layers: readonly DispatchLayer[];
  /** Exception-layer proxy registered by Nest during `app.init()`. */
  readonly errorLayer?: ErrorLayerProxy;
  /** Not-found proxy registered by Nest during `app.init()`; terminal. */
  readonly notFoundHandler?: YandexRequestHandler;
}

const JSON_CONTENT_TYPE_PREFIX = "application/json";

function declaresJsonContentType(contentType: string | undefined): boolean {
  return (contentType ?? "").toLowerCase().startsWith(JSON_CONTENT_TYPE_PREFIX);
}

/**
 * Builds the JSON body parser as an ordinary stack layer — the exact role
 * `bodyParser.json()` plays on platform servers (ExpressAdapter registers it
 * through `app.use`). Only `application/json` requests are parsed; other
 * content types stay opaque bytes at the transport boundary (AGENTS.md
 * section 31). Malformed JSON funnels a `SyntaxError` through `next(err)`,
 * which Nest's error layer maps to a deterministic 400 response.
 */
export function createJsonBodyParser(): YandexRequestHandler {
  return (requestFacade, _responseFacade, next) => {
    if (
      requestFacade.rawBody === undefined ||
      !declaresJsonContentType(requestFacade.headers["content-type"])
    ) {
      next();
      return;
    }
    try {
      requestFacade.body = JSON.parse(requestFacade.rawBody.toString("utf8"));
    } catch (error) {
      next(error);
      return;
    }
    next();
  };
}

/**
 * Last-resort wire responses, reached only when no registered layer produced
 * one. After a successful cold start Nest always registers its not-found and
 * error proxies (verified against @nestjs/core 11 `registerRouterHooks`),
 * whose filters emit these exact shapes — the fallbacks exist so that even a
 * broken filter chain yields a deterministic envelope instead of an arbitrary
 * payload to the gateway (AGENTS.md sections 8/11).
 */
function writeLastResortResponse(
  responseFacade: YandexHttpResponseFacade,
  statusCode: number,
  message: string,
): void {
  if (responseFacade.headersSent) {
    // The response already left the adapter; mirroring platform behavior,
    // late failures are not written onto the wire.
    return;
  }
  responseFacade.status(statusCode);
  responseFacade.json({ statusCode, message });
}

function cannotFindMessage(method: string, path: string): string {
  return `Cannot ${method} ${path}`;
}

function matchesRouteMethod(layerMethod: string, requestMethod: string): boolean {
  // HEAD falls back to GET handlers when no explicit HEAD route matched
  // earlier in the scan — the one piece of router semantics express performs
  // internally that Nest does not provide to custom adapters.
  return (
    layerMethod === "*" ||
    layerMethod === requestMethod ||
    (requestMethod === "HEAD" && layerMethod === "GET")
  );
}

/**
 * Drives one invocation through the registered stack (issue #6).
 *
 * This is deliberately a miniature of what an HTTP framework's router does —
 * ordered scanning, prefix matching for mounts, full matching with parameter
 * capture for routes, fallthrough via `next()`, and a single error hop —
 * because on a real platform those jobs belong to Express/Fastify, which the
 * connector replaces. Everything above that level happens inside the opaque
 * Nest proxies stored on the layers, not here.
 */
export async function runDispatch(plan: DispatchPlan): Promise<YandexFunctionHttpResponse> {
  const requestFacade = createRequestFacade(plan.request);
  const responseFacade = createResponseFacade();
  const requestPath = plan.request.path;
  const requestMethod = plan.request.method.toUpperCase();

  const respondWithCannotFind = (): void => {
    writeLastResortResponse(responseFacade, 404, cannotFindMessage(requestMethod, requestPath));
  };

  const invokeErrorLayer = async (error: unknown): Promise<void> => {
    if (plan.errorLayer === undefined) {
      writeLastResortResponse(responseFacade, 500, "Internal server error");
      return;
    }
    try {
      await plan.errorLayer(error, requestFacade, responseFacade, () => undefined);
      if (!responseFacade.headersSent) {
        writeLastResortResponse(responseFacade, 500, "Internal server error");
      }
    } catch {
      writeLastResortResponse(responseFacade, 500, "Internal server error");
    }
  };

  const invokeNotFound = async (): Promise<void> => {
    if (plan.notFoundHandler === undefined) {
      respondWithCannotFind();
      return;
    }
    try {
      await plan.notFoundHandler(requestFacade, responseFacade, () => undefined);
      if (!responseFacade.headersSent) {
        respondWithCannotFind();
      }
    } catch {
      respondWithCannotFind();
    }
  };

  let index = -1;

  const advance = async (): Promise<void> => {
    index += 1;
    const layer = plan.layers[index];

    if (layer === undefined) {
      if (!responseFacade.headersSent) {
        await invokeNotFound();
      }
      return;
    }

    if (!matchesRouteMethod(layer.method, requestMethod)) {
      await advance();
      return;
    }

    if (layer.kind === "route") {
      const match = layer.pattern.match(requestPath);
      if (!match.matched) {
        await advance();
        return;
      }
      // Route parameters belong to the matched route only; clearing first
      // keeps stale captures from leaking when falling through later layers
      // (express resets req.params per matched layer).
      for (const key of Object.keys(requestFacade.params)) {
        delete requestFacade.params[key];
      }
      Object.assign(requestFacade.params, match.params);
    } else if (!layer.pattern.matchesPrefix(requestPath)) {
      await advance();
      return;
    }

    let handedOff = false;
    // The layer may call next() synchronously or asynchronously; either way
    // the driver must not serialize until the whole forwarded chain settled.
    let continuation: Promise<void> | undefined;
    const next: (error?: unknown) => void = (error?: unknown) => {
      if (handedOff) {
        throw new Error("next() called multiple times");
      }
      handedOff = true;
      if (error !== undefined && error !== null) {
        continuation = invokeErrorLayer(error);
        return;
      }
      continuation = advance();
    };

    try {
      const outcome = layer.handler(requestFacade, responseFacade, next);
      if (outcome instanceof Promise) {
        await outcome;
      }
      if (continuation !== undefined) {
        await continuation;
      }
    } catch (error) {
      await invokeErrorLayer(error);
    }
  };

  await advance();

  return serializeResponse(responseFacade);
}
