import { All, Controller, Module } from "@nestjs/common";
import {
  resolveInvocationExecutionContext,
  resolveInvocationHttpRequest,
} from "../context/invocation-scope";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { createYandexHandler } from "../core/create-yandex-handler";
import { loadHttpFixture, type HttpInvocationFixture } from "../testing/invocation-fixtures";
import type { NormalizedHttpRequest } from "./normalized-request";

/**
 * Conformance suite against sanitized conformance fixtures (issue #11).
 *
 * Every JSON file under `fixtures/http/` is NOT a literal capture: it is a
 * sanitized reconstruction of one API Gateway payload-format-2.0 invocation
 * scenario, distilled from captured evidence (provenance, sanitization rules
 * and evidence levels: fixtures/README.md; evidence base: DATA-ANALYSE.md).
 * Identifiers, timestamps, addresses and credential placeholders inside the
 * fixtures are synthetic; the OBSERVED structure and gateway behaviors they
 * encode carry the evidentiary weight.
 *
 * Each fixture replays through the PUBLIC runtime — exactly the
 * `(event, context) => response` signature Yandex calls — with the normalized
 * request captured inside the controller via the invocation scope. Assertions
 * therefore validate the implementation against the observed behavior encoded
 * by each fixture (expected values are derived from the fixture itself, never
 * treated as original cloud data), plus explicitly documented observed quirks
 * such as those listed in AGENTS.md section 4.
 *
 * Decorators are applied imperatively (legacy desugaring shape) so the suite
 * stays independent of this repository's decorator compilation settings.
 */

interface CapturedRequest {
  readonly normalizedRequest: NormalizedHttpRequest;
  readonly executionContext: YandexExecutionContext;
}

const CAPTURES: CapturedRequest[] = [];

