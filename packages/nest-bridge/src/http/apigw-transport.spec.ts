import { All, Controller, Module } from "@nestjs/common";
import { createYandexHandler } from "../core/create-yandex-handler";
import { createBuiltinTransports } from "../core/transports";
import { detectTransport } from "../core/detect-transport";
import {
  resolveInvocationExecutionContext,
  resolveInvocationHttpRequest,
} from "../context/invocation-scope";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { loadYcApiGatewayFixture, type YcApiGatewayInvocationFixture } from "../testing/invocation-fixtures";
import type { NormalizedHttpRequest } from "./normalized-request";

/**
 * API Gateway `cloud_functions` transport (spec 036).
 *
 * Evidenced by sanitized reconstructions of real gateway invocations captured
 * on 2026-09-17 (`fixtures/http-apigw/`): the gateway delivers a v1-style
 * event (`httpMethod`/`path`/`url`/`requestContext.identity`, no `version`),
 * which the existing v2 transport discriminator (`version === "2.0"` +
 * `rawPath`) can never claim — the 502-гэп this spec closes.
 */

interface CapturedRequest {
  readonly normalizedRequest: NormalizedHttpRequest;
  readonly executionContext: YandexExecutionContext;
}

const CAPTURES: CapturedRequest[] = [];

class ApigwTransportController {
  captureRest(rest: string): object {
    CAPTURES.push({
      normalizedRequest: resolveInvocationHttpRequest(),
      executionContext: resolveInvocationExecutionContext(),
    });
    return {
      rest,
      path: CAPTURES[CAPTURES.length - 1]!.normalizedRequest.path,
    };
  }
}

Controller()(ApigwTransportController);

const controllerDescriptor = Object.getOwnPropertyDescriptor(
  ApigwTransportController.prototype,
  "captureRest",
);
if (!controllerDescriptor) {
  throw new Error("missing descriptor for captureRest");
}
All("*rest")(ApigwTransportController.prototype, "captureRest", controllerDescriptor);

class ApigwTransportModule {}

Module({ controllers: [ApigwTransportController] })(ApigwTransportModule);

const ALL_APIGW_FIXTURE_NAMES = ["get-without-query", "repeated-query-parameters"] as const;

async function replay(name: string): Promise<{
  fixture: YcApiGatewayInvocationFixture;
  captured: CapturedRequest;
  response: unknown;
}> {
  const fixture = await loadYcApiGatewayFixture(name);
  const handler = createYandexHandler(ApigwTransportModule);
  try {
    const response = await handler(fixture.event, fixture.context);
    const captured = CAPTURES.find(
      (entry) => entry.executionContext.awsRequestId === fixture.context.awsRequestId,
    );
    if (!captured) {
      throw new Error(`fixture "${name}" produced no controller capture`);
    }
    return { fixture, captured, response };
  } finally {
    await handler.close();
  }
}

