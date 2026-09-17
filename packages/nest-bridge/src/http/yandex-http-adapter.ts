import { RequestMethod } from "@nestjs/common";
import { AbstractHttpAdapter } from "@nestjs/core";
import type { NormalizedHttpRequest } from "./normalized-request";
import { compilePathPattern } from "./path-matching";
import type { YandexHttpRequestFacade, YandexRequestHandler } from "./request-facade";
import type { YandexHttpResponseFacade } from "./response-facade";
import type { YandexFunctionHttpResponse } from "./response";
import {
  createJsonBodyParser,
  runDispatch,
  type DispatchLayer,
  type ErrorLayerProxy,
} from "./dispatch-pipeline";

/**
 * Route arguments accepted by every verb registrar: either `(path, handler)`
 * or bare `(handler)` (root path), mirroring the base SPI overloads.
 */
type RouteArgs = [handler: YandexRequestHandler] | [path: string, handler: YandexRequestHandler];

function splitRouteArgs(args: RouteArgs): [path: string, handler: YandexRequestHandler] {
  if (args.length === 2) {
    return [args[0], args[1]];
  }
  return ["/", args[0]];
}

/**
 * In-memory HTTP adapter over which the connector bootstraps NestJS
 * (`NestFactory.create(AppModule, adapter)`), replacing the platform HTTP
 * server without pulling in Express or opening sockets.
 *
 * The adapter is intentionally thin: during cold start it only *records* the
 * layers Nest registers through the transport SPI (body parser via
 * {@linkcode registerParserMiddleware}, middleware via
 * {@linkcode createMiddlewareFactory}/`use`, routes via the verb methods, and
 * the terminal not-found/error proxies via `setNotFoundHandler`/
 * `setErrorHandler`). Every recorded layer is an opaque `(req, res, next)`
 * proxy built by NestJS, so routing decisions, guards, interceptors, pipes,
 * filters, status defaults and exception mapping remain framework semantics.
 * Per invocation {@linkcode dispatch} replays the recorded order through
 * {@link runDispatch} — the small router role express would otherwise play.
 *
 * Per AGENTS.md section 11 nothing invocation-specific lives on the adapter —
 * request/response state is created per dispatch — so one instance per
 * created handler is safe across warm and concurrent invocations.
 */
export class YandexHttpAdapter extends AbstractHttpAdapter<
  undefined,
  YandexHttpRequestFacade,
  YandexHttpResponseFacade
