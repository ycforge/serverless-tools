import type { Type } from '@nestjs/common';
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
  type YandexCloudFunctionHandler,
} from '@ycforge/nestjs-connector';

export interface ConnectorDeps {
  readonly createYandexHandler?: typeof createYandexHandler;
}

export interface HandlerRuntime {
  readonly handler: YandexCloudFunctionHandler;
  readonly close: () => Promise<void>;
}

/**
 * Thin delegation wrapper (S-4, FR-007..009): the handler stays the exact
 * function returned by the connector (cold start stays lazy, R-2) and `close`
 * is memoized so shutdown is idempotent even before any invocation.
 */
export function createHandler(appModule: Type<unknown>, deps: ConnectorDeps = {}): HandlerRuntime {
  const factory = deps.createYandexHandler ?? createYandexHandler;
  const runtime = factory(appModule) as ClosableYandexCloudFunctionHandler;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    const connectorClose = (runtime as Partial<ClosableYandexCloudFunctionHandler>).close;
    if (typeof connectorClose === 'function') {
      await connectorClose.call(runtime);
    }
  };

  return { handler: runtime, close };
}