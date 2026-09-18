import { signSigV4 } from "./sigv4";

const CREDENTIALS = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

describe("signSigV4 (spec 037)", () => {
  it("produces an AWS4-HMAC-SHA256 authorization with the expected scope and signed headers", () => {
    const headers = signSigV4({
      method: "POST",
      url: "https://message-queue.api.cloud.yandex.net/",
      region: "ru-central1",
      service: "sqs",
      credentials: CREDENTIALS,
      body: "Action=SendMessage&Version=2012-11-05",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      now: new Date("2015-08-30T12:36:00.000Z"),
    });

    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers["x-amz-content-sha256"]).toBe(
      "f15ea2b342501a03b1a5691660eed9e5a49029ac735dcfcba50e458c8c43b588",
    );
    expect(headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/ru-central1\/sqs\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(headers.host).toBe("message-queue.api.cloud.yandex.net");
  });

  it("is deterministic for identical input", () => {
    const base = {
      method: "POST",
      url: "https://message-queue.api.cloud.yandex.net/",
      region: "ru-central1",
      service: "sqs",
      credentials: CREDENTIALS,
      body: "Action=SendMessage",
      now: new Date("2026-01-01T00:00:00.000Z"),
    } as const;
    expect(signSigV4(base).Authorization).toBe(signSigV4(base).Authorization);
  });

  it("changes the signature when the date, region or credentials change", () => {
    const base = {
      method: "POST",
      url: "https://message-queue.api.cloud.yandex.net/",
      region: "ru-central1",
      service: "sqs",
      credentials: CREDENTIALS,
      body: "Action=SendMessage",
      now: new Date("2026-01-01T00:00:00.000Z"),
    } as const;
    const original = signSigV4(base).Authorization;
    expect(signSigV4({ ...base, now: new Date("2026-01-02T00:00:00.000Z") }).Authorization).not.toBe(original);
    expect(signSigV4({ ...base, region: "us-east-1" }).Authorization).not.toBe(original);
    expect(
      signSigV4({ ...base, credentials: { ...CREDENTIALS, secretAccessKey: "other" } }).Authorization,
    ).not.toBe(original);
  });

  it("canonicalizes query parameters independently of input order", () => {
    const first = signSigV4({
      method: "GET",
      url: "https://example.com/path?b=2&a=1",
      region: "ru-central1",
      service: "sqs",
      credentials: CREDENTIALS,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }).Authorization;
    const second = signSigV4({
      method: "GET",
      url: "https://example.com/path?a=1&b=2",
      region: "ru-central1",
      service: "sqs",
      credentials: CREDENTIALS,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }).Authorization;
    expect(first).toBe(second);
  });
});
