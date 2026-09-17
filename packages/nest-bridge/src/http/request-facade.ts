import type { NormalizedHttpRequest } from "./normalized-request";

/**
 * Per-invocation request object handed to NestJS route handlers and
 * middleware (issue #6). It exposes exactly the conventional surface the
 * Nest router pipeline reads (`@Req()`, `@Query()`, `@Param()`, `@Body()`,
 * `@Headers()`, `@Ip()`) — synthesized from the already-normalized HTTP
 * request, never from a real Node socket.
 *
 * `params` starts empty and is filled by the dispatcher when a route matches,
 * mirroring how a platform router populates it.
 */
export interface YandexHttpRequestFacade {
  readonly method: string;
  /** Path plus canonical raw query string, mirroring Express `originalUrl`. */
  readonly url: string;
  readonly originalUrl: string;
  /** Value of the Host header, or an empty string when absent. */
  readonly hostname: string;
  /** Gateway-reported client address (`requestContext.http.sourceIp`). */
  readonly ip: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Parsed once from `rawQueryString` (the canonical representation,
   * AGENTS.md section 4.2): repeated keys become arrays instead of being
   * comma-folded like `queryStringParameters` (AGENTS.md section 4.3).
   */
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  /** Filled by route matching; `{}` until then. */
  params: Record<string, string>;
  /**
   * JSON body when the connector's body parser is enabled and the request
   * declares `application/json`; otherwise left `undefined` — form and other
   * content types are intentionally not auto-parsed (AGENTS.md section 31).
   */
  body?: unknown;
  /** Decoded raw body bytes, present whenever the event carried a body. */
  rawBody?: Buffer;
}

type NextFunction = (error?: unknown) => void;

/**
 * Handler signature shared by middleware, routes and the error layer.
 *
 * Returns are intentionally unconstrained (`unknown`): route proxies handed
 * over by NestJS return arbitrary internal values the connector never reads;
 * responses travel exclusively through the response facade.
 */
export type YandexRequestHandler = (
  request: YandexHttpRequestFacade,
  response: import("./response-facade").YandexHttpResponseFacade,
  next: NextFunction,
) => unknown;

/**
 * Parses the canonical `rawQueryString` into a plain object. Repeated keys
 * keep their multiplicity as arrays; single values stay strings.
 */
export function parseRawQueryString(rawQueryString: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  if (rawQueryString === "") {
    return query;
  }
  // URLSearchParams decodes percent escapes and "+"-spaces exactly like the
  // platform query parsers for the simple cases the gateway produces.
  const searchParams = new URLSearchParams(rawQueryString);
  for (const [key, value] of searchParams) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }
  return query;
}

const JSON_CONTENT_TYPE_PREFIX = "application/json";

/**
 * Whether this request declares a JSON content type; only such bodies are
 * auto-parsed by the transport body parser (form bodies stay unparsed by
 * design, AGENTS.md section 31). Exported for the dispatch pipeline, which
 * owns the parser layer.
 */
export function declaresJsonContentType(contentType: string | undefined): boolean {
  return (contentType ?? "").toLowerCase().startsWith(JSON_CONTENT_TYPE_PREFIX);
}

/**
 * Builds the per-invocation request facade from the normalized transport
 * request. Body bytes follow `isBase64Encoded` exclusively (AGENTS.md
 * section 4.4); JSON content is parsed later by the dispatch pipeline so a
 * malformed body funnels through the error layer exactly like the platform's
 * body parser (`next(err)` semantics), instead of failing the facade build.
 */
export function createRequestFacade(
  normalizedRequest: NormalizedHttpRequest,
): YandexHttpRequestFacade {
  let rawBody: Buffer | undefined;
  if (normalizedRequest.body !== null && normalizedRequest.body.byteLength > 0) {
    rawBody = Buffer.from(normalizedRequest.body);
  }

  // The gateway delivers Pascal-Cased header keys (observed, DATA-ANALYSE.md
  // section B1); platform routers expose them lowercased. The copy keeps the
  // normalized request untouched (transformation over mutation).
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(normalizedRequest.headers)) {
    headers[name.toLowerCase()] = value;
  }

  const pathWithQuery =
    normalizedRequest.rawQueryString === ""
      ? normalizedRequest.path
      : `${normalizedRequest.path}?${normalizedRequest.rawQueryString}`;

  return {
    method: normalizedRequest.method.toUpperCase(),
    url: pathWithQuery,
    originalUrl: pathWithQuery,
    hostname: headers["host"] ?? "",
    ip: normalizedRequest.sourceIp,
    headers,
    query: parseRawQueryString(normalizedRequest.rawQueryString),
    params: {},
    ...(rawBody !== undefined ? { rawBody } : {}),
  };
}
