// Compile fixture (spec 003, US3/AC3): the root barrel keeps working for
// existing applications (backward compatibility).
import {
  ConnectorError,
  createYandexHandler,
  GlobalAuthGuard,
  QueueHandler,
  QueueMessage,
  RequireAuth,
  YandexContext,
} from "@ycforge/nestjs-connector";

export const rootApi = {
  ConnectorError,
  createYandexHandler,
  GlobalAuthGuard,
  QueueHandler,
  QueueMessage,
  RequireAuth,
  YandexContext,
};
