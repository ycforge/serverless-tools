/**
 * Response envelope the function runtime expects from an HTTP invocation.
 *
 * Evidence level: **documented** (Yandex Cloud Functions proxy integration,
 * same contract family as API Gateway v2 responses). The platform rejects
 * envelopes that are not strictly valid JSON (`Malformed serverless function
 * response`), so serialization must stay deterministic.
 */
export interface YandexFunctionHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Multi-value header map, emitted **only** when a handler appended more
   * than one value to the same header (typically multiple `Set-Cookie`
   * lines); single-valued responses keep the exact four-field envelope
   * established before issue #6.
   *
   * Evidence level: **observed** against the live Yandex API Gateway
   * payload-format-2.0 response path (2026-08-22, curl wire inspection).
   * Verified behavior:
   * - the gateway accepts this field on responses;
   * - repeated ordinary headers are joined by the gateway into one
   *   comma-separated wire line;
   * - repeated `set-cookie` values are emitted as separate header lines,
   *   preserving true multiplicity (comma-joining would be lossy — a comma
   *   is legal inside Set-Cookie attributes);
   * - when a name appears in both maps, `multiValueHeaders` wins.
   */
  readonly multiValueHeaders?: Readonly<Record<string, readonly string[]>>;
  /** Body payload encoded according to {@link isBase64Encoded}. */
  readonly body: string;
  readonly isBase64Encoded: boolean;
}
