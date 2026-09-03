import type { ConnectorErrorCode, ConnectorErrorDetail } from "./errors";
import type { TransportId } from "./transport";

/**
 * Concrete boundary error thrown by the connector runtime.
 *
 * Carries one of the stable {@link ConnectorErrorCode} identifiers so
 * applications can branch on codes instead of messages (AGENTS.md section 8).
 * Messages are composed from structural diagnostics only — never from payload
 * values such as headers, tokens or bodies (AGENTS.md section 6.2).
 *
 * This class is the boundary-vs-application discriminator of the unified
 * failure semantics (issue #10): every `ConnectorError` is an expected
 * transport/validation/deserialization boundary failure, while application
 * handler failures propagate as their original errors — wrapped nowhere,
 * converted to no other shape (docs/ARCHITECTURE.md section 6).
 */
export class ConnectorError extends Error {
  private constructor(
    /** Structured description of the boundary failure; safe for logging. */
    readonly detail: ConnectorErrorDetail,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }

  /** Stable machine-readable identifier; mirrors {@link detail}.code. */
  get code(): ConnectorErrorCode {
    return this.detail.code;
  }

  /** Transport that produced the failure, when one had claimed the event. */
  get transportId(): TransportId | undefined {
    return this.detail.transportId;
  }

  /**
   * No registered transport claimed the invocation event. Thrown by the core
   * detection boundary (docs/ARCHITECTURE.md sections 4 and 6.3); unknown
   * events are never silently treated as HTTP.
   *
   * @param diagnostic optional structural description of the received event
   *   (value-free field names/types only).
   */
  static unknownInvocationEvent(diagnostic?: string): ConnectorError {
    const suffix = diagnostic ? ` (${diagnostic})` : "";
    return new ConnectorError(
      { code: "UNKNOWN_INVOCATION_EVENT" },
      `no registered transport adapter claimed the invocation event${suffix}`,
    );
  }

  /**
   * A transport claimed the event but its deeper structural validation
   * failed (docs/ARCHITECTURE.md section 6.3). Raised by the owning
   * transport's `invoke`, not by the detection boundary itself.
   *
   * @param transportId transport that claimed and rejected the event.
   * @param reason optional value-free explanation of the violated structure.
   */
  static invalidInvocationEvent(transportId: TransportId, reason?: string): ConnectorError {
    const suffix = reason ? `: ${reason}` : "";
    return new ConnectorError(
      { code: "INVALID_INVOCATION_EVENT", transportId },
      `transport "${transportId}" claimed the invocation event but rejected it as structurally invalid${suffix}`,
    );
  }

  /**
   * A route or middleware pattern outside the connector's documented matching
   * subset was registered during cold start. Thrown at registration time so
   * misconfiguration surfaces as a deterministic bootstrap failure instead of
   * silent per-invocation misrouting (docs/ARCHITECTURE.md section 6.1).
   *
   * @param pattern offending path pattern, verbatim.
   * @param reason optional value-free explanation of the unsupported syntax.
   */
  static unsupportedRoutePattern(pattern: string, reason?: string): ConnectorError {
    const suffix = reason ? `: ${reason}` : "";
    return new ConnectorError(
      { code: "UNSUPPORTED_ROUTE_PATTERN" },
      `unsupported route path pattern "${pattern}"${suffix}`,
    );
  }

  /**
   * A Message Queue delivery reached an application without any
   * `@QueueHandler()` registration (issue #8). Failing loudly keeps the
   * delivery visible to Message Queue retry/dead-letter configuration
   * instead of acknowledging messages nobody consumed (AGENTS.md section
   * 8.3); the event itself was valid, so this is deliberately not an
   * invocation-event error.
   */
  static noQueueHandler(): ConnectorError {
    return new ConnectorError(
      { code: "NO_QUEUE_HANDLER", transportId: "message-queue" },
      "the Message Queue transport claimed the delivery but no @QueueHandler() method is registered in the application",
    );
  }

  /**
   * A queue message body could not be decoded under the connector's default
   * JSON deserialization policy (issue #9). Raised when the application first
   * reads {@link QueueMessage.payload}, so it surfaces inside exactly the
   * handler round that consumes the body and propagates as an invocation
   * failure — Message Queue retry/dead-letter configuration observes it
   * (AGENTS.md section 8.2) while normalization of the rest of the delivery
   * stays untouched.
   *
   * The underlying `JSON.parse` diagnostics are deliberately NOT embedded:
   * `SyntaxError` messages can quote fragments of the body, which must never
   * leak into boundary messages (AGENTS.md section 6.2).
   */
  static queueBodyDeserializationFailed(): ConnectorError {
    return new ConnectorError(
      { code: "QUEUE_BODY_DESERIALIZATION_FAILED", transportId: "message-queue" },
      "the queue message body is not valid JSON under the default deserialization policy; decode it explicitly from QueueMessage.body or configure a custom queue body deserializer",
    );
  }
}
