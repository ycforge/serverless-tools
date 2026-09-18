import type { NormalizedHttpRequest } from "./normalized-request";
import type { GatewayScalar, RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Optional normalization controls (spec 036 — API Gateway cloud_functions).
 */
export interface NormalizeHttpRequestOptions {
  /**
   * Declared wire format of the originating event frame. Defaults to `"2.0"`
   * for the existing API Gateway v2/ALB path; the v1 transport branch passes
   * `"1.0"` so `NormalizedHttpRequest.httpVersion` reflects reality instead of
   * a coerced label.
   */
  readonly httpVersion?: "1.0" | "2.0";
  /**
   * What `NormalizedHttpRequest.raw` should point at. Defaults to the event
   * passed in (the canonical internal form). The v1 branch passes the
   * original wire event so applications reach the verbatim gateway payload.
   */
  readonly raw?: unknown;
}

/**
 * Transforms one validated raw API Gateway v2 event into the normalized
 * {@link NormalizedHttpRequest} (issue #5). The v1 (cloud_functions) adapter
 * feeds this same pipeline after adapting its event to the canonical v2
 * shape (spec 036).
 *
 * The rules encoded here are deliberate preservation decisions, not cleanup:
 *
 * - `rawPath`/`rawQueryString` are the canonical URI representation; the same
 *   request's `requestContext.http.path` demonstrably appends trailing `?`,
 *   reorders parameters and rewrites encodings, so it is never consulted
 *   (observed, AGENTS.md section 4.2). For v1 events the adapter maps
 *   `path`/`url` into these fields before this function runs.
 * - `queryStringParameters` (comma-joined repeats) and `multiValueParameters`
 *   (value lists) are incompatible gateway views of the same data and stay
 *   available side by side, unmerged (observed, AGENTS.md sections 4.3 and E2).
 * - Body bytes follow `isBase64Encoded` exclusively — the flag tracks "not
 *   application/json" on the real runtime, including `true` for bodiless GETs,
 *   so decoding must never be guessed from Content-Type (observed, AGENTS.md
 *   section 4.4). Base64 payloads decode straight to bytes, keeping binary
 *   bodies intact.
 * - Headers, cookies and path parameters pass through verbatim: the gateway
 *   provides no multi-value headers and parses nothing on its own — except
 *   that gateway-typed parameter scalars (`number`/`boolean`, materialized
 *   from the OpenAPI schema) are stringified into the HTTP string domain
 *   (spec 038). The untouched event stays reachable through `raw`.
 *
 * Normalization is transformation, not mutation: unchanged maps are shared by
 * reference, while the gateway-typed `pathParameters`/`multiValueParameters`
 * are rebuilt as string maps; additive Yandex fields survive through `raw`
 * (AGENTS.md sections 7.3 and 36).
 */
export function normalizeHttpRequest(
  event: RawHttpApiGatewayV2Event,
  options: NormalizeHttpRequestOptions = {},
): NormalizedHttpRequest {
  // The v1 transport hands its ORIGINAL wire event (a YcApiGatewayEvent) as
  // `raw`; the canonical RawHttpApiGatewayV2Event bound on the interface is
  // the internal form that reachable call sites (v2) always see.
  const raw = (options.raw ?? event) as RawHttpApiGatewayV2Event;
  return Object.freeze({
    raw,
    httpVersion: options.httpVersion ?? "2.0",
    method: event.requestContext.http.method,
    path: event.rawPath,
    rawQueryString: event.rawQueryString,
    searchParams: new URLSearchParams(event.rawQueryString),
    queryStringParameters: event.queryStringParameters,
    multiValueParameters: stringifyScalarListRecord(event.multiValueParameters),
    pathParameters: stringifyScalarRecord(event.pathParameters),
    headers: event.headers,
    body: decodeEventBody(event.body, event.isBase64Encoded),
    sourceIp: event.requestContext.http.sourceIp,
    userAgent: event.requestContext.http.userAgent,
    requestId: event.requestContext.requestId,
  });
}

/**
 * Projects a gateway-typed parameter map into the HTTP string domain.
 *
 * The gateway can materialize a declared parameter's `default` in its JSON
 * type (`number`/`boolean`); HTTP parameters are strings, so `String(v)`
 * restores the wire representation (`1` → `"1"`, `true` → `"true"`). A fresh
 * object is returned — the typed values stay intact in the raw event.
 */
function stringifyScalarRecord(
  source: Readonly<Record<string, GatewayScalar>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

/** Stringifies a gateway-typed multi-value parameter map (spec 038). */
function stringifyScalarListRecord(
  source: Readonly<Record<string, readonly GatewayScalar[]>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(source)) {
    out[key] = values.map((value) => (typeof value === "string" ? value : String(value)));
  }
  return out;
}

/**
 * Decodes the wire body into raw bytes exactly once, strictly following
 * `isBase64Encoded`. Empty payloads collapse to `null`: bodiless requests are
 * observed as `body: ""` with `isBase64Encoded: true`, and applications must
 * be able to distinguish "no body" from a non-empty body (issue #5).
 */
function decodeEventBody(body: string, isBase64Encoded: boolean): Uint8Array | null {
  // Buffers are Uint8Array subclasses; reusing the instance avoids copying
  // potentially large payloads on every invocation.
  const bytes = isBase64Encoded ? Buffer.from(body, "base64") : Buffer.from(body, "utf8");
  return bytes.length === 0 ? null : bytes;
}
