import { ConnectorError } from "./connector-error";
import { detectTransport } from "./detect-transport";
import type {
  InvocationContainer,
  TransportAdapter,
  TransportId,
  TransportInvocation,
} from "./transport";
import type { YandexExecutionContext } from "../context/yandex-execution-context";

/**
 * Fixtures implement the real TransportAdapter SPI with marker-based
 * `supports()` predicates so the detection boundary is exercised against the
 * exact contract the HTTP (#5) and Message Queue (#7) adapters will fulfill.
 */

interface FixtureEvent {
  readonly kind: string;
}

interface FakeTransport extends TransportAdapter<FixtureEvent, string> {
  readonly invocations: TransportInvocation<FixtureEvent>[];
  readonly supportsRequests: unknown[];
}

const UNUSED_CONTAINER: InvocationContainer = {
  resolve: () => Promise.reject(new Error("container resolution is not part of this scenario")),
  getApplication: () => {
    throw new Error("application access is not part of this scenario");
  },
};

const FIXTURE_EXECUTION_CONTEXT: YandexExecutionContext = Object.freeze({
  awsRequestId: "req-fixture",
  functionName: "fn-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1771718400000,
  logGroupName: "",
  rawEvent: {},
  raw: {},
  toJSON: () => ({}),
});

function createFakeTransport(id: TransportId, claimedKind: string): FakeTransport {
  const invocations: TransportInvocation<FixtureEvent>[] = [];
  const supportsRequests: unknown[] = [];

  return {
    id,
    invocations,
    supportsRequests,
    supports(rawEvent): rawEvent is FixtureEvent {
      supportsRequests.push(rawEvent);
      return (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "kind" in rawEvent &&
        rawEvent.kind === claimedKind
      );
    },
    async invoke(invocation) {
      invocations.push(invocation);
      return `${id}:${invocation.rawEvent.kind}`;
    },
  };
}

const HTTP_FIXTURE_EVENT: FixtureEvent = { kind: "api-gateway-v2" };
const QUEUE_FIXTURE_EVENT: FixtureEvent = { kind: "message-queue-trigger" };

describe("core transport detection boundary", () => {
  it("routes an event to the single transport that claims it", () => {
    const http = createFakeTransport("http", "api-gateway-v2");
    const queue = createFakeTransport("message-queue", "message-queue-trigger");

    const claimed = detectTransport([http, queue], HTTP_FIXTURE_EVENT);

    expect(claimed.id).toBe("http");
  });

  it("consults transports in registration order and skips non-claiming ones", async () => {
    const http = createFakeTransport("http", "api-gateway-v2");
    const queue = createFakeTransport("message-queue", "message-queue-trigger");

    // A queue-shaped event must reach the later adapter even though an
    // earlier adapter was consulted first — order must not shadow claims.
    const claimed = detectTransport([http, queue], QUEUE_FIXTURE_EVENT);

    expect(claimed.id).toBe("message-queue");
    expect(http.supportsRequests).toEqual([QUEUE_FIXTURE_EVENT]);
    expect(queue.supportsRequests).toEqual([QUEUE_FIXTURE_EVENT]);

    await expect(
      claimed.invoke({
        rawEvent: QUEUE_FIXTURE_EVENT,
        rawContext: null,
        executionContext: FIXTURE_EXECUTION_CONTEXT,
        container: UNUSED_CONTAINER,
      }),
    ).resolves.toBe("message-queue:message-queue-trigger");
  });

  it("lets the first claiming transport win exclusively", () => {
    const first = createFakeTransport("http", "api-gateway-v2");
    const second = createFakeTransport("message-queue", "api-gateway-v2");

    const claimed = detectTransport([first, second], HTTP_FIXTURE_EVENT);

    expect(claimed.id).toBe("http");
    expect(second.invocations).toHaveLength(0);
  });

  it("passes the untouched raw event reference through to the claiming transport", async () => {
    const transport = createFakeTransport("http", "api-gateway-v2");

    const claimed = detectTransport([transport], HTTP_FIXTURE_EVENT);
    await claimed.invoke({
      rawEvent: HTTP_FIXTURE_EVENT,
      rawContext: null,
      executionContext: FIXTURE_EXECUTION_CONTEXT,
      container: UNUSED_CONTAINER,
    });

    // The exact references must survive detection: normalization happens
    // inside transports, never by mutating or cloning at the boundary
    // (AGENTS.md section 7.3).
    expect(transport.supportsRequests[0]).toBe(HTTP_FIXTURE_EVENT);
    expect(transport.invocations[0]?.rawEvent).toBe(HTTP_FIXTURE_EVENT);
  });

  describe("unclaimed events", () => {
    it("fails with UNKNOWN_INVOCATION_EVENT when no transport claims the event", () => {
      const http = createFakeTransport("http", "api-gateway-v2");

      let caught: unknown;
      try {
        detectTransport([http], { something: "else" });
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof ConnectorError)) {
        throw new Error(`expected ConnectorError, received ${String(caught)}`);
      }
      expect(caught.code).toBe("UNKNOWN_INVOCATION_EVENT");
      expect(caught.detail).toEqual({ code: "UNKNOWN_INVOCATION_EVENT" });
      expect(caught.transportId).toBeUndefined();
    });

    it("lists top-level field names without exposing payload values", () => {
      // Values may carry credentials or client data; only field names may
      // surface in diagnostics (AGENTS.md section 6.2).
      const suspiciousEvent = {
        authorization: "Bearer SECRET_TOKEN_VALUE",
        cookie: "SECRET_SESSION_VALUE",
        body: "SECRET_PAYLOAD",
      };

      const failure = () => detectTransport([], suspiciousEvent);

      expect(failure).toThrow(/top-level fields: authorization, body, cookie/);
      expect(failure).not.toThrow(/SECRET/);
    });

    it("describes non-object payloads structurally", () => {
      expect(() => detectTransport([], "raw string")).toThrow(/received string/);
      expect(() => detectTransport([], null)).toThrow(/received null/);
      expect(() => detectTransport([], [1, 2])).toThrow(/received an array/);
      expect(() => detectTransport([], 42)).toThrow(/received number/);
      expect(() => detectTransport([], undefined)).toThrow(/received undefined/);
    });

    it("caps how many field names are echoed into the diagnostic", () => {
      // Zero-padded indexes keep the sorted listing deterministic.
      const wideEvent: Record<string, number> = {};
      for (let index = 0; index < 30; index += 1) {
        wideEvent[`field${index.toString().padStart(2, "0")}`] = index;
      }

      const failure = () => detectTransport([], wideEvent);

      expect(failure).toThrow(/\+10 more/);
      expect(failure).toThrow(/field00, .*field19/);
      expect(failure).not.toThrow(/field20/);
    });
  });
});
