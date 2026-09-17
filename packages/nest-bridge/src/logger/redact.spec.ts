import { describe, expect, it } from "vitest";
import { REDACTED_VALUE, redactForLogging } from "./redact";

/**
 * Log redaction contract (spec 004, FR-009/014; AGENTS.md §6.2): secret-bearing
 * keys are replaced recursively so neither boundary nor application records
 * ever leak token/header/raw payload values.
 */

describe("redactForLogging (spec 004, FR-009/014)", () => {
  it("redacts known secret keys with the shared placeholder (non-mutating)", () => {
    const input = {
      token: "secret-token",
      Authorization: "Bearer abc",
      cookie: "session=xyz",
      raw: { body: "payload" },
      rawEvent: { key: "value" },
    };

    const result = redactForLogging(input) as Record<string, unknown>;

    expect(result.token).toBe(REDACTED_VALUE);
    expect(result.Authorization).toBe(REDACTED_VALUE);
    expect(result.cookie).toBe(REDACTED_VALUE);
    expect(result.raw).toBe(REDACTED_VALUE);
    expect(result.rawEvent).toBe(REDACTED_VALUE);
    // The input object is never mutated (purely functional).
    expect(input.token).toBe("secret-token");
  });

  it("redacts secret keys nested at any depth while preserving safe values", () => {
    const input = { user: { id: 42, credentials: { token: "abc" } }, note: "safe" };

    const result = redactForLogging(input) as {
      user: { id: number; credentials: { token: string } };
      note: string;
    };

    expect(result.user.id).toBe(42);
    expect(result.user.credentials.token).toBe(REDACTED_VALUE);
    expect(result.note).toBe("safe");
  });

  it("maps arrays element-wise and leaves primitives untouched", () => {
    expect(redactForLogging([{ token: "t" }, 7, "x"])).toEqual([
      { token: REDACTED_VALUE },
      7,
      "x",
    ]);
    expect(redactForLogging("str")).toBe("str");
    expect(redactForLogging(123)).toBe(123);
    expect(redactForLogging(null)).toBeNull();
  });
});
