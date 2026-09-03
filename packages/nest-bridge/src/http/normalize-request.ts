import type { NormalizedHttpRequest } from "./normalized-request";
import type { RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Transforms one validated raw API Gateway v2 event into the normalized
 * {@link NormalizedHttpRequest} (issue #5).
 *
 * The rules encoded here are deliberate preservation decisions, not cleanup:
 *
 * - `rawPath`/`rawQueryString` are the canonical URI representation; the same
 *   request's `requestContext.http.path` demonstrably appends trailing `?`,
 *   reorders parameters and rewrites encodings, so it is never consulted
 *   (observed, AGENTS.md section 4.2).
 * - `queryStringParameters` (comma-joined repeats) and `multiValueParameters`
 *   (value lists) are incompatible gateway views of the same data and stay
 *   available side by side, unmerged (observed, AGENTS.md sections 4.3 and E2).
 * - Body bytes follow `isBase64Encoded` exclusively — the flag tracks "not
 *   application/json" on the real runtime, including `true` for bodiless GETs,
 *   so decoding must never be guessed from Content-Type (observed, AGENTS.md
 *   section 4.4). Base64 payloads decode straight to bytes, keeping binary
 *   bodies intact.
 * - Headers, cookies and path parameters pass through verbatim: the gateway
 *   provides no multi-value headers and parses nothing on its own.
 *
 * Normalization is transformation, not mutation: parameter maps are shared by
 * reference with the untouched event reachable through `raw`, so additive
 * Yandex fields survive without copying costs (AGENTS.md sections 7.3 and 36).
 */
export function normalizeHttpRequest(event: RawHttpApiGatewayV2Event): NormalizedHttpRequest {
  return Object.freeze({
    raw: event,
    httpVersion: "2.0",
    method: event.requestContext.http.method,
    path: event.rawPath,
    rawQueryString: event.rawQueryString,
    searchParams: new URLSearchParams(event.rawQueryString),
    queryStringParameters: event.queryStringParameters,
    multiValueParameters: event.multiValueParameters,
    pathParameters: event.pathParameters,
    headers: event.headers,
    body: decodeEventBody(event.body, event.isBase64Encoded),
    sourceIp: event.requestContext.http.sourceIp,
    userAgent: event.requestContext.http.userAgent,
    requestId: event.requestContext.requestId,
  });
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
