/**
 * Public application logger provider (spec 004, FR-012..015;
 * `contracts/observability.md` §4).
 *
 * Injected through Nest DI anywhere user code runs (controllers, services,
 * guards) for BOTH transports. Each record is a single structured JSON line
 * written to `stdout` through the same fail-open writer as boundary records
 * (FR-015), and automatically carries the current invocation's
 * `trace_id`/`awsRequestId` from the invocation scope (FR-013). Outside any
 * invocation scope (bootstrap, teardown, module init) those fields are simply
 * absent — logging never throws (FR-013, US4/AC2). User `context` objects pass
 * through the secret redactor so token-like keys never reach the log
 * (FR-014).
 *
 * The class also implements the Nest `LoggerService` interface and is
 * installed as the application logger by default (spec 037): Nest's own
 * bootstrap/route logs and application `new Logger()` calls then become the
 * same structured JSON instead of ANSI-coloured `ConsoleLogger` text.
 *
 * Levels are emitted as the uppercase values Yandex Cloud Logging recognizes
 * (`TRACE/DEBUG/INFO/WARN/ERROR/FATAL`) together with the `message` field, so
 * Cloud Logging assigns the correct severity instead of `TRACE`/UNSPECIFIED.
 */
import { Injectable, Optional, type LoggerService } from "@nestjs/common";
import { resolveInvocationExecutionContext } from "../context/invocation-scope";
import { redactForLogging } from "./redact";
import { createLogWriter, type LogSink } from "./writer";

/** Supported levels, low to high, using the Yandex Cloud Logging vocabulary. */
export type YandexLogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

/** Field order for deterministic provider record serialization. */
const PROVIDER_FIELD_ORDER = [
  "level",
  "trace_id",
  "awsRequestId",
  "message",
  "context",
] as const;

/**
 * One structured application log record.
 *
 * `trace_id`/`awsRequestId` mirror the boundary correlation ids and are
 * injected automatically; `context` is already redacted by the provider.
 */
export interface YandexLogRecord {
  readonly level: YandexLogLevel;
  readonly trace_id?: string;
  readonly awsRequestId?: string;
  readonly message: string;
  readonly context?: unknown;
}

/**
 * Normalizes Nest `LoggerService` variadic params into a single context value:
 * no params → `undefined`; one param (the common `logger.log(msg, 'Context')`
 * shape) → that value; several → the array.
 */
function nestContext(optionalParams: readonly unknown[]): unknown {
  if (optionalParams.length === 0) {
    return undefined;
  }
  if (optionalParams.length === 1) {
    return optionalParams[0];
  }
  return optionalParams;
}

function formatMessage(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Error) {
    return `${message.name}: ${message.message}`;
  }
  try {
    const redacted = redactForLogging(message);
    return JSON.stringify(redacted) ?? String(message);
  } catch {
    return String(message);
  }
}

/**
 * The connector's public logger provider.
 *
 * The sink is resolved internally (default `process.stdout`); the public
 * surface is the DI-injectable `YandexLogger` class only — no separate sink
 * configuration in v1 (contract §4 Assumptions).
 */
@Injectable()
export class YandexLogger implements LoggerService {
  private readonly writer: LogSink;

  constructor(@Optional() writer?: LogSink) {
    // `@Optional()` keeps Nest DI from failing to resolve the internal `LogSink`
    // token (it is never provider-registered); the public surface injects only
    // the `YandexLogger` class. `writer ?? createLogWriter()` keeps direct
    // instantiation (and unit tests) usable without a Nest container.
    this.writer = writer ?? createLogWriter();
  }

  /** Nest `LoggerService.log` — informational. */
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("INFO", message, nestContext(optionalParams));
  }

  /** Backward-compatible alias of {@link log}. */
  info(message: unknown, context?: unknown): void {
    this.write("INFO", message, context);
  }

  /** Nest `LoggerService.error` — error. */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("ERROR", message, nestContext(optionalParams));
  }

  /** Nest `LoggerService.warn` — warning. */
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("WARN", message, nestContext(optionalParams));
  }

  /** Nest `LoggerService.debug` — debug. */
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("DEBUG", message, nestContext(optionalParams));
  }

  /** Nest `LoggerService.verbose` — maps to `TRACE` (there is no VERBOSE level). */
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("TRACE", message, nestContext(optionalParams));
  }

  /** Nest `LoggerService.fatal` — fatal. */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("FATAL", message, nestContext(optionalParams));
  }

  private write(level: YandexLogLevel, message: unknown, context: unknown): void {
    this.writer.write(this.serialize(level, message, context));
  }

  /**
   * Builds the record line. Scope resolution is fail-open: outside an
   * invocation the correlation fields are omitted and never throw (FR-013).
   */
  private serialize(level: YandexLogLevel, message: unknown, context: unknown): string {
    const record: YandexLogRecord & {
      trace_id?: string;
      awsRequestId?: string;
      context?: unknown;
    } = { level, message: formatMessage(message) };
    try {
      const invocation = resolveInvocationExecutionContext();
      record.trace_id = invocation.trace_id;
      record.awsRequestId = invocation.awsRequestId;
    } catch {
      // No live invocation scope: proceed without correlation fields.
    }
    if (context !== undefined) {
      try {
        record.context = redactForLogging(context);
      } catch {
        // Never let redaction break logging (fail-open).
      }
    }
    const serialized: Record<string, unknown> = {};
    for (const field of PROVIDER_FIELD_ORDER) {
      const value = (record as unknown as Record<string, unknown>)[field];
      if (value === undefined) {
        continue;
      }
      serialized[field] = value;
    }
    return JSON.stringify(serialized);
  }
}
