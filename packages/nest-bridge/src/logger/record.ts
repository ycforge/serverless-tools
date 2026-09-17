/**
 * Structured boundary log records the connector writes to `stdout` (spec 004,
 * FR-005..011; contracts/observability.md §2).
 *
 * One record is one JSON line: `serializeRecord` emits a stable, documented
 * key order, omits absent optional keys, and never widens the payload the
 * connector controls. Correlation stays transport-neutral through
 * `trace_id`/`awsRequestId`; bootstrap failures that occur before the runtime
 * context is reachable simply omit them (spec 004 edge case 1, FR-008).
 */

/** Stable boundary event kinds; one record per kind per phase. */
export type BoundaryLogEvent = "start" | "finish" | "error";

/** Transport discriminator mirrored from the invocation's claimed transport. */
export type BoundaryLogTransport = "http" | "message-queue";

/**
 * One structured boundary log record.
 *
 * Field notation mirrors the wire format (`contracts/observability.md` §2);
 * every value is connector-owned and safe for logging by construction (no
 * token/header/body/payload fragments, FR-009).
 */
export interface BoundaryLogRecord {
  /** The boundary phase this record describes. */
  readonly event: BoundaryLogEvent;
  /** Per-invocation correlation id (equals `awsRequestId`; FR-001). */
  readonly trace_id?: string;
  /** Runtime invocation id; absent when the context is unreachable (FR-008). */
  readonly awsRequestId?: string;
  /** Transport that claimed the invocation; absent before detection. */
  readonly transport?: BoundaryLogTransport;
  /**
   * Finish: HTTP status code for `http`, or the number of successfully
   * delivered messages for `message-queue` (FR-006).
   */
  readonly status?: number;
  /** Elapsed milliseconds from `start` to this record (FR-006), >= 0. */
  readonly durationMs?: number;
  /** Stable `ConnectorError` code when the invocation failed at a boundary. */
  readonly code?: string;
  /** Error class name only — never text or stack trace (FR-007). */
  readonly errorClass?: string;
  /** Safe structural text; never fragmented payload values (FR-009). */
  readonly message?: string;
}

/** Documentation index of the wire fields; drive deterministic serialization. */
const RECORD_FIELD_ORDER = [
  "event",
  "trace_id",
  "awsRequestId",
  "transport",
  "status",
  "durationMs",
  "code",
  "errorClass",
  "message",
] as const;

/**
 * Serializes a record into exactly one JSON line (FR-005/011): absent
 * optional keys are omitted — absence stays observable as key absence, never
 * a `null`/`undefined` value, mirroring the context `toJSON()` discipline.
 * The output is deterministic so concurrent invocations can never interleave
 * partial fragments of one record (FR-011 is honored at the writer boundary).
 */
export function serializeRecord(record: BoundaryLogRecord): string {
  const serialized: Record<string, unknown> = {};
  for (const field of RECORD_FIELD_ORDER) {
    const value = (record as unknown as Record<string, unknown>)[field];
    if (value === undefined) {
      continue;
    }
    serialized[field] = value;
  }
  return JSON.stringify(serialized);
}