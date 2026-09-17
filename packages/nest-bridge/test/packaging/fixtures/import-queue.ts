// Compile fixture (spec 003, US3/AC2): queue contracts via the /queue subpath.
import { QueueHandler, QueueMessage } from "@ycforge/nestjs-connector/queue";

class Consumer {
  @QueueHandler()
  handle(@QueueMessage() message: QueueMessage): string {
    return message.messageId;
  }
}

export const consumer = Consumer;
