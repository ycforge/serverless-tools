import { ConnectorError } from "./connector-error";

describe("ConnectorError", () => {
  it("is a named Error subclass carrying the stable UNKNOWN_INVOCATION_EVENT code", () => {
    const error = ConnectorError.unknownInvocationEvent("top-level fields: version");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConnectorError");
    expect(error.code).toBe("UNKNOWN_INVOCATION_EVENT");
    expect(error.detail).toEqual({ code: "UNKNOWN_INVOCATION_EVENT" });
    expect(error.transportId).toBeUndefined();
    expect(error.message).toContain("no registered transport adapter claimed the invocation event");
    expect(error.message).toContain("top-level fields: version");
  });

  it("carries the claiming transport with the INVALID_INVOCATION_EVENT code", () => {
    const error = ConnectorError.invalidInvocationEvent(
      "message-queue",
      "messages must be an array",
    );

    expect(error.name).toBe("ConnectorError");
    expect(error.code).toBe("INVALID_INVOCATION_EVENT");
    expect(error.detail).toEqual({
      code: "INVALID_INVOCATION_EVENT",
      transportId: "message-queue",
    });
    expect(error.transportId).toBe("message-queue");
    expect(error.message).toContain('"message-queue"');
    expect(error.message).toContain("messages must be an array");
  });

  it("composes messages without optional diagnostics", () => {
    const unknown = ConnectorError.unknownInvocationEvent();
    const invalid = ConnectorError.invalidInvocationEvent("http");

    expect(unknown.message).not.toMatch(/\(\)/);
    expect(unknown.message).toBe("no registered transport adapter claimed the invocation event");
    expect(invalid.message).toBe(
      'transport "http" claimed the invocation event but rejected it as structurally invalid',
    );
  });
});
