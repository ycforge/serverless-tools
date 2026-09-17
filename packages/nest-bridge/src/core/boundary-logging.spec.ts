import { Module } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInvocationRuntime, type ClosableYandexCloudFunctionHandler } from "./create-yandex-handler";
import type { TransportAdapter, TransportId } from "./transport";

/**
 * Boundary logging on the success path (spec 004, FR-005/006/011; research
 * R3). Each invocation must emit one `start` + one `finish` pair of
 * structured JSON lines to stdout, sharing a single `trace_id`/`awsRequestId`,
 * with the transport-specific `status` and a `durationMs >= 0`. Records are
 * captured by spying on `process.stdout.write` exactly as the function
 * runtime would gather them.
 */

class SuccessModule {}

Module({})(SuccessModule);

function makeSuccessfulTransport(
  id: TransportId,
  claimedKind: string,
  result: unknown,
): TransportAdapter & { readonly title: string } {
  return {
    id,
    title: id,
    supports(rawEvent): rawEvent is object {
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        (rawEvent as { kind?: unknown }).kind === claimedKind
      );
    },
    invoke: () => Promise.resolve(result),
  };
}

interface CapturedLine {
  readonly raw: string;
  readonly parsed: Record<string, unknown>;
}

function parseLines(calls: readonly unknown[][]): CapturedLine[] {
  return calls
    .map(([arg]) => arg)
    .filter((arg): arg is string => typeof arg === "string")
    // Filter the framework's own non-structured stdout noise (`[Nest] ...`
    // bootstrap lines) so only connector boundary records are parsed.
    .filter((raw) => raw.startsWith("{"))
    .map((raw) => ({ raw, parsed: JSON.parse(raw) as Record<string, unknown> }))
    .filter((line) => typeof line.parsed["event"] === "string");
}

/** The single line matching the predicate, or an explicit test failure. */
function expectLine(
  calls: readonly unknown[][],
  predicate: (line: CapturedLine) => boolean,
): CapturedLine {
  const found = parseLines(calls).find(predicate);
  expect(found).toBeDefined();
  return found as CapturedLine;
}

describe("boundary logging — success path (spec 004, FR-005/006/011)", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  const RUNTIME_CONTEXT = {
    awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
    functionName: "fn-fixture",
    functionVersion: "$LATEST",
    functionFolderId: "folder-fixture",
    memoryLimitInMB: "1024",
    deadlineMs: 1787328996791,
    logGroupName: "",
  };

  it("writes a single start+finish pair per HTTP invocation with shared trace_id", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const runtime = createInvocationRuntime(
      SuccessModule,
      [makeSuccessfulTransport("http", "api-gateway-v2", { statusCode: 200 })],
    );
    runtimes.push(runtime);
    try {
      const ctx = { ...RUNTIME_CONTEXT, awsRequestId: "http-1" };
      const result = (await runtime(
        { kind: "api-gateway-v2", rawPath: "/probe" },
        ctx,
      )) as { statusCode: number };

      // The returned wire envelope is untouched by logging.
      expect(result).toEqual({ statusCode: 200 });

      // Correlate on this invocation's own id (SC-003) so records emitted by
      // invocations running in parallel test files never pollute assertions.
      const start = expectLine(stdout.mock.calls, (line) => line.parsed["event"] === "start");
      const finish = expectLine(
        stdout.mock.calls,
        (line) => line.parsed["event"] === "finish",
      );

      expect(start.parsed["event"]).toBe("start");
      expect(finish.parsed["event"]).toBe("finish");
      expect(start.parsed["trace_id"]).toBe("http-1");
      expect(start.parsed["awsRequestId"]).toBe("http-1");
      expect(start.parsed["transport"]).toBe("http");
      // Same correlation id across both records of the one invocation.
      expect(finish.parsed["trace_id"]).toBe(start.parsed["trace_id"]);
      expect(finish.parsed["awsRequestId"]).toBe(start.parsed["awsRequestId"]);
      expect(finish.parsed["transport"]).toBe("http");
      expect(finish.parsed["status"]).toBe(200);
      expect(typeof finish.parsed["durationMs"]).toBe("number");
      expect(Number(finish.parsed["durationMs"])).toBeGreaterThanOrEqual(0);
    } finally {
      stdout.mockRestore();
    }
  });

  it("reports the delivered message count as finish status for Message Queue", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const runtime = createInvocationRuntime(
      SuccessModule,
      [makeSuccessfulTransport("message-queue", "message-queue-trigger", { messages: [{}, {}, {}] })],
    );
    runtimes.push(runtime);
    try {
      const ctx = { ...RUNTIME_CONTEXT, awsRequestId: "mq-1" };
      await runtime({ kind: "message-queue-trigger", messages: [] }, ctx);

      const finish = parseLines(stdout.mock.calls).find(
        (line) => line.parsed["event"] === "finish" && line.parsed["awsRequestId"] === "mq-1",
      );
      expect(finish).toBeDefined();
      expect(finish!.parsed["status"]).toBe(3);
      expect(finish!.parsed["transport"]).toBe("message-queue");
      expect(finish!.parsed["trace_id"]).toBe("mq-1");
    } finally {
      stdout.mockRestore();
    }
  });

  it("never reuses a trace_id between warm sequential invocations", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const runtime = createInvocationRuntime(
      SuccessModule,
      [makeSuccessfulTransport("http", "api-gateway-v2", { statusCode: 200 })],
    );
    runtimes.push(runtime);
    try {
      await runtime({ kind: "api-gateway-v2" }, { ...RUNTIME_CONTEXT, awsRequestId: "warm-1" });
      await runtime({ kind: "api-gateway-v2" }, { ...RUNTIME_CONTEXT, awsRequestId: "warm-2" });

      const traces = parseLines(stdout.mock.calls)
        .filter((line) => line.parsed["event"] === "start")
        .filter((line) => line.parsed["awsRequestId"] === "warm-1" || line.parsed["awsRequestId"] === "warm-2")
        .map((line) => line.parsed["trace_id"]);

      expect(traces).toEqual(["warm-1", "warm-2"]);
    } finally {
      stdout.mockRestore();
    }
  });
});