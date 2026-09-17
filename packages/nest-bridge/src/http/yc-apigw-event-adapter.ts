import type { RawHttpApiGatewayV2Event } from "./raw-event";
import type { YcApiGatewayEvent } from "./yc-apigw-raw-event";

/**
 * Adapts a validated API Gateway `cloud_functions` (v1) event to the
 * canonical internal {@link RawHttpApiGatewayV2Event} shape shared with the
 * v2/ALB transport, so both frame formats flow through the SAME
 * `normalizeHttpRequest` pipeline (spec 036 — no duplicated projection
 * logic).
 *
 * Mapping decisions are evidence-driven (7 real gateway invocations captured
 * 2026-09-17; fixtures/http-apigw/):
 *
 * - `path` is the canonical route; the gateway additionally delivers the full
 *   request target in `url` (with a trailing `?` when the query is empty),
 *   which is the faithful source for `rawQueryString` — repeated query
 *   parameters survive there verbatim, unlike `queryStringParameters` where
 *   the gateway collapses repeats (last value wins).
 * - The v1 event has no `requestContext.http` block (that is a v2/ALB
 *   frame). It carries the same data in `identity.{sourceIp,userAgent}` and
 *   top-level `httpMethod`, which this adapter promotes into the canonical
 *   `http` block. The original v1 `requestContext` is spread into the
 *   canonical context so nothing observed is dropped.
 * - Field names differ from the v2 frame: observed `params`,
 *   `multiValueParams` and `pathParams` map onto `parameters`,
 *   `multiValueParameters` and `pathParameters`. Query multiplicity takes
 *   priority in `multiValueParameters` when the gateway populated it.
 *
 * The output object is only a normalization bridge: parameter maps are shared
 * by reference (never copied), matching the "transformation, not mutation"
 * rule of AGENTS.md section 7.3.
 */
export function adaptYcApiGatewayEventToV2(event: YcApiGatewayEvent): RawHttpApiGatewayV2Event {
  return {
    version: "2.0",
    rawPath: event.path,
    rawQueryString: queryStringFromUrl(event.url) ?? serializeQueryString(event),
    headers: event.headers,
    queryStringParameters: event.queryStringParameters,
    multiValueParameters: pickMultiValueParameters(event),
    pathParameters: event.pathParams ?? {},
    parameters: event.params ?? {},
    body: event.body,
    isBase64Encoded: event.isBase64Encoded,
    requestContext: {
      ...event.requestContext,
      authorizer: (event.requestContext.authorizer ?? {}) as Record<string, unknown>,
      http: {
        method: event.httpMethod,
        path: event.path,
        sourceIp: event.requestContext.identity.sourceIp,
        userAgent: event.requestContext.identity.userAgent,
      },
      requestId: event.requestContext.requestId,
      time: event.requestContext.requestTime,
      timeEpoch: event.requestContext.requestTimeEpoch,
    },
    operationId: event.operationId ?? "",
  };
}

/**
 * Extracts the canonical query string from the observed `url` target. A bare
 * trailing `?` (empty query, observed as `/users?`) collapses to `""`;
 * absence of `url` yields `null` and the caller falls back to serialization.
 */
function queryStringFromUrl(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  const questionIndex = url.indexOf("?");
  if (questionIndex < 0) {
    return "";
  }
  return url.slice(questionIndex + 1);
}

/**
 * Deterministic best-effort serialization when `url` is absent: repeated
 * values keep their order via `multiValueQueryStringParameters`, single
 * values fall back to `queryStringParameters`.
 */
function serializeQueryString(event: YcApiGatewayEvent): string {
  const search = new URLSearchParams();
  const multiValues = event.multiValueQueryStringParameters;
  if (multiValues !== undefined && Object.keys(multiValues).length > 0) {
    for (const [key, values] of Object.entries(multiValues)) {
      for (const value of values) {
        search.append(key, value);
      }
    }
  } else {
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      search.append(key, value);
    }
  }
  return search.toString();
}

function hasEntries(record: Record<string, unknown> | undefined): boolean {
  return record !== undefined && Object.keys(record).length > 0;
}

/**
 * Query multiplicity wins over the observed-always-empty `multiValueParams`
 * when the gateway populated `multiValueQueryStringParameters`.
 */
function pickMultiValueParameters(event: YcApiGatewayEvent): Record<string, string[]> {
  if (hasEntries(event.multiValueQueryStringParameters)) {
    return event.multiValueQueryStringParameters!;
  }
  return event.multiValueParams ?? {};
}