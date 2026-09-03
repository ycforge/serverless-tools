import type { TransportId } from "./transport";

/**
 * Error codes reserved at the invocation boundary (issue #10 defines their
 * unified failure semantics). They must carry one of these codes so
 * applications can branch on stable identifiers instead of messages.
 *
 * Every invocation failure belongs to exactly one of three failure classes:
 *
 * 1. **Transport / invocation validation** — the raw event or context could
 *    not be claimed or structurally validated, or a route registration lies
 *    outside the documented matching subset. Codes:
 *    `UNKNOWN_INVOCATION_EVENT`, `INVALID_INVOCATION_EVENT`,
 *    `UNSUPPORTED_ROUTE_PATTERN`.
 * 2. **Message Queue payload deserialization** — a queue message body could
 *    not be decoded under the configured body strategy when the application
 *    first reads the payload. Codes: `QUEUE_BODY_DESERIALIZATION_FAILED`
 *    (default strict-JSON policy; custom strategies propagate their own
 *    errors verbatim into the consuming handler round).
 * 3. **Application handler failure** — user code failed. These are NEVER
 *    `ConnectorError`s and are never wrapped or converted: HTTP maps them
 *    through NestJS exception filters onto deterministic responses, Message
 *    Queue propagates them verbatim so retry/dead-letter configuration stays
 *    effective (docs/ARCHITECTURE.md section 6).
 *
 * Boundary rule: `error instanceof ConnectorError` identifies an expected
 * boundary failure raised by this package; any other error escaping an
 * invocation originates in application code and is propagated untouched.
 */
export type ConnectorErrorCode =
  | "UNKNOWN_INVOCATION_EVENT"
  | "INVALID_INVOCATION_EVENT"
  | "UNSUPPORTED_ROUTE_PATTERN"
  | "NO_QUEUE_HANDLER"
  | "QUEUE_BODY_DESERIALIZATION_FAILED";

/**
 * Diagnostic detail attached to boundary errors. Values must never contain
 * credentials or client-sensitive data (AGENTS.md section 6): diagnostics
 * carry field names, expected types and transport ids only — never payload
 * fragments, header values, tokens, cookies or exception message text.
 */
export interface ConnectorErrorDetail {
  readonly code: ConnectorErrorCode;
  /** Transport whose validation failed; absent when no transport claimed the event. */
  readonly transportId?: TransportId;
}