> {
  private readonly stack: DispatchLayer[] = [];

  private errorHandler: ErrorLayerProxy | undefined;
  private notFoundHandler: YandexRequestHandler | undefined;

  /** Runs one normalized gateway request through the recorded layer stack. */
  dispatch(normalizedRequest: NormalizedHttpRequest): Promise<YandexFunctionHttpResponse> {
    return runDispatch({
      request: normalizedRequest,
      layers: this.stack,
      errorLayer: this.errorHandler,
      notFoundHandler: this.notFoundHandler,
    });
  }

  // ---------------------------------------------------------------------------
  // Server lifecycle: a cloud function never listens on a socket.
  // ---------------------------------------------------------------------------

  override async initHttpServer(): Promise<void> {}

  override async close(): Promise<void> {}

  override listen(): never {
    throw new Error(
      "YandexHttpAdapter cannot listen on a port: Yandex Cloud Functions invokes the handler directly",
    );
  }

  override getHttpServer(): undefined {
    return undefined;
  }

  override setHttpServer(): void {}

  override getType(): string {
    return "yandex-api-gateway-v2";
  }

  // ---------------------------------------------------------------------------
  // Unsupported platform features fail fast at cold start.
  // ---------------------------------------------------------------------------

  override useStaticAssets(): never {
    throw new Error("static assets are not supported under Yandex Cloud Functions");
  }

  override setViewEngine(): never {
    throw new Error("server-side view rendering is not supported under Yandex Cloud Functions");
  }

  override render(): never {
    throw new Error("server-side view rendering is not supported under Yandex Cloud Functions");
  }

  override enableCors(): never {
    throw new Error(
      "adapter-level CORS is not supported; configure CORS on the API Gateway instead",
    );
  }

  override applyVersionFilter(): never {
    throw new Error(
      "controller versioning is not supported by the Yandex Cloud Functions connector",
    );
  }

  // ---------------------------------------------------------------------------
  // Request/response accessors consumed by the framework's response
  // controller and exception filters. Pure delegation to the facade.
  // ---------------------------------------------------------------------------

  override getRequestHostname(requestFacade: YandexHttpRequestFacade): string {
    return requestFacade.hostname;
  }

  override getRequestMethod(requestFacade: YandexHttpRequestFacade): string {
    return requestFacade.method;
  }

  override getRequestUrl(requestFacade: YandexHttpRequestFacade): string {
    return requestFacade.url;
  }

  override status(
    responseFacade: YandexHttpResponseFacade,
    statusCode: number,
  ): YandexHttpResponseFacade {
    return responseFacade.status(statusCode);
  }

  override reply(
    responseFacade: YandexHttpResponseFacade,
    body: unknown,
    statusCode?: number,
  ): YandexHttpResponseFacade {
    if (statusCode !== undefined) {
      responseFacade.status(statusCode);
    }
    if (body === undefined || body === null) {
      responseFacade.end();
      return responseFacade;
    }
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      responseFacade.send(body);
    } else {
      responseFacade.json(body);
    }
    return responseFacade;
  }

  override end(responseFacade: YandexHttpResponseFacade, message?: string): void {
    if (message !== undefined) {
      responseFacade.send(message);
      return;
    }
    responseFacade.end();
  }

  override redirect(
    responseFacade: YandexHttpResponseFacade,
    statusCode: number,
    url: string,
  ): void {
    responseFacade.redirect(statusCode, url);
  }

  override isHeadersSent(responseFacade: YandexHttpResponseFacade): boolean {
    return responseFacade.headersSent;
  }

  override getHeader(responseFacade: YandexHttpResponseFacade, name: string): string | undefined {
    return responseFacade.getHeader(name);
  }

  override setHeader(responseFacade: YandexHttpResponseFacade, name: string, value: string): void {
    responseFacade.setHeader(name, value);
  }

  override appendHeader(
    responseFacade: YandexHttpResponseFacade,
    name: string,
    value: string,
  ): void {
    responseFacade.appendHeader(name, value);
  }

  // ---------------------------------------------------------------------------
  // Layer registration: recording only, no routing decisions here.
  // ---------------------------------------------------------------------------

  override registerParserMiddleware(): void {
    // Called once during app.init() (with global-prefix and rawBody arguments
    // the connector does not accept; see below). Joins the stack at its
    // registration position, exactly like platform parsers registered through
    // `app.use`. Mount prefixes do not exist in the serverless envelope and
    // raw-body re-exposure is not supported, so both are deliberately
    // unimplemented rather than silently misapplied.
    this.stack.push({
      kind: "middleware",
      method: "*",
      pattern: compilePathPattern("/"),
      handler: createJsonBodyParser(),
    });
  }

  override setErrorHandler(handler: ErrorLayerProxy): void {
    // The optional mount-prefix argument is not implemented: responses are
    // always global on this adapter.
    this.errorHandler = handler;
  }

  override setNotFoundHandler(handler: YandexRequestHandler): void {
    this.notFoundHandler = handler;
  }

  override createMiddlewareFactory(): (
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- mirrors the platform SPI declaration; see below
    callback: Function,
  ) => void {
    // Method gating for method-scoped middleware happens inside Nest's own
    // wrapper (verified against @nestjs/core 11 MiddlewareModule), so every
    // entry lands in the same ordered chain regardless of its verb.
    //
    // The `Function` parameter mirrors the platform SPI declaration verbatim;
    // narrowing it is impossible because the base type compares the returned
    // registrar strictly against `callback: Function`. Every value crossing
    // here comes from Nest's middleware proxies, which share the connector's
    // (req, res, next) contract, so the conversion below is safe by
    // construction.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    return (path, callback: Function): void => {
      this.addMiddleware(path, callback as unknown as YandexRequestHandler);
    };
  }

  override use(...args: unknown[]): void {
    const [first, second] = args;
    if (typeof first === "string") {
      this.addMiddleware(first, second as YandexRequestHandler);
      return;
    }
    this.addMiddleware("/", first as YandexRequestHandler);
  }

  private addMiddleware(path: string, handler: YandexRequestHandler): void {
    if (typeof handler !== "function") {
      throw new Error("middleware registration requires a handler");
    }
    this.stack.push({
      kind: "middleware",
      method: "*",
      pattern: compilePathPattern(path),
      handler,
    });
  }

  private addRoute(method: RequestMethod, args: RouteArgs): void {
    const [path, handler] = splitRouteArgs(args);
    if (typeof handler !== "function") {
      throw new Error(`route registration for "${method}" requires a handler`);
    }
    this.stack.push({
      kind: "route",
      method: method === RequestMethod.ALL ? "*" : RequestMethod[method],
      pattern: compilePathPattern(path),
      handler,
    });
  }

  // Every verb below is part of the transport SPI: Nest resolves them by name
  // at cold start (RouterMethodFactory) to install its per-route proxies, so
  // each override records the proxy verbatim and defers entirely to the
  // framework.

  override get(...args: RouteArgs): void {
    this.addRoute(RequestMethod.GET, args);
  }

  override post(...args: RouteArgs): void {
    this.addRoute(RequestMethod.POST, args);
  }

  override put(...args: RouteArgs): void {
    this.addRoute(RequestMethod.PUT, args);
  }

  override delete(...args: RouteArgs): void {
    this.addRoute(RequestMethod.DELETE, args);
  }

  override patch(...args: RouteArgs): void {
    this.addRoute(RequestMethod.PATCH, args);
  }

  override options(...args: RouteArgs): void {
    this.addRoute(RequestMethod.OPTIONS, args);
  }

  override head(...args: RouteArgs): void {
    this.addRoute(RequestMethod.HEAD, args);
  }

  override search(...args: RouteArgs): void {
    this.addRoute(RequestMethod.SEARCH, args);
  }

  override query(...args: RouteArgs): void {
    this.addRoute(RequestMethod.QUERY, args);
  }

  override propfind(...args: RouteArgs): void {
    this.addRoute(RequestMethod.PROPFIND, args);
  }

  override proppatch(...args: RouteArgs): void {
    this.addRoute(RequestMethod.PROPPATCH, args);
  }

  override mkcol(...args: RouteArgs): void {
    this.addRoute(RequestMethod.MKCOL, args);
  }

  override copy(...args: RouteArgs): void {
    this.addRoute(RequestMethod.COPY, args);
  }

  override move(...args: RouteArgs): void {
    this.addRoute(RequestMethod.MOVE, args);
  }

  override lock(...args: RouteArgs): void {
    this.addRoute(RequestMethod.LOCK, args);
  }

  override unlock(...args: RouteArgs): void {
    this.addRoute(RequestMethod.UNLOCK, args);
  }

  override all(...args: RouteArgs): void {
    this.addRoute(RequestMethod.ALL, args);
  }
}
