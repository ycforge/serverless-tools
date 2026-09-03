/**
 * Raw Yandex API Gateway v2 HTTP event, exactly as delivered to the function.
 *
 * Evidence level: **observed** — this mirrors the captured runtime payload
 * documented in AGENTS.md section 4.1. Field names stay verbatim (including
 * casing) so `raw` remains a faithful record of what Yandex sent; do not
 * "clean up" names here.
 *
 * Index signatures keep additive future fields accessible instead of
 * discarding them (AGENTS.md section 36); they intentionally weaken excess
 * property checking for these boundary types only.
 */

/** Gateway-injected request metadata block of the observed event. */
export interface RawHttpApiGatewayV2RequestContext {
  authorizer: Record<string, unknown>;

  http: {
    method: string;
    path: string;
    sourceIp: string;
    userAgent: string;
  };

  requestId: string;
  time: string;
  timeEpoch: number;

  apiGateway?: {
    operationContext?: Record<string, unknown>;
  };

  [key: string]: unknown;
}

export interface RawHttpApiGatewayV2Event {
  version: "2.0";
  rawPath: string;
  rawQueryString: string;

  headers: Record<string, string>;

  /**
   * Repeated query values are comma-joined by the gateway into single strings
   * (observed); multiplicity survives in `multiValueParameters`.
   */
  queryStringParameters: Record<string, string>;

  requestContext: RawHttpApiGatewayV2RequestContext;

  /** Body as delivered; encoding is declared solely by `isBase64Encoded`. */
  body: string;

  isBase64Encoded: boolean;

  pathParameters: Record<string, string>;
  parameters: Record<string, string>;
  multiValueParameters: Record<string, string[]>;

  operationId: string;

  [key: string]: unknown;
}
