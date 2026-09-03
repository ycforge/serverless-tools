/**
 * Normalized view over the Yandex Cloud Functions invocation context.
 *
 * Evidence level: **observed** field set documented in AGENTS.md section 5.
 * The full runtime context (including undocumented internals such as `_data`)
 * stays reachable through `raw`; nothing is coerced into more convenient types.
 *
 * One instance exists per invocation and is handed to application code through
 * `@YandexContext()`. It is built identically for HTTP/API Gateway and Message
 * Queue deliveries, so correlation data below does not depend on the transport.
 */
export interface YandexExecutionContext {
  /**
   * Stable per-invocation identifier assigned by the function runtime.
   *
   * This is THE cross-transport correlation id: observed present with identical
   * semantics in 97/97 captured invocations across both HTTP and Message Queue
   * modes (DATA-ANALYSE.md section D). Transport-specific ids (gateway request
   * id, queue message ids) live on their transport's normalized models.
   */
  readonly awsRequestId: string;

  readonly functionName: string;
  readonly functionVersion: string;
  readonly functionFolderId: string;

  /**
   * Observed as a string on the real runtime. Deliberately NOT normalized to
   * a number; a numeric accessor may be added later as an explicit,
   * separately-named field without removing this one (AGENTS.md section 5).
   */
  readonly memoryLimitInMB: string;

  /** Absolute epoch milliseconds at which the invocation deadline passes. */
  readonly deadlineMs: number;

  readonly logGroupName: string;

  /**
   * Function service account IAM token. **Secret**: must never be logged or
   * embedded in diagnostics (AGENTS.md section 6.2); {@link toJSON} redacts it
   * so accidental serialization cannot leak it. Optional because its presence
   * depends on the function's service account configuration; optionality is
   * **inferred**, not observed as absent in captures.
   */
  readonly token?: string;

  /**
   * Trace propagation id injected by the platform when tracing is active
   * (`"<trace>:<span>:<parent>:1"`). Preserved verbatim for correlation
   * (observed: its trace segment matches the HTTP `Uber-Trace-Id` header).
   */
  readonly uberTraceId?: string;

  /**
   * The untouched raw invocation event this context belongs to: the API
   * Gateway v2 payload or the Message Queue trigger delivery, exactly as
   * received (issue #4 escape hatch).
   */
  readonly rawEvent: unknown;

  /**
   * The entire untouched runtime context object, including undocumented
   * fields. Not part of the stable API surface; use for diagnostics and
   * escape hatches only.
   */
  readonly raw: unknown;

  /**
   * Serialization guard: automatic JSON serialization (`JSON.stringify`,
   * log helpers) never emits the IAM token nor the raw payloads — `raw`,
   * `rawEvent` and the runtime context can carry credentials and client
   * headers such as `Authorization`/`Cookie` (AGENTS.md section 6.2).
   * Explicit property access remains available for advanced use cases.
   */
  toJSON(): Record<string, unknown>;
}
