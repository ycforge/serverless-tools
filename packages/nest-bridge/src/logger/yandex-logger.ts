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
 */
import { Injectable, Optional } from "@nestjs/common";
import { resolveInvocationExecutionContext } from "../context/invocation-scope";
import { redactForLogging } from "./redact";
import { createLogWriter, type LogSink } from "./writer";

/** Supported provider levels, low to high. */
export type YandexLogLevel = "debug" | "info" | "warn" | "error";

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
 * The connector's public logger provider.
 *
 * The sink is resolved internally (default `process.stdout`); the public
 * surface is the DI-injectable `YandexLogger` class only — no separate sink
 * configuration in v1 (contract §4 Assumptions).
 */
@Injectable()
export class YandexLogger {
  private readonly writer: LogSink;

  constructor(@Optional() writer?: LogSink) {
    // `@Optional()` keeps Nest DI from failing to resolve the internal `LogSink`
    // token (it is never provider-registered); the public surface injects only
    // the `YandexLogger` class. `writer ?? createLogWriter()` keeps direct
    // instantiation (and unit tests) usable without a Nest container.
    this.writer = writer ?? createLogWriter();
  }

  debug(message: string, context?: unknown): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: unknown): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: unknown): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: unknown): void {
    this.write("error", message, context);
  }

  private write(level: YandexLogLevel, message: string, context?: unknown): void {
    this.writer.write(this.serialize(level, message, context));
  }

  /**
   * Builds the record line. Scope resolution is fail-open: outside an
   * invocation the correlation fields are omitted and never throw (FR-013).
   */
  private serialize(level: YandexLogLevel, message: string, context?: unknown): string {
    const record: YandexLogRecord & {
      trace_id?: string;
      awsRequestId?: string;
      context?: unknown;
    } = { level, message };
    try {
      const invocation = resolveInvocationExecutionContext();
      record.trace_id = invocation.trace_id;
      record.awsRequestId = invocation.awsRequestId;
    } catch {
      // No live invocation scope: proceed without correlation fields.
    }
    if (context !== undefined) {
      const redacted = redactForLogging(context);
      if (redacted !== undefined) {
        record.context = redacted;
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