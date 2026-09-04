import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./connector-error";
import { createInvocationRuntime, type ClosableYandexCloudFunctionHandler } from "./create-yandex-handler";
import type { TransportAdapter, TransportId } from "./transport";

/**
 * Boundary logging on error paths (spec 004, FR-007/008; edge case 1; research
 * R4). Every boundary failure emits an `error` record: `ConnectorError` →
 * stable `code`; application failure → `errorClass` only, never exception
 * text; pre-scope failures (UNKNOWN invocation, bootstrap) → tolerant
 * `trace_id` when the runtime context exposes it, otherwise omitted.
 */

class ErrorModule {}

Module({})(ErrorModule);

function failingTransport(
  id: TransportId,
  claimedKind: string,
  failure: unknown,
): TransportAdapter {
  return {
    id,
    supports(rawEvent): rawEvent is object {
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        (rawEvent as { kind?: unknown }).kind === claimedKind
      );
    },
    invoke: () => Promise.reject(failure),
  };
}

function collectingTransport(
  id: TransportId,
  claimedKind: string,
  onInvoke: (error: unknown) => void,
): TransportAdapter {
  return {
    id,
    supports(rawEvent): rawEvent is object {
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        (rawEvent as { kind?: unknown }).kind === claimedKind
      );
    },
    invoke: (invocation) => {
      onInvoke(invocation.executionContext.awsRequestId);
      return Promise.resolve({ statusCode: 200 });
    },
  };
}

type ParsedLine = Record<string, unknown>;
function recordsOf(mock: { mock: { calls: unknown[][] } }): ParsedLine[] {
  return mock.mock.calls
    .map(([arg]) => arg)
    .filter((arg): arg is string => typeof arg === "string")
    // Filter the framework's own non-structured stdout noise (`[Nest] ...`
    // bootstrap lines) so only connector boundary records are parsed.
    .filter((raw) => raw.startsWith("{"))
    .map((raw) => JSON.parse(raw) as ParsedLine)
    .filter((record) => typeof record["event"] === "string");
}

/** The single record matching the predicate, or an explicit test failure. */
function expectRecord(
  mock: { mock: { calls: unknown[][] } },
  predicate: (record: ParsedLine) => boolean,
): ParsedLine {
  const found = recordsOf(mock).find(predicate);
  expect(found).toBeDefined();
  return found as ParsedLine;
}

