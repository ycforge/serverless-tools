import { Controller } from '@nestjs/common';
import { YandexContext, type YandexExecutionContext } from '@ycforge/nestjs-connector/context';
import { QueueHandler, QueueMessage } from '@ycforge/nestjs-connector/queue';

interface WorkerPayload {
  eventId?: string;
  fail?: boolean;
}

@Controller()
export class WorkerController {
  @QueueHandler()
  handle(
    @QueueMessage() message: QueueMessage<WorkerPayload>,
    @YandexContext() context: YandexExecutionContext,
  ): void {
    const payload = message.payload;
    if (payload?.fail === true) {
      console.log(
        JSON.stringify({
          e2eMarker: 'E2E_WORKER_FAIL',
          eventId: payload.eventId ?? null,
          traceId: context.trace_id,
        }),
      );
      throw new Error(`e2e worker fail-fast for ${payload.eventId ?? 'unknown'}`);
    }
    console.log(
      JSON.stringify({
        e2eMarker: 'E2E_WORKER_OK',
        eventId: payload?.eventId ?? null,
        traceId: context.trace_id,
      }),
    );
  }
}
