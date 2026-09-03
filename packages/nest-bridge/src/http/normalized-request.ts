import type { HasRaw } from "../core/raw-access";
import type { RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Normalized application-facing HTTP request derived from a raw API Gateway
 * v2 event. Application code consumes this model; it should not need the raw
 * event except through {@link HasRaw} escape hatches.
 *
 * The normalization rules encoded here are deliberate and preserve every
 * representation the gateway provides without merging them (AGENTS.md
 * sections 4.2–4.4).
 */
export interface NormalizedHttpRequest extends HasRaw<RawHttpApiGatewayV2Event> {
  /** Always `"2.0"` for events claimed by the HTTP transport (observed). */
  readonly httpVersion: "2.0";

  /** HTTP method exactly as received from the gateway; no case coercion. */
  readonly method: string;

  /**
   * Canonical request path, taken from `rawPath`.
   * `requestContext.http.path` is deliberately NOT used: it can reorder query
   * data and normalize differently from the original URI (observed).
   */
  readonly path: string;

  /**
   * Canonical query string exactly as sent by the client, from
   * `rawQueryString`.
   */
  readonly rawQueryString: string;

  /** Parsed view over {@link rawQueryString}; preserves repeated keys with multiplicity. */
  readonly searchParams: URLSearchParams;

  /** Verbatim gateway field: repeated values comma-joined into single strings (observed). */
  readonly queryStringParameters: Readonly<Record<string, string>>;

  /** Verbatim gateway field: repeated values as lists (observed). */
  readonly multiValueParameters: Readonly<Record<string, readonly string[]>>;

  /** Path parameters as provided by the gateway configuration. */
  readonly pathParameters: Readonly<Record<string, string>>;

  /** Single-valued header map; the gateway provides no multi-value headers (observed). */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Client IP from `requestContext.http.sourceIp`, verbatim (**observed**).
   * Personal data: never log it through connector diagnostics (AGENTS.md
   * section 6.2); applications decide whether and how to use it.
   */
  readonly sourceIp: string;

  /** User agent from `requestContext.http.userAgent` (observed; duplicates the User-Agent header). */
  readonly userAgent: string;

  /**
   * Decoded body bytes; decoded according to `event.isBase64Encoded`, never
   * guessed from Content-Type. `null` for empty/absent bodies. Binary-safe:
   * no implicit text or JSON conversion happens here.
   */
  readonly body: Uint8Array | null;

  /** Correlation id from `requestContext.requestId` (AGENTS.md section 33). */
  readonly requestId: string;
}