const RUNTIME_CONTEXT = {
  awsRequestId: "11111111-2222-4333-8444-555555555555",
  functionName: "fn-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

describe("boundary logging — error paths (spec 004, FR-007/008)", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  it("emits an error record with the stable code for UNKNOWN_INVOCATION_EVENT", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // No transport claims an unrelated event shape.
    const runtime = createInvocationRuntime(ErrorModule, [
      failingTransport("http", "api-gateway-v2", new Error("unused")),
    ]);
    runtimes.push(runtime);
    try {
      const ctx = { ...RUNTIME_CONTEXT, awsRequestId: "unknown-1" };
      await expect(runtime({ kind: "unclaimed" }, ctx)).rejects.toBeInstanceOf(ConnectorError);

      // Correlate on this invocation's own id (SC-003) so records emitted by
      // invocations running in parallel test files never pollute assertions.
      const errorRecord = expectRecord(stdout, (record) => record["trace_id"] === "unknown-1");
      expect(errorRecord["event"]).toBe("error");
      expect(errorRecord["code"]).toBe("UNKNOWN_INVOCATION_EVENT");
      // Tolerant id: the runtime context is reachable, so it is attached.
      expect(errorRecord["trace_id"]).toBe("unknown-1");
    } finally {
      stdout.mockRestore();
    }
  });

  it("omits trace_id/awsRequestId when the runtime context exposes no id (edge case 1)", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const runtime = createInvocationRuntime(ErrorModule, [
      failingTransport("http", "api-gateway-v2", new Error("unused")),
    ]);
    runtimes.push(runtime);
    try {
      // Context object without awsRequestId — the tolerant read returns nothing.
      await expect(runtime({ kind: "unclaimed" }, {})).rejects.toBeInstanceOf(ConnectorError);

      const errorRecord = expectRecord(
        stdout,
        (record) => record["code"] === "UNKNOWN_INVOCATION_EVENT",
      );
      expect(errorRecord["event"]).toBe("error");
      expect(errorRecord["trace_id"]).toBeUndefined();
      expect(errorRecord["awsRequestId"]).toBeUndefined();
    } finally {
      stdout.mockRestore();
    }
  });

  it("emits an error record with only the error class name for an application failure", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const handlerBoom = new Error("handler-boom");
    const runtime = createInvocationRuntime(
      ErrorModule,
      [failingTransport("http", "api-gateway-v2", handlerBoom)],
    );
    runtimes.push(runtime);
    try {
      const ctx = { ...RUNTIME_CONTEXT, awsRequestId: "app-fail-1" };
      await expect(runtime({ kind: "api-gateway-v2" }, ctx)).rejects.toBe(handlerBoom);

      const errorRecord = expectRecord(
        stdout,
        (record) => record["awsRequestId"] === "app-fail-1" && record["event"] === "error",
      );
      // Error class only — never the message text or a stack trace (FR-007).
      expect(errorRecord["errorClass"]).toBe("Error");
      expect(errorRecord["code"]).toBeUndefined();
      expect(errorRecord["message"]).toBeUndefined();
      expect(errorRecord["trace_id"]).toBe("app-fail-1");
      expect(JSON.stringify(errorRecord)).not.toContain("handler-boom");
    } finally {
      stdout.mockRestore();
    }
  });

  it("writes an error record carrying its stable code for a boundary failure in invoke", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const boundaryFailure = ConnectorError.unknownInvocationEvent();
    const runtime = createInvocationRuntime(
      ErrorModule,
      [failingTransport("http", "api-gateway-v2", boundaryFailure)],
    );
    runtimes.push(runtime);
    try {
      const ctx = { ...RUNTIME_CONTEXT, awsRequestId: "boundary-fail-1" };
      await expect(runtime({ kind: "api-gateway-v2" }, ctx)).rejects.toBe(boundaryFailure);

      const errorRecord = expectRecord(
        stdout,
        (record) => record["awsRequestId"] === "boundary-fail-1" && record["event"] === "error",
      );
      expect(errorRecord["event"]).toBe("error");
      expect(errorRecord["code"]).toBe("UNKNOWN_INVOCATION_EVENT");
      expect(errorRecord["errorClass"]).toBeUndefined();
      expect(errorRecord["transport"]).toBe("http");
      expect(errorRecord["trace_id"]).toBe("boundary-fail-1");
      expect(typeof errorRecord["durationMs"]).toBe("number");
    } finally {
      stdout.mockRestore();
    }
  });

  it("writes a bootstrap error record without trace info when the app fails on cold start", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Force the cold-start `NestFactory.create` to fail once.
    const createSpy = vi
      .spyOn(NestFactory, "create")
      .mockRejectedValueOnce(new Error("cold-start-boom"));
    const runtime = createInvocationRuntime(ErrorModule, [
      collectingTransport("http", "api-gateway-v2", () => undefined),
    ]);
    runtimes.push(runtime);
    try {
      await expect(runtime({ kind: "api-gateway-v2" }, {})).rejects.toThrow("cold-start-boom");

      const records = recordsOf(stdout).filter((record) => record["event"] === "error");
      // Bootstrap context is not warmed: no execution context exists at all,
      // so a tolerant id cannot be read (edge case 1) and is omitted.
      for (const record of records) {
        expect(record["trace_id"]).toBeUndefined();
        expect(record["awsRequestId"]).toBeUndefined();
        expect(JSON.stringify(record)).not.toContain("cold-start-boom");
      }
    } finally {
      createSpy.mockRestore();
      stdout.mockRestore();
    }
  });
});