describe("API Gateway cloud_functions (v1) transport (spec 036)", () => {
  beforeEach(() => {
    CAPTURES.length = 0;
  });

  describe("detection discriminator", () => {
    const transports = createBuiltinTransports();

    it("claims a v1-shaped event through the http transport", () => {
      const claimed = detectTransport(transports, {
        httpMethod: "GET",
        path: "/users",
        headers: {},
        queryStringParameters: {},
        body: "",
        isBase64Encoded: true,
        requestContext: {
          identity: { sourceIp: "203.0.113.10", userAgent: "test" },
          httpMethod: "GET",
          requestId: "req-1",
          requestTime: "17/Sep/2026:04:19:34 +0000",
          requestTimeEpoch: 1789618774,
        },
      });
      expect(claimed.id).toBe("http");
    });

    it("still claims a v2-shaped event through the http transport unmodified", () => {
      // A v2 frame that ALSO carries httpMethod/path is v2 (version presence
      // wins); the v1 branch only claims events WITHOUT version (US3/AC2).
      const claimed = detectTransport(transports, {
        version: "2.0",
        rawPath: "/users",
        rawQueryString: "",
        httpMethod: "GET",
        path: "/users",
        headers: {},
        queryStringParameters: {},
        requestContext: {
          authorizer: {},
          http: { method: "GET", path: "/users", sourceIp: "203.0.113.10", userAgent: "test" },
          requestId: "req-1",
          time: "17/Sep/2026:04:19:34 +0000",
          timeEpoch: 1789618774,
        },
        body: "",
        isBase64Encoded: true,
        pathParameters: {},
        parameters: {},
        multiValueParameters: {},
        operationId: "op",
      });
      expect(claimed.id).toBe("http");
    });

    it("lets claims remain pairwise disjoint: version presence beats httpMethod", () => {
      // Hybrid carries v2's `version` but lacks rawPath/rawQueryString: the
      // v1 branch requires `version === undefined`, the v2 branch requires
      // rawPath/rawQueryString — neither claims, the event stays unknown.
      const hybrid = {
        version: "2.0",
        httpMethod: "GET",
        path: "/users",
        headers: {},
        body: "",
        isBase64Encoded: true,
      };
      expect(() => detectTransport(transports, hybrid)).toThrow(
        /no registered transport adapter claimed the invocation event \(top-level fields:/,
      );
    });

    it("claims message queue events through the message-queue transport untouched", () => {
      const claimed = detectTransport(transports, {
        messages: [
          {
            event_metadata: { event_type: "message", topic: "queue", event_id: "1" },
            details: {
              queue_id: "queue-id",
              message: { message_id: "msg-1", data: "dmVnZXRhYmxl", attributes: {} },
            },
          },
        ],
      });
      expect(claimed.id).toBe("message-queue");
    });

    it("keeps fail-fast for garbage, arrays and scalars", () => {
      for (const garbage of [{}, [], null, "raw string", 42, undefined]) {
        expect(() => detectTransport(transports, garbage)).toThrow(
          /no registered transport adapter claimed the invocation event/,
        );
      }
      // Field NAMES only, never values.
      expect(() => detectTransport(transports, { authorization: "Bearer SECRET" })).not.toThrow(
        /SECRET/,
      );
    });
  });

  describe("v1 conformance fixtures (spec 036)", () => {
    it.each(ALL_APIGW_FIXTURE_NAMES)(
      "replays %s through the public handler with a 200 envelope",
      async (name) => {
        const { response, fixture } = await replay(name);
        expect(response).toMatchObject({ statusCode: 200, isBase64Encoded: false });
        expect(typeof (response as { body?: unknown }).body).toBe("string");
        expect(fixture.provenance.kind).toBe("reconstructed");
        expect(fixture.provenance.evidence).toContain("spec 036");
      },
    );

    it("maps the v1 event into the normalized request honestly (httpVersion 1.0)", async () => {
      const { captured, fixture } = await replay("get-without-query");
      const { normalizedRequest } = captured;
      const event = fixture.event;

      expect(normalizedRequest.httpVersion).toBe("1.0");
      expect(normalizedRequest.method).toBe(event.httpMethod);
      expect(normalizedRequest.path).toBe(event.path);
      expect(normalizedRequest.requestId).toBe(event.requestContext.requestId);
      expect(normalizedRequest.sourceIp).toBe(event.requestContext.identity.sourceIp);
      expect(normalizedRequest.userAgent).toBe(event.requestContext.identity.userAgent);
      // Empty query: the gateway's "/users?" target normalizes to "".
      expect(normalizedRequest.rawQueryString).toBe("");
      expect(normalizedRequest.queryStringParameters).toEqual({});
      expect(normalizedRequest.multiValueParameters).toEqual({});
      // Bodiless GET collapses to null exactly like the v2 path.
      expect(normalizedRequest.body).toBeNull();
      // The raw v1 event stays reachable through the normalized request.
      expect(normalizedRequest.raw).toBe(event);
    });

    it("preserves repeated query parameters in both gateway views", async () => {
      const { captured } = await replay("repeated-query-parameters");
      const { normalizedRequest } = captured;

      // url is canonical: multiplicity survives verbatim in rawQueryString.
      expect(normalizedRequest.rawQueryString).toBe("limit=2&limit=3&offset=0&multi=a&multi=b");
      // queryStringParameters: the gateway collapses repeats, last value wins.
      expect(normalizedRequest.queryStringParameters).toEqual({ limit: "3", offset: "0", multi: "b" });
      // Multiplicity preserved separately, never merged with the collapsed map.
      expect(normalizedRequest.multiValueParameters).toEqual({
        limit: ["2", "3"],
        offset: ["0"],
        multi: ["a", "b"],
      });
      // searchParams reads the canonical query string so repeats survive there.
      expect(normalizedRequest.searchParams.getAll("limit")).toEqual(["2", "3"]);
      expect(normalizedRequest.searchParams.getAll("multi")).toEqual(["a", "b"]);
    });

    it("fails INVALID for a v1 event missing core requestContext.identity", async () => {
      const fixture = await loadYcApiGatewayFixture("get-without-query");
      const event = {
        httpMethod: "GET",
        path: "/users",
        headers: {},
        queryStringParameters: {},
        body: "",
        isBase64Encoded: true,
        requestContext: { requestId: "req-1", httpMethod: "GET" },
      };
      const handler = createYandexHandler(ApigwTransportModule);
      try {
        await expect(handler(event, fixture.context)).rejects.toMatchObject({
          code: "INVALID_INVOCATION_EVENT",
          transportId: "http",
        });
      } finally {
        await handler.close();
      }
    });
  });
});