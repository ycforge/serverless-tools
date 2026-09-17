/**
 * Public entry point of the `./queue` subpath export (spec 003, FR-007):
 * pure re-exports of the existing Message Queue modules — their logic does
 * not move and does not change.
 *
 * FR-008: imports only concrete internal modules, never the root barrel.
 */
export { QueueHandler } from "../mq/queue-handler.decorator";
export { QueueMessage } from "../mq/queue-message.decorator";
export type {
  QueueHandlerMethodDecorator,
  QueueMessageParameterDecorator,
} from "../decorators/decorator-contracts";
export type {
  QueueBatch,
  QueueBodyDeserializer,
  QueueEventMetadata,
  QueueMessageAttribute,
} from "../mq/message";
export type {
  RawQueueEvent,
  RawQueueEventMetadata,
  RawQueueMessageAttributeValue,
  RawQueueMessageEvent,
} from "../mq/raw-event";
