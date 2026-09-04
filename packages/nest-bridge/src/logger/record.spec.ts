import { describe, expect, it } from "vitest";
import { serializeRecord, type BoundaryLogRecord } from "./record";

/**
 * Boundary record serialization contract (spec 004, FR-005/011;
 * contracts/observability.md §2): exactly one JSON line with a stable key
 * order and no `undefined` keys — absence stays observable as key absence.
 */

describe("serializeRecord (spec 004, FR-005/011)", () => {
  it("serializes a finish record to one JSON line with all present fields", () => {
    const record: BoundaryLogRecord = {
      event: "finish",
      trace_id: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      transport: "http",
      status: 200,
      durationMs: 12,
    };

    const line = serializeRecord(record);
    expect(line.endsWith("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({
      event: "finish",
      trace_id: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      transport: "http",
      status: 200,
      durationMs: 12,
    });
  });

  it("omits absent optional keys instead of emitting undefined/null", () => {
    const record: BoundaryLogRecord = { event: "start", trace_id: "id-1" };

    const parsed = JSON.parse(serializeRecord(record)) as Record<string, unknown>;

    expect(parsed).toEqual({ event: "start", trace_id: "id-1" });
    expect(parsed["awsRequestId"]).toBeUndefined();
    expect(parsed["transport"]).toBeUndefined();
    expect(parsed["status"]).toBeUndefined();
    expect(parsed["durationMs"]).toBeUndefined();
  });

  it("emits keys in the documented, deterministic field order", () => {
    const full: BoundaryLogRecord = {
      event: "error",
      trace_id: "id-1",
      awsRequestId: "id-1",
      transport: "message-queue",
      code: "UNKNOWN_INVOCATION_EVENT",
      errorClass: undefined,
      message: "no registered transport adapter claimed the invocation event",
    };

    // Field index must match contracts/observability.md §2 so consumers can
    // rely on a stable column order even when reading raw lines.
    const line = serializeRecord(full);
    expect(line.indexOf('"event"')).toBeLessThan(line.indexOf('"trace_id"'));
    expect(line.indexOf('"trace_id"')).toBeLessThan(line.indexOf('"awsRequestId"'));
    expect(line.indexOf('"awsRequestId"')).toBeLessThan(line.indexOf('"transport"'));
  });

  it("serializes an error record carrying only the connector error code", () => {
    const record: BoundaryLogRecord = {
      event: "error",
      trace_id: "id-1",
      transport: "http",
      code: "UNKNOWN_INVOCATION_EVENT",
      durationMs: 3,
    };

    const parsed = JSON.parse(serializeRecord(record)) as Record<string, unknown>;
    expect(parsed["code"]).toBe("UNKNOWN_INVOCATION_EVENT");
    expect(parsed["errorClass"]).toBeUndefined();
  });
});
