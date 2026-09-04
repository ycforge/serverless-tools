/**
 * Log sink boundary for boundary and application log records (spec 004,
 * FR-005/010/011).
 *
 * The connector writes structured logs to **`stdout`** — the single sink; the
 * function runtime gathers stdout into platform logs. `createLogWriter`
 * returns a sink whose `write(line)` emits the record exactly as given plus a
 * trailing newline in ONE call, while remaining fail-open: any sink error is
 * swallowed so logging can never change the transport result of an
 * invocation (FR-010).
 */

/**
 * Destination contract. Defaults to `process.stdout`; injectable so tests can
 * capture records on an in-memory array without touching the public surface.
 */
export interface LogSink {
  /** Receives a complete, newline-terminated line. */
  write(line: string): void;
}

/** Single-write writer over `process.stdout` when no sink is provided. */
const DEFAULT_SINK: LogSink = {
  write(line: string): void {
    process.stdout.write(line);
  },
};

/**
 * Creates the connector's log writer.
 *
 * @param sink optional destination; defaults to `process.stdout`.
 * @returns a fail-open `LogSink` that appends the trailing newline and writes
 *   the whole line in one call, so concurrent invocations never interleave
 *   partial record bytes (FR-011).
 */
export function createLogWriter(sink: LogSink = DEFAULT_SINK): LogSink {
  return {
    write(line: string): void {
      const recordLine = `${line}\n`;
      try {
        sink.write(recordLine);
      } catch {
        // Fail-open (FR-010): logging failures must never surface or change
        // the invocation result.
      }
    },
  };
}