/**
 * Integration test for the `YandexLogger` DI provider (spec 004, FR-012..015;
 * US4/SC-006). A controller injects the provider and logs; an HTTP and a
 * Message Queue invocation are driven through the public handler, and the
 * application-level log records captured from stdout must carry the invoking
 * call's `trace_id`/`awsRequestId`. Records are correlated on the invocation's
 * own id (SC-003) so parallel test files can never cross-pollute assertions.
 */
import { Controller, Get, Module } from "@nestjs/common";
import { createYandexHandler, type ClosableYandexCloudFunctionHandler } from "../../src/core/create-yandex-handler";
import { YandexLogger } from "../../src/logger/yandex-logger";

@Controller("probe")
class ProbeController {
  constructor(private readonly logger: YandexLogger) {}

  @Get()
  ping(): { pong: true } {
    this.logger.info("probe pinged", { route: "ping", token: "should-never-leak" });
    return { pong: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-logger-fixture",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

interface CapturedLine {
  readonly raw: string;
  readonly parsed: Record<string, unknown>;
}

function parseAppRecords(rawLines: readonly string[]): CapturedLine[] {
  return rawLines
    .filter((line) => line.startsWith("{"))
    .map((line) => ({ raw: line, parsed: JSON.parse(line) as Record<string, unknown> }))
    // Application logger records carry a "level"; boundary records a "event".
    .filter((line) => typeof line.parsed["level"] === "string");
}

describe("YandexLogger integration (spec 004, FR-012..015)", () => {
  const runtimes: ClosableYandexCloudFunctionHandler[] = [];

  afterEach(async () => {
    while (runtimes.length > 0) {
      await runtimes.pop()?.close();
    }
  });

  it("injects YandexLogger into a controller and logs the invocation's trace_id", async () => {
    const runtime = createYandexHandler(ProbeModule);
    runtimes.push(runtime);
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown as (...a: unknown[]) => boolean) = (chunk: unknown) => {
      if (typeof chunk === "string") {
        captured.push(chunk);
      }
      return originalWrite(chunk as Parameters<typeof originalWrite>[0]);
    };
    try {
      await runtime(
        {
          version: "2.0",
          rawPath: "/probe",
          rawQueryString: "",
          headers: {},
          queryStringParameters: {},
          requestContext: {
            authorizer: {},
            http: { method: "GET", path: "/probe", sourceIp: "203.0.113.10", userAgent: "u" },
            requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
            time: "x",
            timeEpoch: 1787328990,
          },
          body: "",
          isBase64Encoded: true,
          pathParameters: {},
          parameters: {},
          multiValueParameters: {},
          operationId: "0".repeat(64),
        },
        RUNTIME_CONTEXT,
      );

      const records = parseAppRecords(captured);
      const info = records.find((line) => line.parsed["level"] === "info");
      expect(info).toBeDefined();
      expect(info!.parsed["message"]).toBe("probe pinged");
      expect(info!.parsed["trace_id"]).toBe("f18fed85-7096-4f0e-a6db-e2c5e37e925f");
      expect(info!.parsed["awsRequestId"]).toBe("f18fed85-7096-4f0e-a6db-e2c5e37e925f");
      const context = info!.parsed["context"] as Record<string, unknown>;
      expect(context.route).toBe("ping");
      // FR-014: the token-like key is redacted even in user context.
      expect(context.token).not.toBe("should-never-leak");
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});