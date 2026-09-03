import { buildYandexExecutionContext } from "./build-yandex-execution-context";
import type { YandexExecutionContext } from "./yandex-execution-context";

/**
 * Specs for the normalized execution context builder (issue #4). Fixtures
 * follow the observed runtime context shape (DATA-ANALYSE.md section D,
 * AGENTS.md section 5); all values are sanitized placeholders.
 */

const RAW_EVENT_FIXTURE: Record<string, unknown> = Object.freeze({
  version: "2.0",
  rawPath: "/fixture",
  headers: { "content-type": "application/json" },
});

const OBSERVED_CONTEXT: Record<string, unknown> = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  // Observed duplicate representation of awsRequestId; not normalized away.
  requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  // Bare function id despite the ARN-style name (observed).
  invokedFunctionArn: "d4epk2u927vj48ptg4i6",
  functionName: "d4epk2u927vj48ptg4i6",
  functionVersion: "d4eu4mg45akicl7ad5ta",
  functionFolderId: "b1g9kusggl9k4bmurq6s",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
  token: "sentinel-iam-secret-value",
  uberTraceId: "195befaa12da73b5:59ea0be13cb39c87:41d0f3eae511878e:1",
  _data: { deepCopyOfEvent: true },
};

function buildFrom(
  rawContext: unknown,
  rawEvent: unknown = RAW_EVENT_FIXTURE,
): YandexExecutionContext {
  return buildYandexExecutionContext(rawEvent, rawContext);
}

/** Explicit omit helper keeps fixtures free of unused-variable noise. */
function withoutFields(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !fields.includes(key)));
}

