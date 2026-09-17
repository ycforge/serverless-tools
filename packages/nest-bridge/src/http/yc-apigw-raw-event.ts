/**
 * Raw Yandex API Gateway HTTP event in the format delivered by the
 * `cloud_functions` integration to the function (spec 036).
 *
 * Evidence level: **observed** — mirrors sanitized captures from the real
 * gateway (fixtures/http-apigw/, spec 036; 7 invocations captured on
 * 2026-09-17). This format is distinctly v1-style: there is NO `version`
 * field, no `rawPath`/`rawQueryString`, no `requestContext.http` — the
 * request metadata lives in `requestContext.identity`, wall-clock data in
 * `requestTime`/`requestTimeEpoch`, and the full request target in `url`.
 *
 * Field names stay verbatim (including the un-documented-but-observed
 * `url`, `params`, `multiValueParams` and `pathParams`) so `raw` remains a
 * faithful record of what Yandex sent; do not "clean up" names here.
 *
 * Index signatures keep additive future fields accessible instead of
 * discarding them (AGENTS.md section 36).
 */

/** Gateway-injected request metadata block of the observed v1 event. */
export interface YcApiGatewayRequestContext {
  identity: {
    sourceIp: string;
    userAgent: string;
  };

  httpMethod: string;
  requestId: string;

  /**
   * Human-readable wall-clock string in the gateway's own format, e.g.
   * `17/Sep/2026:04:19:34 +0000` (parsing it is NOT required).
   */
  requestTime: string;

  /** Epoch seconds despite the name (matches the v2 `timeEpoch` semantics). */
  requestTimeEpoch: number;

  [key: string]: unknown;
}

export interface YcApiGatewayEvent {
  httpMethod: string;
  path: string;

  /**
   * Full request target including the query string (and a trailing `?` when
   * the query is empty, observed). Canonical source for `rawQueryString`.
   */
  url?: string;

  headers: Record<string, string>;

  /** Empty bodiless requests are observed as `body: ""` with isBase64Encoded. */
  body: string;
  isBase64Encoded: boolean;

  queryStringParameters: Record<string, string>;

  requestContext: YcApiGatewayRequestContext;

  multiValueHeaders?: Record<string, string[]>;
  multiValueQueryStringParameters?: Record<string, string[]>;
  params?: Record<string, string>;
  multiValueParams?: Record<string, string[]>;
  pathParams?: Record<string, string>;
  operationId?: string;

  [key: string]: unknown;
}