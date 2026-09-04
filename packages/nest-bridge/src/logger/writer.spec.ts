import { describe, expect, it, vi } from "vitest";
import { createLogWriter, type LogSink } from "./writer";

/**
 * Log writer contract (spec 004, FR-005/010/011): stdout as the single sink,
 * one newline-terminated write per record, and fail-open behavior so a sink
 * failure never changes the invocation result.
 */

describe("createLogWriter (spec 004, FR-005/010/011)", () => {
  it("defaults to process.stdout with a single newline-terminated write", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      createLogWriter().write('{"event":"start"}');
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith('{"event":"start"}\n');
    } finally {
      write.mockRestore();
    }
  });

  it("writes one complete record per sink call (atomic lines for concurrency)", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };

    createLogWriter(sink).write('{"event":"start"}');

    expect(lines).toEqual(['{"event":"start"}\n']);
  });

  it("is fail-open: a throwing sink never propagates the failure", () => {
    const failingSink: LogSink = {
      write: () => {
        throw new Error("sink is down");
      },
    };

    expect(() => createLogWriter(failingSink).write('{"event":"start"}')).not.toThrow();
  });
});
