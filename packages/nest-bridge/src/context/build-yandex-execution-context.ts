import { randomUUID } from "node:crypto";
import type { YandexExecutionContext } from "./yandex-execution-context";

/**
 * Placeholder substituted for the service account IAM token by
 * {@link YandexExecutionContext.toJSON}; matches the redaction convention of
 * AGENTS.md section 6.3.
 */
const REDACTED_TOKEN = "REDACTED_TOKEN";

/**
 * Options for {@link buildYandexExecutionContext}.
 */
export interface BuildYandexExecutionContextOptions {
  /**
   * Local/test mode: instead of failing loudly on missing or mistyped runtime
   * context fields, synthesize the ones the platform would have provided
   * (`awsRequestId` via `crypto.randomUUID()`, a 15 s deadline, and static
   * local placeholders for the identity fields). The default (`false`) keeps
   * the strict, observed-invariant behavior unchanged.
   */
  readonly tolerant?: boolean;
}

/** Static local placeholders used only in tolerant mode. */
const LOCAL_DEFAULTS = {
  functionName: "local-function",
  functionVersion: "$LATEST",
  functionFolderId: "local-folder",
  memoryLimitInMB: "1024",
  logGroupName: "",
} as const;


/**
 * Builds the normalized {@link YandexExecutionContext} from one invocation's
 * untouched raw event and runtime context (issue #4).
 *
 * The context is produced by the Yandex Cloud Functions platform itself, not
 * by clients; its field set was observed identically in 97/97 captured
 * invocations (DATA-ANALYSE.md section D). The builder therefore narrows with
 * strict type guards instead of coercing: a field that violates its observed
 * type fails the invocation loudly with a value-free diagnostic rather than
 * flowing a silently mistyped value into application code. Optional fields
 * (`token`, `uberTraceId`) are copied only when actually strings.
 *
 * Nothing here mutates or clones the inputs: `raw`/`rawEvent` keep the exact
 * references so additive future fields stay reachable (AGENTS.md sections 7.3
 * and 36).
 */
export function buildYandexExecutionContext(
  rawEvent: unknown,
  rawContext: unknown,
  options: BuildYandexExecutionContextOptions = {},
): YandexExecutionContext {
  const tolerant = options.tolerant === true;
  const source = requireContextObject(rawContext, tolerant);
  const token = readOptionalString(source, "token");
  const uberTraceId = readOptionalString(source, "uberTraceId");
  // trace_id duplicates the observed cross-transport awsRequestId (spec 004,
  // clarify Q1→A): one stable per-invocation id for context, logs and error
  // envelopes. Always present because awsRequestId is required (or synthesized
  // in tolerant mode).
  const awsRequestId = readRequiredString(
    source,
    "awsRequestId",
    tolerant ? randomUUID() : undefined,
  );

  const executionContext: YandexExecutionContext = Object.freeze({
    awsRequestId,
    trace_id: awsRequestId,
    functionName: readRequiredString(source, "functionName", tolerant ? LOCAL_DEFAULTS.functionName : undefined),
    functionVersion: readRequiredString(source, "functionVersion", tolerant ? LOCAL_DEFAULTS.functionVersion : undefined),
    functionFolderId: readRequiredString(source, "functionFolderId", tolerant ? LOCAL_DEFAULTS.functionFolderId : undefined),
    // Observed as string ("1024"); a number must fail loudly, never coerce.
    memoryLimitInMB: readRequiredString(source, "memoryLimitInMB", tolerant ? LOCAL_DEFAULTS.memoryLimitInMB : undefined),
    deadlineMs: readRequiredNumber(source, "deadlineMs", tolerant ? Date.now() + 15_000 : undefined),
    logGroupName: readRequiredString(source, "logGroupName", tolerant ? LOCAL_DEFAULTS.logGroupName : undefined),
    // Optional fields are added only when actually present: absence must stay
    // observable as key absence, not as an undefined-valued property.
    ...(uberTraceId === undefined ? null : { uberTraceId }),
    ...(token === undefined ? null : { token }),
    rawEvent,
    raw: rawContext,

    toJSON(): Record<string, unknown> {
      // Optional fields appear only when present on the runtime context: a
      // redaction placeholder must never imply a token that does not exist,
      // and absent fields stay absent rather than becoming null/undefined.
      const serialized: Record<string, unknown> = {
        awsRequestId: executionContext.awsRequestId,
        trace_id: executionContext.trace_id,
        functionName: executionContext.functionName,
        functionVersion: executionContext.functionVersion,
        functionFolderId: executionContext.functionFolderId,
        memoryLimitInMB: executionContext.memoryLimitInMB,
        deadlineMs: executionContext.deadlineMs,
        logGroupName: executionContext.logGroupName,
      };
      if (executionContext.uberTraceId !== undefined) {
        serialized["uberTraceId"] = executionContext.uberTraceId;
      }
      if (executionContext.token !== undefined) {
        serialized["token"] = REDACTED_TOKEN;
      }
      return serialized;
    },
  });

  return executionContext;
}

function requireContextObject(rawContext: unknown, tolerant = false): Record<string, unknown> {
  if (typeof rawContext !== "object" || rawContext === null) {
    if (tolerant) {
      return {};
    }
    throw new Error("invalid Yandex Cloud Functions runtime context: expected an object");
  }
  return rawContext as Record<string, unknown>;
}

/**
 * Value-free failure for a violated observed invariant: names only the field
 * and expected type — never the offending value (AGENTS.md section 6.2). When
 * `fallback` is provided (tolerant/local mode) a missing or mistyped value is
 * replaced instead of failing.
 */
function readRequiredString(
  source: Record<string, unknown>,
  field: string,
  fallback?: string,
): string {
  const value = source[field];
  if (typeof value === "string") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(
    `invalid Yandex Cloud Functions runtime context: expected field "${field}" to be a string`,
  );
}

function readRequiredNumber(
  source: Record<string, unknown>,
  field: string,
  fallback?: number,
): number {
  const value = source[field];
  if (typeof value === "number") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(
    `invalid Yandex Cloud Functions runtime context: expected field "${field}" to be a number`,
  );
}

function readOptionalString(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  // Presence depends on function configuration (service account, tracing);
  // anything but a string is treated as absent rather than coerced.
  return typeof value === "string" ? value : undefined;
}

/**
 * Tolerant trace id accessor for log records written BEFORE a normalized
 * context is built (spec 004, edge case 1 / UNKNOWN_INVOCATION_EVENT).
 *
 * Unlike {@link buildYandexExecutionContext}, which fails loudly on a violated
 * observed invariant, this reads `awsRequestId` as an optional string without
 * throwing: bootstrap failures and pre-detection boundary errors still get a
 * log record, and the field is simply omitted from the record when the
 * runtime context is unavailable (FR-008).
 */
export function readInvocationTraceId(rawContext: unknown): string | undefined {
  if (typeof rawContext !== "object" || rawContext === null) {
    return undefined;
  }
  return readOptionalString(rawContext as Record<string, unknown>, "awsRequestId");
}
