import { DlqSender } from "./dlq-sender";

describe("DlqSender", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("send", () => {
    it("sends a POST request with base64-encoded body to the correct URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: "test-token", expires_in: 3600 }),
      });
      globalThis.fetch = fetchMock;

      const sender = new DlqSender();
      const result = await sender.send("hello world", "dlq-queue-id");

      expect(result).toBe(true);

      // First call: IAM token fetch
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [iamCall, mqCall] = fetchMock.mock.calls;

      // IAM token call
      expect(iamCall![0]).toContain("169.254.169.254");
      expect(iamCall![1].headers).toEqual({ "Metadata-Flavor": "Google" });

      // MQ API call
      expect(mqCall![0]).toContain("/queues/dlq-queue-id/messages");
      expect(mqCall![1].method).toBe("POST");
      const body = JSON.parse(mqCall![1].body as string);
      expect(body.messageBody).toBe(Buffer.from("hello world").toString("base64"));
    });

    it("returns false when fetch throws", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
        })
        .mockRejectedValueOnce(new Error("network error"));

      const sender = new DlqSender();
      const result = await sender.send("body", "queue-id");

      expect(result).toBe(false);
      // Failures are logged (T004/T015), never thrown (fail-open, FR-011).
      const warned = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(warned).toContain("DLQ publish failed");
      expect(warned).toContain("queue-id");
      warnSpy.mockRestore();
    });

    it("returns false when response is not ok", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      const sender = new DlqSender();
      const result = await sender.send("body", "queue-id");

      expect(result).toBe(false);
      const warned = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(warned).toContain("HTTP 500");
      expect(warned).toContain("queue-id");
      warnSpy.mockRestore();
    });
  });

  describe("IAM token caching", () => {
    it("reuses cached token across calls", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "test-token", expires_in: 3600 }),
      });
      globalThis.fetch = fetchMock;

      const sender = new DlqSender();

      // First send fetches token + sends MQ request = 2 calls
      await sender.send("body1", "queue-id");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Second send reuses token (no IAM call) = 1 more call
      await sender.send("body2", "queue-id");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("sendBatch", () => {
    it("sends all failures and returns count of successful sends", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: "batch-token", expires_in: 3600 }),
      });
      globalThis.fetch = fetchMock;

      const sender = new DlqSender();
      const sent = await sender.sendBatch(
        [
          { messageId: "m-1", body: "body-1" },
          { messageId: "m-2", body: "body-2" },
        ],
        "dlq-id",
      );

      // 1 IAM token (first send fetches, second reuses cache) + 2 MQ sends = 3 calls
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sent).toBe(2);
    });

    it("reports partial success when some sends fail", async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount += 1;
        // IAM token call always succeeds; MQ sends: first ok, second fails
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
          });
        }
        if (callCount === 2) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500 });
      });
      globalThis.fetch = fetchMock;

      const sender = new DlqSender();
      const sent = await sender.sendBatch(
        [
          { messageId: "m-1", body: "b1" },
          { messageId: "m-2", body: "b2" },
        ],
        "q",
      );

      expect(sent).toBe(1);
    });

    it("logs a per-message warning naming the failed messageId", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
          });
        }
        if (callCount === 2) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500 });
      });
      globalThis.fetch = fetchMock;

      const sender = new DlqSender();
      const sent = await sender.sendBatch(
        [
          { messageId: "m-ok", body: "b1" },
          { messageId: "m-lost", body: "b2" },
        ],
        "q",
      );

      expect(sent).toBe(1);
      const warned = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(warned).toContain("message m-lost");
      expect(warned).toContain("queue q");
      // No payload values leak into the warning (FR-010).
      expect(warned).not.toContain("b1");
      expect(warned).not.toContain("b2");
      warnSpy.mockRestore();
    });
  });
});
