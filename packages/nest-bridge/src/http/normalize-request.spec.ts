import { normalizeHttpRequest } from "./normalize-request";
import type { RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Normalization specs for the API Gateway v2 HTTP request adapter (issue #5).
 *
 * Fixtures mirror the observed runtime payloads distilled in DATA-ANALYSE.md
 * sections B and E: all credentials, IPs and infrastructure ids are replaced
 * with deterministic placeholders while the structural quirks that motivated
 * each rule are preserved verbatim.
 */

const UTF8_DECODER = new TextDecoder("utf-8");

function decodeUtf8(bytes: Uint8Array): string {
  return UTF8_DECODER.decode(bytes);
}

/** Builds an observed-shape event with every always-present field (DATA-ANALYSE.md section B1). */
function makeHttpEvent(
  overrides: {
    rawPath?: string;
    rawQueryString?: string;
    headers?: Record<string, string>;
    queryStringParameters?: Record<string, string>;
    httpMethod?: string;
    httpPath?: string;
    requestId?: string;
    body?: string;
    isBase64Encoded?: boolean;
    pathParameters?: Record<string, string>;
    multiValueParameters?: Record<string, string[]>;
  } = {},
): RawHttpApiGatewayV2Event {
  return {
    version: "2.0",
    rawPath: overrides.rawPath ?? "/test/simple",
    rawQueryString: overrides.rawQueryString ?? "",
    headers:
      overrides.headers ??
      ({
        Accept: "*/*",
        Host: "functions.yandexcloud.net",
        "User-Agent": "fixture-agent/1.0",
      } as Record<string, string>),
    queryStringParameters: overrides.queryStringParameters ?? {},
    requestContext: {
      authorizer: {},
      http: {
        method: overrides.httpMethod ?? "GET",
        // Deliberately quirky: the gateway rebuilds this field and appends a
        // trailing '?' even when the query is empty (observed).
        path: overrides.httpPath ?? "/test/simple?",
        sourceIp: "203.0.113.10",
        userAgent: "fixture-agent/1.0",
      },
      requestId: overrides.requestId ?? "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      time: "21/Aug/2026:16:16:30 +0000",
      timeEpoch: 1787328990,
    },
    body: overrides.body ?? "",
    isBase64Encoded: overrides.isBase64Encoded ?? true,
    pathParameters: overrides.pathParameters ?? {},
    parameters: {},
    multiValueParameters: overrides.multiValueParameters ?? {},
    operationId: "41cf33042e33".padEnd(64, "0"),
  };
}

describe("normalized http request URI handling", () => {
  it("keeps rawPath as the canonical path instead of requestContext.http.path", () => {
    // requestContext.http.path is an unreliable rebuild: trailing '?', sorted
    // parameters and rewritten encodings are all observed on real traffic
    // (AGENTS.md section 4.2); rawPath is authoritative.
    const event = makeHttpEvent({
      rawPath: "/path/with space/and/encoded?chars",
      httpPath: "/test/simple?",
    });

    const normalizedRequest = normalizeHttpRequest(event);

    expect(normalizedRequest.path).toBe("/path/with space/and/encoded?chars");
    expect(normalizedRequest.path).not.toBe(event.requestContext.http.path);
  });

  it("keeps unicode path segments exactly as delivered in rawPath", () => {
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({ rawPath: "/unicode/тест/привет" }),
    );

    expect(normalizedRequest.path).toBe("/unicode/тест/привет");
  });

  it("preserves the still-encoded query string verbatim and exposes a decoded parsed view", () => {
    const rawQueryString = "q=hello%20world&emoji=%F0%9F%98%80&special=%2F%3F%26%3D%25%23%2B";
    const normalizedRequest = normalizeHttpRequest(makeHttpEvent({ rawQueryString }));

    expect(normalizedRequest.rawQueryString).toBe(rawQueryString);
    expect(normalizedRequest.searchParams.get("q")).toBe("hello world");
    expect(normalizedRequest.searchParams.get("emoji")).toBe("😀");
    expect(normalizedRequest.searchParams.get("special")).toBe("/?&=%#+");
  });

  it("treats an absent query string as empty without inventing separators", () => {
    const normalizedRequest = normalizeHttpRequest(makeHttpEvent({ rawQueryString: "" }));

    expect(normalizedRequest.rawQueryString).toBe("");
    expect([...normalizedRequest.searchParams.keys()]).toEqual([]);
  });
});

describe("normalized http request query parameter views", () => {
  it("keeps repeated query parameters in both incompatible gateway representations", () => {
    // The gateway comma-joins repeats into queryStringParameters while
    // multiValueParameters preserves multiplicity; merging them would lose
    // information either way (observed, AGENTS.md section 4.3).
    const event = makeHttpEvent({
      rawQueryString: "multi=one&multi=two&multi=three",
      queryStringParameters: { multi: "one,two,three" },
      multiValueParameters: { multi: ["one", "two", "three"] },
    });

    const normalizedRequest = normalizeHttpRequest(event);

    expect(normalizedRequest.queryStringParameters["multi"]).toBe("one,two,three");
    expect(normalizedRequest.multiValueParameters["multi"]).toEqual(["one", "two", "three"]);
    expect(normalizedRequest.searchParams.getAll("multi")).toEqual(["one", "two", "three"]);
  });

  it("preserves empty query values instead of dropping them", () => {
    const event = makeHttpEvent({
      rawQueryString: "empty=",
      queryStringParameters: { empty: "" },
      multiValueParameters: { empty: [""] },
    });

    const normalizedRequest = normalizeHttpRequest(event);

    expect(normalizedRequest.searchParams.get("empty")).toBe("");
    expect(normalizedRequest.queryStringParameters["empty"]).toBe("");
  });
});

describe("normalized http request body handling", () => {
  it("decodes an application/json body as plain utf-8 text when isBase64Encoded is false", () => {
    const body = '{"message":"значение 😀"}';
    const normalizedRequest = normalizeHttpRequest(makeHttpEvent({ body, isBase64Encoded: false }));

    expect(decodeUtf8(normalizedRequest.body as Uint8Array)).toBe(body);
  });

  it("decodes a base64 text body without corruption when isBase64Encoded is true", () => {
    // Observed: text/plain bodies arrive Base64-encoded.
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({
        body: "SGVsbG8sIFlhbmRleCBDbG91ZCBGdW5jdGlvbiE=",
        isBase64Encoded: true,
      }),
    );

    expect(decodeUtf8(normalizedRequest.body as Uint8Array)).toBe("Hello, Yandex Cloud Function!");
  });

  it("keeps binary base64 bodies byte-exact", () => {
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({ body: "AAECA3eA/w==", isBase64Encoded: true }),
    );

    expect(Array.from(normalizedRequest.body as Uint8Array)).toEqual([
      0x00, 0x01, 0x02, 0x03, 0x77, 0x80, 0xff,
    ]);
  });

  it("delivers form bodies as opaque bytes without pre-parsing them", () => {
    const formBody = "name=Alice&age=30&active=true&tag=one&tag=two";
    const encodedFormBody = Buffer.from(formBody, "utf8").toString("base64");
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodedFormBody,
        isBase64Encoded: true,
      }),
    );

    // Form parsing is deliberately not the transport's job; the exact wire
    // bytes stay reachable for higher layers to interpret.
    expect(decodeUtf8(normalizedRequest.body as Uint8Array)).toBe(formBody);
  });

  it("treats custom+json content types as opaque base64 bytes despite the json suffix", () => {
    // Observed: only the exact application/json type gets plain-text
    // treatment; application/custom+json arrives Base64 (DATA-ANALYSE E1).
    const payload = '{"custom":true}';
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({
        headers: { "Content-Type": "application/custom+json" },
        body: Buffer.from(payload, "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    );

    expect(decodeUtf8(normalizedRequest.body as Uint8Array)).toBe(payload);
  });

  it("collapses empty bodies to null regardless of the encoding flag", () => {
    // Bodiless GETs arrive as body:"" with isBase64Encoded:true (observed);
    // applications must distinguish "no body" from non-empty bodies.
    expect(
      normalizeHttpRequest(makeHttpEvent({ body: "", isBase64Encoded: true })).body,
    ).toBeNull();
    expect(
      normalizeHttpRequest(makeHttpEvent({ body: "", isBase64Encoded: false })).body,
    ).toBeNull();
  });
});

describe("normalized http request metadata exposure", () => {
  it("passes headers through verbatim including unparsed cookie strings", () => {
    // Cookies are only ever observed as the raw Cookie header; the transport
    // must not parse or reorder them (observed, DATA-ANALYSE section E4).
    const headers = {
      Cookie: "test_cookie=cookie-value; session=abc123; theme=dark",
      "Content-Type": "application/json",
      "X-Request-Id": "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
    };
    const normalizedRequest = normalizeHttpRequest(makeHttpEvent({ headers }));

    expect(normalizedRequest.headers).toEqual(headers);
    expect(normalizedRequest.headers.Cookie).toBe(headers.Cookie);
  });

  it("preserves gateway path parameters including merged segment values", () => {
    // Observed quirk: /a%2Fb%2Fc decodes into one catch-all value "a/b/c".
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({
        rawPath: "/a/b/c",
        pathParameters: { ID: "a/b/c" },
      }),
    );

    expect(normalizedRequest.pathParameters).toEqual({ ID: "a/b/c" });
  });

  it("exposes client metadata and correlation ids from requestContext.http", () => {
    const normalizedRequest = normalizeHttpRequest(
      makeHttpEvent({
        httpMethod: "POST",
        requestId: "11111111-2222-4333-8444-555555555555",
      }),
    );

    expect(normalizedRequest.method).toBe("POST");
    expect(normalizedRequest.sourceIp).toBe("203.0.113.10");
    expect(normalizedRequest.userAgent).toBe("fixture-agent/1.0");
    expect(normalizedRequest.requestId).toBe("11111111-2222-4333-8444-555555555555");
    expect(normalizedRequest.httpVersion).toBe("2.0");
  });

  it("carries the untouched raw event by reference as the escape hatch", () => {
    const event = makeHttpEvent();

    expect(normalizeHttpRequest(event).raw).toBe(event);
  });
});
