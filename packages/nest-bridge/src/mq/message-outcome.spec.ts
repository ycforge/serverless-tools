import {
  type BatchDispatchResult,
  type MessageOutcome,
  successOutcome,
  failureOutcome,
} from "./message-outcome";

describe("MessageOutcome types", () => {
  it("successOutcome returns success=true with messageId", () => {
    const outcome = successOutcome("msg-123");
    expect(outcome).toEqual({ messageId: "msg-123", success: true });
    expect(outcome.error).toBeUndefined();
  });

  it("failureOutcome returns success=false with sanitized error", () => {
    const outcome = failureOutcome("msg-456", new Error("something broke"));
    expect(outcome.messageId).toBe("msg-456");
    expect(outcome.success).toBe(false);
    expect(outcome.error).toBeDefined();
    expect(outcome.error!.name).toBe("Error");
    expect(outcome.error!.message).toBe("something broke");
  });

  it("failureOutcome sanitizes non-Error throwables", () => {
    const outcome = failureOutcome("msg-789", "string error");
    expect(outcome.error!.name).toBe("Error");
    expect(outcome.error!.message).toBe("string error");
  });

  it("failureOutcome captures custom error class names", () => {
    class ValidationError extends Error {
      constructor() {
        super("validation failed");
        this.name = "ValidationError";
      }
    }
    const outcome = failureOutcome("msg-abc", new ValidationError());
    expect(outcome.error!.name).toBe("ValidationError");
    expect(outcome.error!.message).toBe("validation failed");
  });

  it("outcome never contains payload, token, header, or raw values", () => {
    const outcome = failureOutcome("msg-sec", new Error("leak test"));
    const serialized = JSON.stringify(outcome);
    // No payload-like data should appear in the serialized outcome.
    expect(serialized).not.toContain("body");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("header");
    // Only messageId, success, error.name, error.message are present.
    expect(Object.keys(outcome)).toEqual(["messageId", "success", "error"]);
  });
});

describe("BatchDispatchResult", () => {
  it("outcomes array preserves delivery order", () => {
    const outcomes: MessageOutcome[] = [
      successOutcome("m-1"),
      failureOutcome("m-2", new Error("fail")),
      successOutcome("m-3"),
    ];
    const result: BatchDispatchResult = {
      outcomes,
      failureCount: outcomes.filter((o) => !o.success).length,
    };

    expect(result.outcomes.map((o) => o.messageId)).toEqual(["m-1", "m-2", "m-3"]);
    expect(result.failureCount).toBe(1);
  });

  it("failureCount matches number of unsuccessful outcomes", () => {
    const outcomes: MessageOutcome[] = [
      failureOutcome("m-1", new Error("a")),
      failureOutcome("m-2", new Error("b")),
      successOutcome("m-3"),
      failureOutcome("m-4", new Error("c")),
    ];
    const result: BatchDispatchResult = {
      outcomes,
      failureCount: outcomes.filter((o) => !o.success).length,
    };

    expect(result.failureCount).toBe(3);
  });

  it("empty outcomes produces zero failureCount", () => {
    const result: BatchDispatchResult = { outcomes: [], failureCount: 0 };
    expect(result.failureCount).toBe(0);
    expect(result.outcomes).toHaveLength(0);
  });
});
