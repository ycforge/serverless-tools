import {
  Injectable,
  Module,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "../../src/core/create-yandex-handler";
import { QueueHandler } from "../../src/mq/queue-handler.decorator";
import { QueueMessage } from "../../src/mq/queue-message.decorator";
import type { RawQueueEvent } from "../../src/mq/raw-event";
import { RequireAuth } from "../../src/auth";

/**
 * FR-011 scope pin (spec 003, US2): `@RequireAuth` is HTTP-only. A
 * `@QueueHandler()` method carrying auth metadata must receive MQ
 * deliveries unchanged — the Message Queue dispatch path never passes
 * through the HTTP guard pipeline.
 *
 * The guard below would deny every request if it were ever consulted; the
 * delivery succeeding proves it never is.
 */

const QUEUE_ID = "yrn:yc:ymq:ru-central1:b1g00000000000000000:f-test";

const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-mq-auth-scope",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

function makeQueueDelivery(body: string): RawQueueEvent {
  return {
    messages: [
      {
        event_metadata: {
          event_id: "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8",
          event_type: "yandex.cloud.events.messagequeue.QueueMessage",
          created_at: "2026-08-21T21:44:34.266Z",
          tracing_context: null,
          cloud_id: "a1b2c3d4000000000000",
          folder_id: "e5f6a7b8000000000000",
        },
        details: {
          queue_id: QUEUE_ID,
          message: {
            message_id: "7f3a-c91d2e4b6a83405fb1d09c7-52d4e8",
            md5_of_body: "9e107d9d372bb6826bd81d3542a419d6",
            body,
            attributes: {
              ApproximateReceiveCount: "1",
              SentTimestamp: "1787328274187",
            },
            message_attributes: {},
            md5_of_message_attributes: "",
          },
        },
      },
    ],
  };
}

@Injectable()
class DenyEverythingGuard implements CanActivate {
  static calls = 0;

  canActivate(_context: ExecutionContext): boolean {
    DenyEverythingGuard.calls += 1;
    return false;
  }
}

@Injectable()
class OrderConsumer {
  static readonly handled: unknown[] = [];

  @QueueHandler()
  @RequireAuth("user", DenyEverythingGuard)
  handle(@QueueMessage() message: QueueMessage<{ orderId?: string }>): void {
    OrderConsumer.handled.push(message.payload);
  }
}

@Module({ providers: [OrderConsumer, DenyEverythingGuard] })
class QueueModule {}

describe("@RequireAuth on MQ handlers is inert (FR-011)", () => {
  let runtime: ClosableYandexCloudFunctionHandler | null = null;

  beforeEach(() => {
    DenyEverythingGuard.calls = 0;
    OrderConsumer.handled.length = 0;
  });

  afterEach(async () => {
    await runtime?.close();
    runtime = null;
  });

  it("delivers the message without consulting any guard", async () => {
    runtime = createYandexHandler(QueueModule);

    await runtime(makeQueueDelivery('{"orderId":"order-fixture"}'), RUNTIME_CONTEXT);

    expect(OrderConsumer.handled).toEqual([{ orderId: "order-fixture" }]);
    expect(DenyEverythingGuard.calls).toBe(0);
  });
});
