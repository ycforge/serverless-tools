/**
 * Unit tests for the `YandexLogger` provider (spec 004, FR-012..015; US4/AC1-3).
 *
 * Verifies levels, automatic trace_id/awsRequestId injection from the
 * invocation scope, fail-open behavior outside a scope, and secret redaction
 * of user `context` (FR-014). All records are captured on an in-memory sink.
 */
import { runInInvocationScope } from "../context/invocation-scope";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { REDACTED_VALUE } from "./redact";
import { YandexLogger } from "./yandex-logger";

function makeScopeContext(overrides: Partial<YandexExecutionContext> = {}): YandexExecutionContext {
  return {
    awsRequestId: "unit-trace-id-1",
    functionName: "fn",
    functionVersion: "$LATEST",
    functionFolderId: "folder",
    memoryLimitInMB: "1024",
    deadlineMs: 1787328996791,
    logGroupName: "",
    trace_id: "unit-trace-id-1",
    rawEvent: {},
    raw: {},
    toJSON: () => ({}),
    ...overrides,
  } as YandexExecutionContext;
}

type CapturedLine = Record<string, unknown>;

function captureLogger(): { logger: YandexLogger; lines: () => CapturedLine[] } {
  const received: string[] = [];
  const sink = { write: (line: string) => received.push(line) };
  const logger = new YandexLogger(sink);
  return { logger, lines: () => received.map((line) => JSON.parse(line)) };
}

describe("YandexLogger (spec 004, FR-012..015)", () => {
  it("writes debug/info/warn/error records with the requested level", async () => {
    const { logger, lines } = captureLogger();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const records = lines();
    expect(records.map((r) => r.level)).toEqual(["debug", "info", "warn", "error"]);
    expect(records.map((r) => r.message)).toEqual(["d", "i", "w", "e"]);
  });

  it("automatically carries trace_id/awsRequestId from the invocation scope", async () => {
    const { logger, lines } = captureLogger();
    await runInInvocationScope({ executionContext: makeScopeContext() }, async () => {
      logger.info("inside scope");
    });
    const record = lines()[0]!;
    expect(record.level).toBe("info");
    expect(record.trace_id).toBe("unit-trace-id-1");
    expect(record.awsRequestId).toBe("unit-trace-id-1");
  });

  it("outside an invocation scope logs without throwing and omits trace fields", async () => {
    const { logger, lines } = captureLogger();
    expect(() => logger.info("outside scope")).not.toThrow();
    const record = lines()[0]!;
    expect(record.message).toBe("outside scope");
    expect(record.trace_id).toBeUndefined();
    expect(record.awsRequestId).toBeUndefined();
  });

  it("redacts token/authorization/cookie keys in user context (FR-014)", async () => {
    const { logger, lines } = captureLogger();
    await runInInvocationScope({ executionContext: makeScopeContext() }, async () => {
      logger.info("with secrets", {
        token: "iam-secret",
        authorization: "Bearer secret-bearer",
        cookie: "session=secret",
        ok: 42,
        nested: { token: "deep-secret", keep: "kept" },
      });
    });
    const record = lines()[0]!;
    const context = record.context as Record<string, unknown>;
    expect(context.token).toBe(REDACTED_VALUE);
    expect(context.authorization).toBe(REDACTED_VALUE);
    expect(context.cookie).toBe(REDACTED_VALUE);
    expect(context.ok).toBe(42);
    const nested = context.nested as Record<string, unknown>;
    expect(nested.token).toBe(REDACTED_VALUE);
    expect(nested.keep).toBe("kept");
  });

  it("omits the context key when no context is supplied", async () => {
    const { logger, lines } = captureLogger();
    logger.warn("bare");
    const record = lines()[0]!;
    expect(record).not.toHaveProperty("context");
  });
});