describe("normalized execution context builder", () => {
  it("copies every observed scalar field verbatim without coercion", () => {
    const executionContext = buildFrom(OBSERVED_CONTEXT);

    expect(executionContext.awsRequestId).toBe("f18fed85-7096-4f0e-a6db-e2c5e37e925f");
    expect(executionContext.functionName).toBe("d4epk2u927vj48ptg4i6");
    expect(executionContext.functionVersion).toBe("d4eu4mg45akicl7ad5ta");
    expect(executionContext.functionFolderId).toBe("b1g9kusggl9k4bmurq6s");
    // Observed as string; must survive as string, never become a number
    // (AGENTS.md section 5).
    expect(executionContext.memoryLimitInMB).toBe("1024");
    expect(executionContext.deadlineMs).toBe(1787328996791);
    // Present-but-empty on the real runtime (observed).
    expect(executionContext.logGroupName).toBe("");
  });

  it("preserves trace metadata verbatim", () => {
    const executionContext = buildFrom(OBSERVED_CONTEXT);

    // Tracing information is preserved rather than discarded (AGENTS.md
    // section 33): the full "<trace>:<span>:<parent>:1" form stays intact.
    expect(executionContext.uberTraceId).toBe(
      "195befaa12da73b5:59ea0be13cb39c87:41d0f3eae511878e:1",
    );
  });

  it("keeps the untouched raw event and context reachable by reference", () => {
    const rawContext = { ...OBSERVED_CONTEXT };
    const executionContext = buildYandexExecutionContext(RAW_EVENT_FIXTURE, rawContext);

    // Escape hatches keep the exact references: no cloning, no mutation,
    // additive fields stay reachable (AGENTS.md sections 7.3 and 36).
    expect(executionContext.rawEvent).toBe(RAW_EVENT_FIXTURE);
    expect(executionContext.raw).toBe(rawContext);
    expect((executionContext.raw as Record<string, unknown>)["_data"]).toEqual({
      deepCopyOfEvent: true,
    });
  });

  it("treats token and uberTraceId as optional without inventing values", () => {
    const executionContext = buildFrom(withoutFields(OBSERVED_CONTEXT, ["token", "uberTraceId"]));

    expect(executionContext.token).toBeUndefined();
    expect(executionContext.uberTraceId).toBeUndefined();
    // Absence is observable as key absence, not an undefined-valued property.
    expect(Object.keys(executionContext)).not.toContain("token");
    expect(Object.keys(executionContext)).not.toContain("uberTraceId");

    const withSecret = buildFrom(OBSERVED_CONTEXT);
    expect(withSecret.token).toBe("sentinel-iam-secret-value");
  });

  it("tolerates additive future context fields instead of rejecting them", () => {
    const futureContext = {
      ...OBSERVED_CONTEXT,
      someFutureRuntimeField: { nested: true },
    };

    const executionContext = buildFrom(futureContext);

    // Unknown data must not break normalization (AGENTS.md section 36) and
    // remains accessible through the raw escape hatch.
    expect((executionContext.raw as Record<string, unknown>)["someFutureRuntimeField"]).toEqual({
      nested: true,
    });
  });

  it("freezes the normalized view so invocation state cannot be mutated in place", () => {
    const executionContext = buildFrom(OBSERVED_CONTEXT);

    expect(Object.isFrozen(executionContext)).toBe(true);
  });

  describe("malformed runtime contexts fail loudly and value-free", () => {
    it.each([
      ["awsRequestId", 42],
      ["functionName", null],
      ["memoryLimitInMB", 1024],
      ["logGroupName", undefined],
    ])("rejects a non-string %s instead of coercing it", (field, bogusValue) => {
      const malformed = { ...OBSERVED_CONTEXT, [field]: bogusValue };

      expect(() => buildFrom(malformed)).toThrow(
        new RegExp(`expected field "${String(field)}" to be a string`),
      );
    });

    it("never echoes the offending value into the diagnostic", () => {
      const malformed = { ...OBSERVED_CONTEXT, awsRequestId: { leaked: "secret-client-value" } };

      let caught: unknown;
      try {
        buildFrom(malformed);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('"awsRequestId"');
      expect((caught as Error).message).not.toContain("secret-client-value");
    });

    it("rejects a non-number deadlineMs instead of coercing it", () => {
      const malformed = { ...OBSERVED_CONTEXT, deadlineMs: "1787328996791" };

      expect(() => buildFrom(malformed)).toThrow(/expected field "deadlineMs" to be a number/);
    });

    it("rejects missing required fields", () => {
      expect(() => buildFrom(withoutFields(OBSERVED_CONTEXT, ["functionVersion"]))).toThrow(
        /"functionVersion"/,
      );
    });

    it("rejects a non-object runtime context structurally", () => {
      expect(() => buildFrom(null)).toThrow(/runtime context: expected an object/);
      expect(() => buildFrom(undefined)).toThrow(/runtime context: expected an object/);
      expect(() => buildFrom("context")).toThrow(/runtime context: expected an object/);
    });
  });

  describe("serialization guard", () => {
    it("redacts the IAM token when automatically serialized", () => {
      const executionContext = buildFrom(OBSERVED_CONTEXT);

      const serialized = JSON.parse(JSON.stringify(executionContext)) as Record<string, unknown>;

      expect(serialized["token"]).toBe("REDACTED_TOKEN");
      expect(serialized["awsRequestId"]).toBe("f18fed85-7096-4f0e-a6db-e2c5e37e925f");
      expect(serialized["deadlineMs"]).toBe(1787328996791);
      expect(serialized["uberTraceId"]).toBe(
        "195befaa12da73b5:59ea0be13cb39c87:41d0f3eae511878e:1",
      );
    });

    it("excludes raw payloads from automatic serialization entirely", () => {
      const sensitiveEvent = {
        headers: {
          authorization: "Bearer sentinel-auth-value",
          cookie: "session=sentinel-cookie-value",
        },
      };
      const executionContext = buildYandexExecutionContext(sensitiveEvent, OBSERVED_CONTEXT);

      const serializedJson = JSON.stringify(executionContext);

      // Raw payloads can carry client credentials; accidental serialization
      // must never dump them (AGENTS.md section 6.2). Explicit property
      // access remains the escape hatch for advanced use cases.
      expect(serializedJson).not.toContain("sentinel-iam-secret-value");
      expect(serializedJson).not.toContain("sentinel-auth-value");
      expect(serializedJson).not.toContain("sentinel-cookie-value");
      expect(serializedJson).not.toContain('"raw"');
      expect(serializedJson).not.toContain('"rawEvent"');
      expect(serializedJson).not.toContain("_data");
    });

    it("omits absent optional fields from the serialized output instead of null-ing them", () => {
      const executionContext = buildFrom(withoutFields(OBSERVED_CONTEXT, ["token", "uberTraceId"]));

      const serialized = JSON.parse(JSON.stringify(executionContext)) as Record<string, unknown>;

      expect(Object.keys(serialized)).not.toContain("token");
      expect(Object.keys(serialized)).not.toContain("uberTraceId");
    });
  });
});
