import type { YandexExecutionContext } from "./yandex-execution-context";

/**
 * Placeholder substituted for the service account IAM token by
 * {@link YandexExecutionContext.toJSON}; matches the redaction convention of
 * AGENTS.md section 6.3.
 */
const REDACTED_TOKEN = "REDACTED_TOKEN";

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
): YandexExecutionContext {
  const source = requireContextObject(rawContext);
  const token = readOptionalString(source, "token");
  const uberTraceId = readOptionalString(source, "uberTraceId");

  const executionContext: YandexExecutionContext = Object.freeze({
    awsRequestId: readRequiredString(source, "awsRequestId"),
    functionName: readRequiredString(source, "functionName"),
    functionVersion: readRequiredString(source, "functionVersion"),
    functionFolderId: readRequiredString(source, "functionFolderId"),
    // Observed as string ("1024"); a number must fail loudly, never coerce.
    memoryLimitInMB: readRequiredString(source, "memoryLimitInMB"),
    deadlineMs: readRequiredNumber(source, "deadlineMs"),
    logGroupName: readRequiredString(source, "logGroupName"),
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

function requireContextObject(rawContext: unknown): Record<string, unknown> {
  if (typeof rawContext !== "object" || rawContext === null) {
    throw new Error("invalid Yandex Cloud Functions runtime context: expected an object");
  }
  return rawContext as Record<string, unknown>;
}

/**
 * Value-free failure for a violated observed invariant: names only the field
 * and expected type — never the offending value (AGENTS.md section 6.2).
 */
function readRequiredString(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== "string") {
    throw new Error(
      `invalid Yandex Cloud Functions runtime context: expected field "${field}" to be a string`,
    );
  }
  return value;
}

function readRequiredNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== "number") {
    throw new Error(
      `invalid Yandex Cloud Functions runtime context: expected field "${field}" to be a number`,
    );
  }
  return value;
}

function readOptionalString(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  // Presence depends on function configuration (service account, tracing);
  // anything but a string is treated as absent rather than coerced.
  return typeof value === "string" ? value : undefined;
}
