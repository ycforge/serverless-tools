import { DlqSender } from "./dlq-sender";

const CREDENTIALS = { accessKeyId: "YCACCESSKEY", secretAccessKey: "secret-key-value" };
const QUEUE_URL =
  "https://message-queue.api.cloud.yandex.net/b1g1/dj6000000000000000000/my-dlq";

describe("DlqSender (spec 037: SigV4 static credentials)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("send", () => {
    it("POSTs a SigV4-signed SendMessage to the YMQ endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      globalThis.fetch = fetchMock;

      const sender = new DlqSender({ credentials: CREDENTIALS });
      const result = await sender.send("hello world", QUEUE_URL);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://message-queue.api.cloud.yandex.net/");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=YCACCESSKEY\//);
      expect(headers.Authorization).toContain("SignedHeaders=");
      expect(headers.Authorization).toContain("x-amz-date");
      expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("Action")).toBe("SendMessage");
      expect(body.get("Version")).toBe("2012-11-05");
      expect(body.get("QueueUrl")).toBe(QUEUE_URL);
      expect(body.get("MessageBody")).toBe("hello world");
    });

    it("resolves credentials from YC_MQ_* environment variables", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      globalThis.fetch = fetchMock;
      const previousId = process.env.YC_MQ_KEY_ID;
      const previousSecret = process.env.YC_MQ_KEY_VALUE;
      process.env.YC_MQ_KEY_ID = "ENVKEY";
      process.env.YC_MQ_KEY_VALUE = "envsecret";
      try {
        const result = await new DlqSender().send("b", QUEUE_URL);
        expect(result).toBe(true);
        const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
        expect(headers.Authorization).toContain("Credential=ENVKEY/");
      } finally {
        if (previousId === undefined) delete process.env.YC_MQ_KEY_ID;
        else process.env.YC_MQ_KEY_ID = previousId;
        if (previousSecret === undefined) delete process.env.YC_MQ_KEY_VALUE;
        else process.env.YC_MQ_KEY_VALUE = previousSecret;
      }
    });

    it("returns false and warns when no credentials are configured", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const previousId = process.env.YC_MQ_KEY_ID;
      const previousAwsId = process.env.AWS_ACCESS_KEY_ID;
      const previousSecret = process.env.YC_MQ_KEY_VALUE;
      const previousAwsSecret = process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.YC_MQ_KEY_ID;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.YC_MQ_KEY_VALUE;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      globalThis.fetch = vi.fn();
      try {
        const result = await new DlqSender().send("b", QUEUE_URL);
        expect(result).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(warnSpy.mock.calls.map((a) => String(a[0])).join("\n")).toContain(
          "no static credentials configured",
        );
      } finally {
        if (previousId !== undefined) process.env.YC_MQ_KEY_ID = previousId;
        if (previousAwsId !== undefined) process.env.AWS_ACCESS_KEY_ID = previousAwsId;
        if (previousSecret !== undefined) process.env.YC_MQ_KEY_VALUE = previousSecret;
        if (previousAwsSecret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = previousAwsSecret;
      }
      warnSpy.mockRestore();
    });

    it("returns false and warns when deadLetterQueueId is a bare id, not a URL", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.fetch = vi.fn();
      const result = await new DlqSender({ credentials: CREDENTIALS }).send("b", "dj6000000000000000000");
      expect(result).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(warnSpy.mock.calls.map((a) => String(a[0])).join("\n")).toContain("queue URL");
      warnSpy.mockRestore();
    });

    it("returns false when fetch throws (fail-open)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
      const result = await new DlqSender({ credentials: CREDENTIALS }).send("body", QUEUE_URL);
      expect(result).toBe(false);
      expect(warnSpy.mock.calls.map((a) => String(a[0])).join("\n")).toContain("DLQ publish failed");
      warnSpy.mockRestore();
    });

    it("returns false when the response is not ok", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const result = await new DlqSender({ credentials: CREDENTIALS }).send("body", QUEUE_URL);
      expect(result).toBe(false);
      expect(warnSpy.mock.calls.map((a) => String(a[0])).join("\n")).toContain("HTTP 403");
      warnSpy.mockRestore();
    });
  });

  describe("sendBatch", () => {
    it("sends all failures and returns the count of successful sends", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const sent = await new DlqSender({ credentials: CREDENTIALS }).sendBatch(
        [
          { messageId: "m-1", body: "body-1" },
          { messageId: "m-2", body: "body-2" },
        ],
        QUEUE_URL,
      );
      expect(sent).toBe(2);
    });

    it("reports partial success and warns by messageId without leaking bodies", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: false, status: 500 });
      const sent = await new DlqSender({ credentials: CREDENTIALS }).sendBatch(
        [
          { messageId: "m-ok", body: "secret-body-1" },
          { messageId: "m-lost", body: "secret-body-2" },
        ],
        QUEUE_URL,
      );
      expect(sent).toBe(1);
      const warned = warnSpy.mock.calls.map((a) => String(a[0])).join("\n");
      expect(warned).toContain("message m-lost");
      expect(warned).not.toContain("secret-body-1");
      expect(warned).not.toContain("secret-body-2");
      warnSpy.mockRestore();
    });
  });
});
