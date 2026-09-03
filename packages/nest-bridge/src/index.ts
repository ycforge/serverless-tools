/**
 * Public API surface of @ycforge/nestjs-connector.
 *
 * This file is the ONLY public entry point: `package.json` exposes just the
 * "." subpath, so deep imports of internal modules are blocked by design
 * (docs/ARCHITECTURE.md section 2).
 *
 * Rules for changing this file:
 * - every export must be listed explicitly in docs/ARCHITECTURE.md section 7;
 * - contracts ship as type-only exports until their runtime implementation
 *   lands with the owning issue (no half-working runtime code);
 * - never re-export whole modules or use wildcard barrels.
 */

// Core: runtime entry point and boundary error.
export { createYandexHandler } from "./core/create-yandex-handler";
export type { ClosableYandexCloudFunctionHandler } from "./core/create-yandex-handler";
export type { CreateYandexHandlerOptions, QueueTransportOptions } from "./core/handler-options";
export { ConnectorError } from "./core/connector-error";

// Core: transport SPI and shared invocation contracts.
export type {
  InjectableToken,
  InvocationContainer,
  TransportAdapter,
  TransportId,
  TransportInvocation,
  YandexCloudFunctionHandler,
} from "./core/transport";
export type { HasRaw } from "./core/raw-access";
export type { ConnectorErrorCode, ConnectorErrorDetail } from "./core/errors";

// HTTP / API Gateway v2 transport contracts.
export type { RawHttpApiGatewayV2Event, RawHttpApiGatewayV2RequestContext } from "./http/raw-event";
export type { NormalizedHttpRequest } from "./http/normalized-request";
export type { YandexFunctionHttpResponse } from "./http/response";

// Message Queue transport contracts.
export type {
  RawQueueEvent,
  RawQueueEventMetadata,
  RawQueueMessageAttributeValue,
  RawQueueMessageEvent,
} from "./mq/raw-event";
export type {
  QueueBatch,
  QueueBodyDeserializer,
  QueueEventMetadata,
  QueueMessageAttribute,
} from "./mq/message";

// Normalized execution context.
export type { YandexExecutionContext } from "./context/yandex-execution-context";

// Decorators. `QueueMessage` ships as one merged export (callable decorator
// plus the normalized message type it injects); see the module header of
// src/mq/queue-message.decorator.ts and docs/ARCHITECTURE.md section 7.
export { YandexContext } from "./context/yandex-context.decorator";
export { QueueHandler } from "./mq/queue-handler.decorator";
export { QueueMessage } from "./mq/queue-message.decorator";
export type {
  ContextParameterDecorator,
  QueueHandlerMethodDecorator,
  QueueMessageParameterDecorator,
} from "./decorators/decorator-contracts";

// Auth (spec 003): the `@RequireAuth` decorator contract and its metadata
// keys, mirrored by the `./auth` subpath export.
export { RequireAuth } from "./auth/require-auth.decorator";
export { AUTH_GUARD_KEY, AUTH_SCHEME_KEY } from "./auth/auth-metadata";
export type { AuthGuardType } from "./auth/auth-metadata";
export { GlobalAuthGuard } from "./auth/global-auth.guard";
export type { ConnectorBootstrapOptions } from "./auth/connector-bootstrap-options";