class ConformanceController {
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

Controller()(ConformanceController);

const controllerDescriptor = Object.getOwnPropertyDescriptor(
  ConformanceController.prototype,
  "captureRest",
);
if (!controllerDescriptor) {
  throw new Error("missing descriptor for captureRest");
}
All("*rest")(ConformanceController.prototype, "captureRest", controllerDescriptor);

class ConformanceModule {}

Module({ controllers: [ConformanceController] })(ConformanceModule);

const ALL_HTTP_FIXTURE_NAMES = [
  "get-without-query",
  "catch-all-path-parameters",
  "repeated-query-parameters",
  "url-encoded-query-values",
  "encoded-path-characters",
  "custom-headers-and-cookies",
  "json-body-plain-utf8",
  "plain-text-body-base64",
  "form-body-base64",
  "binary-body-base64",
  "custom-json-content-type-base64",
] as const;

async function replay(name: string): Promise<{
  fixture: HttpInvocationFixture;
  captured: CapturedRequest;
  response: unknown;
}> {
  const fixture = await loadHttpFixture(name);
  const handler = createYandexHandler(ConformanceModule);
  try {
    const response = await handler(fixture.event, fixture.context);
    // Match by request id, not by position: concurrent replays interleave
    // their pushes into CAPTURES.
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

function bodyText(normalizedRequest: NormalizedHttpRequest): string {
  if (normalizedRequest.body === null) {
    throw new Error("expected a non-null request body");
  }
  return Buffer.from(normalizedRequest.body).toString("utf8");
}

describe("HTTP conformance fixtures (issue #11)", () => {
  beforeEach(() => {
    CAPTURES.length = 0;
  });

  it("replays every committed HTTP fixture through the public handler", async () => {
    expect(ALL_HTTP_FIXTURE_NAMES).toHaveLength(11);
    for (const name of ALL_HTTP_FIXTURE_NAMES) {
      const { response } = await replay(name);
      // Every replay must reach the catch-all controller and produce the
      // wire-valid four-field envelope (statusCode/body/isBase64Encoded).
      expect(response).toMatchObject({ statusCode: 200, isBase64Encoded: false });
      expect(typeof (response as { body?: unknown }).body).toBe("string");
    }
    expect(CAPTURES).toHaveLength(ALL_HTTP_FIXTURE_NAMES.length);
  });

  it("declares reconstructed provenance on every fixture", async () => {
    for (const name of ALL_HTTP_FIXTURE_NAMES) {
      const fixture = await loadHttpFixture(name);
      // Machine-readable guard against provenance drift: these files are
      // reconstructions from captured evidence, never literal captures.
      expect(fixture.provenance.kind).toBe("reconstructed");
      expect(fixture.provenance.evidence).toBe("DATA-ANALYSE.md");
    }
  });

  it("routes on rawPath even when the gateway rebuilt requestContext.http.path", async () => {
    // get-without-query carries httpPath "/probe/ping?" (the observed trailing
    // "?" appears exactly when the canonical query string is empty); the
    // encoded-path fixture shows a decoded "%3F" TRUNCATING rawPath. Both must
    // route by rawPath; requestContext.http.path stays untouched pass-through.
    const trailing = await replay("get-without-query");
    expect(trailing.fixture.event.requestContext.http.path).toBe("/probe/ping?");
    expect(trailing.captured.normalizedRequest.path).toBe(trailing.fixture.event.rawPath);

    const encoded = await replay("encoded-path-characters");
    // Observed hazard: the decoded "%3F" cuts rawPath at that point, while the
    // rebuilt requestContext.http.path keeps the full decoded form (with the
    // doubled "?") and the catch-all parameter stops before it.
    expect(encoded.fixture.event.rawPath).toBe("/probe/with space/and/encoded");
    expect(encoded.fixture.event.requestContext.http.path).toContain("?chars?x=");
    expect(encoded.captured.normalizedRequest.path).toBe("/probe/with space/and/encoded");
    expect(encoded.fixture.event.pathParameters.ID).not.toContain("?");
  });

  it("shares only the trace segment between context.uberTraceId and the Uber-Trace-Id header", async () => {
    // Observed across all HTTP captures: the context trace id reuses the
    // header's trace segment while its span/parent segments always differ —
    // never a verbatim copy of the header.
    for (const name of ALL_HTTP_FIXTURE_NAMES) {
      const fixture = await loadHttpFixture(name);
      const contextTraceId = fixture.context.uberTraceId;
      if (typeof contextTraceId !== "string") {
        throw new Error(`Fixture "${name}" must carry a string context.uberTraceId.`);
      }
      const headerTraceId = fixture.event.headers["Uber-Trace-Id"];
      if (typeof headerTraceId !== "string") {
        throw new Error(`Fixture "${name}" must carry an Uber-Trace-Id header.`);
      }
      const [headerTrace, headerSpan, headerParent] = headerTraceId.split(":");
      const [contextTrace, contextSpan, contextParent] = contextTraceId.split(":");
      expect(contextTrace).toBe(headerTrace);
      expect(contextSpan).not.toBe(headerSpan);
      expect(contextParent).not.toBe(headerParent);
    }
  });

  it("preserves repeated query parameters in both gateway representations", async () => {
    const { captured, fixture } = await replay("repeated-query-parameters");
    const { normalizedRequest } = captured;
    const event = fixture.event;

    // Canonical client query string passes through unchanged.
    expect(normalizedRequest.rawQueryString).toBe(event.rawQueryString);
    // Gateway's comma join of repeated values is preserved verbatim...
    expect(normalizedRequest.queryStringParameters).toEqual(event.queryStringParameters);
    // ...and true multiplicity is preserved in the multi-value view.
    expect(normalizedRequest.multiValueParameters).toEqual(event.multiValueParameters);
    const repeated = event.multiValueParameters.multi ?? [];
    expect(repeated.length).toBeGreaterThan(1);
    // searchParams parses the canonical rawQueryString, so multiplicity
    // survives there too instead of collapsing to the comma-joined map.
    expect(normalizedRequest.searchParams.getAll("multi")).toEqual(repeated);
    // Declared gateway parameters collapse repeats: last value wins.
    expect(captured.normalizedRequest.raw.parameters?.multi).toBe(repeated[repeated.length - 1]);
  });

  it("decodes url-encoded query values without touching the raw query string", async () => {
    const { captured, fixture } = await replay("url-encoded-query-values");
    const { normalizedRequest } = captured;
    const event = fixture.event;

    // The connector's parse must agree with the gateway's independently
    // decoded queryStringParameters for every key (Unicode, emoji, reserved
    // characters included) — derived from the fixture, not from literals.
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      expect(normalizedRequest.searchParams.get(key)).toBe(value);
      expect(normalizedRequest.queryStringParameters[key]).toBe(value);
    }
    expect(normalizedRequest.rawQueryString).toBe(event.rawQueryString);
    // Rebuilt gateway path lowercased percent hex and swapped + for spaces —
    // documented OBSERVED rebuild shape; another reason it must never become
    // the routing source.
    expect(event.requestContext.http.path).toContain("phrase=hello+world");
    expect(event.requestContext.http.path).toContain("%d1%82%d0%b5%d1%81%d1%82");
  });

  it("exposes catch-all gateway path parameters as provided", async () => {
    const users = await replay("catch-all-path-parameters");
    const event = users.fixture.event;
    expect(users.captured.normalizedRequest.pathParameters.ID).toBe(event.parameters.ID);
    expect(users.captured.normalizedRequest.path).toBe(event.rawPath);
  });

  it("keeps custom headers, cookies and client metadata accessible", async () => {
    const { captured, fixture } = await replay("custom-headers-and-cookies");
    const { normalizedRequest, executionContext } = captured;
    const eventHeaders = fixture.event.headers;

    // Header values are transport pass-through: whatever the fixture carries
    // (here sanitized placeholders per AGENTS.md 6.3) reaches the app intact.
    expect(normalizedRequest.headers.Authorization).toBe(eventHeaders.Authorization);
    expect(normalizedRequest.headers.Cookie).toBe(eventHeaders.Cookie);
    // Sanitization policy spot-check: client IPs stay TEST-NET placeholders.
    expect(fixture.event.requestContext.http.sourceIp).toMatch(/^203\.0\.113\./);
    expect(normalizedRequest.sourceIp).toBe(fixture.event.requestContext.http.sourceIp);
    expect(normalizedRequest.userAgent).toBe(fixture.event.requestContext.http.userAgent);
    // Correlation ids line up across event/context/header.
    expect(normalizedRequest.requestId).toBe(fixture.context.awsRequestId);
    expect(executionContext.awsRequestId).toBe(fixture.context.awsRequestId);
  });

  it("keeps application/json bodies plain UTF-8 text", async () => {
    const { captured, fixture } = await replay("json-body-plain-utf8");
    expect(fixture.event.isBase64Encoded).toBe(false);
    // Plain-text contract: decoded body equals the wire string verbatim.
    expect(bodyText(captured.normalizedRequest)).toBe(String(fixture.event.body));
  });

  it("decodes base64 bodies for non-json content types without parsing them", async () => {
    const expectedBytes = (fixture: HttpInvocationFixture): Uint8Array =>
      Buffer.from(String(fixture.event.body), "base64");

    const text = await replay("plain-text-body-base64");
    expect(text.fixture.event.isBase64Encoded).toBe(true);
    // Decoding correctness: bytes equal the Base64 payload decoded, NOT the
    // untouched wire string.
    expect(text.captured.normalizedRequest.body).toEqual(expectedBytes(text.fixture));
    expect(bodyText(text.captured.normalizedRequest)).not.toBe(text.fixture.event.body);

    const form = await replay("form-body-base64");
    // Forms arrive unparsed: normalization must not invent form handling, so
    // the decoded form text survives byte-exactly including its separators.
    expect(form.captured.normalizedRequest.body).toEqual(expectedBytes(form.fixture));
    expect(bodyText(form.captured.normalizedRequest)).toContain("&tag=two");

    const binary = await replay("binary-body-base64");
    // Byte-exact binary round trip. The explicit byte list documents what this
    // committed artifact decodes to (DATA-ANALYSE prose lists byte 5 as 0x77
    // while the authoritative artifact yields 0x7f).
    expect([...binary.captured.normalizedRequest.body!]).toEqual([0, 1, 2, 3, 127, 128, 255]);
    expect(binary.captured.normalizedRequest.body).toEqual(expectedBytes(binary.fixture));

    const customJson = await replay("custom-json-content-type-base64");
    // Suffix JSON types are NOT granted plain-text treatment.
    expect(customJson.fixture.event.isBase64Encoded).toBe(true);
    expect(customJson.captured.normalizedRequest.body).toEqual(expectedBytes(customJson.fixture));
  });

  it("surfaces an empty bodiless GET as a null body despite isBase64Encoded", async () => {
    const { captured, fixture } = await replay("get-without-query");
    expect(fixture.event.isBase64Encoded).toBe(true);
    expect(captured.normalizedRequest.body).toBeNull();
  });

  it("normalizes the execution context without coercing observed types", async () => {
    const { captured, fixture } = await replay("get-without-query");
    const { executionContext } = captured;

    // memoryLimitInMB stays the string the runtime delivers (the observed
    // invariant is the TYPE; the value comes from the fixture itself).
    expect(executionContext.memoryLimitInMB).toBe(String(fixture.context.memoryLimitInMB));
    expect(typeof executionContext.memoryLimitInMB).toBe("string");
    expect(executionContext.deadlineMs).toBeGreaterThan(0);
    // timeEpoch is seconds on the wire despite its name (observed).
    expect(fixture.event.requestContext.timeEpoch).toBeLessThan(10_000_000_000);
    // The undocumented _data mirror stays reachable through raw and carries
    // exactly the fixture's (sanitized) event — structural mirror, not
    // original runtime data.
    expect((executionContext.raw as { _data?: unknown })._data).toEqual(fixture.event);
    // Serialization guard: whatever token placeholder a fixture carries can
    // never leak through toJSON; the redaction contract is fixed.
    expect(JSON.stringify(executionContext)).not.toContain(String(fixture.context.token));
    expect(executionContext.toJSON().token).toBe("REDACTED_TOKEN");
  });

  it("isolates sequential replays: warm invocations never observe each other", async () => {
    const first = await replay("repeated-query-parameters");
    const second = await replay("url-encoded-query-values");

    expect(first.captured.executionContext.awsRequestId).not.toBe(
      second.captured.executionContext.awsRequestId,
    );
    // Both fixtures share the path /probe/query, so isolation must be visible
    // in the invocation-scoped data: the second replay carries its own query
    // string, never the first one's repeated parameters.
    expect(second.captured.normalizedRequest.rawQueryString).toBe(
      second.fixture.event.rawQueryString,
    );
    expect(second.captured.normalizedRequest.searchParams.has("multi")).toBe(false);
  });

  it("isolates concurrent replays of all fixtures", async () => {
    const results = await Promise.all(ALL_HTTP_FIXTURE_NAMES.map((name) => replay(name)));
    const requestIds = results.map((result) => result.fixture.context.awsRequestId);
    // Distinct dumps carry distinct request ids and each capture saw its own.
    expect(new Set(requestIds).size).toBe(results.length);
    results.forEach((result, index) => {
      expect(result.captured.executionContext.awsRequestId).toBe(requestIds[index]);
    });
  });
});
