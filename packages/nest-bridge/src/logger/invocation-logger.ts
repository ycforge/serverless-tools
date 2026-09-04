import type { ConnectorError } from "../core/connector-error";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import type { BoundaryLogRecord, BoundaryLogTransport } from "./record";
import { serializeRecord } from "./record";
import type { LogSink } from "./writer";

/**
 * Per-invocation boundary logger (spec 004, FR-005..011; research R3/R4).
 *
 * `createInvocationLogger` produces one stable start/finish/error sequence
 * per invocation, all sharing the invocation's `trace_id`/`awsRequestId`. The
 * logger is the connector's single boundary-logging surface; the core wires
 * it around `transport.invoke` (research R3) so both transports emit
 * identical-shaped records without duplicating logic.
 *
 * Records are structurally safe by construction (FR-009): the logger only
 * ever writes connector-owned values (an id, a transport discriminator, a
 * `ConnectorError` code, an error class name, a status, a duration) and never
 * payload/token/header fragments. Application error text and stack traces are
 * deliberately excluded (FR-007).
 */

/** Context common to every boundary record kind. */
export interface BoundaryLogContext {
  /** Per-invocation correlation id; equal to {@link awsRequestId}. */
  readonly trace_id?: string;
  /** Runtime invocation id; present whenever a normalized context exists. */
  readonly awsRequestId?: string;
  /** Transport discriminator; present once a transport claimed the event. */
  readonly transport?: BoundaryLogTransport;
}

/**
 * Safe, fixed-size boundary logger for one invocation. Failures are detected
 * from a single `error` value; the record distinguishes boundary
 * (`ConnectorError` → stable `code`) from application failures (→ `errorClass`
 * only), never embedding exception text.
 */
export interface InvocationLogger {
  /** Writes the `start` record and begins the elapsed-time window. */
  start(context: BoundaryLogContext & { readonly transport: BoundaryLogTransport }): void;
  /** Writes the `finish` record with `status` and elapsed `durationMs`. */
  finish(context: BoundaryLogContext & {
    readonly transport: BoundaryLogTransport;
    readonly status: number;
  }): void;
  /** Writes the `error` record; see {@link BoundaryLogContext}. */
  error(context: BoundaryLogContext & { readonly error: unknown }): void;
}

/**
 * Creates an invocation logger over the given writer.
 *
 * @param writer the log sink; `createLogWriter()` (stdout) is injected by the
 *   core, a string-array sink by tests.
 */
export function createInvocationLogger(writer: LogSink): InvocationLogger {
  // Elapsed-time window opened by `start`; guarded so pre-`start` boundary
  // errors (detection/bootstrap, research R4) simply omit `durationMs`.
  let invocationStart = 0;

  const emit = (record: BoundaryLogRecord): void => {
    writer.write(serializeRecord(record));
  };

  const durationMs = (): number | undefined => {
    if (invocationStart === 0) {
      return undefined;
    }
    return Math.max(0, performance.now() - invocationStart);
  };

  return {
    start(context) {
      invocationStart = performance.now();
      emit({ event: "start", trace_id: context.trace_id, awsRequestId: context.awsRequestId, transport: context.transport });
    },
    finish(context) {
      emit({
        event: "finish",
        trace_id: context.trace_id,
        awsRequestId: context.awsRequestId,
        transport: context.transport,
        status: context.status,
        durationMs: durationMs(),
      });
    },
    error(context) {
      emit({
        event: "error",
        trace_id: context.trace_id,
        awsRequestId: context.awsRequestId,
        transport: context.transport,
        ...errorFields(context.error),
        durationMs: durationMs(),
      });
    },
  };
}

/**
 * Projects an error onto its safe log fields (FR-007): a `ConnectorError`
 * contributes its stable `code`; any other error contributes only its class
 * name. Exception message text and stack traces are never logged.
 */
function errorFields(error: unknown): { readonly code?: string; readonly errorClass?: string } {
  if (isConnectorError(error)) {
    return { code: error.code };
  }
  const name = error instanceof Error ? error.name : typeof error;
  return { errorClass: name };
}

function isConnectorError(error: unknown): error is ConnectorError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** Convenience view of the normalized context the logger correlates on. */
export function contextFields(executionContext: YandexExecutionContext): {
  readonly trace_id: string;
  readonly awsRequestId: string;
} {
  return {
    trace_id: executionContext.trace_id,
    awsRequestId: executionContext.awsRequestId,
  };
}