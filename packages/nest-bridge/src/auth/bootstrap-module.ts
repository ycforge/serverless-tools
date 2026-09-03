import { Module, type Type } from "@nestjs/common";
import {
  CONNECTOR_BOOTSTRAP_OPTIONS,
  type ConnectorBootstrapOptions,
} from "./connector-bootstrap-options";
import { GlobalAuthGuard } from "./global-auth.guard";

/**
 * Internal bootstrap wrapper (spec 003, research R2/R5): wraps the
 * application module so the connector can register its own providers — the
 * options token and `GlobalAuthGuard` — without requiring the application to
 * declare them. `createYandexHandler` creates the Nest application from this
 * wrapper and then registers the resolved guard via `useGlobalGuards`
 * (HTTP pipeline only, before `init()`).
 */
export function createConnectorBootstrapModule(
  appModule: Type<unknown>,
  options: ConnectorBootstrapOptions,
): Type<unknown> {
  @Module({
    imports: [appModule],
    providers: [{ provide: CONNECTOR_BOOTSTRAP_OPTIONS, useValue: options }, GlobalAuthGuard],
  })
  class ConnectorBootstrapModule {}
  return ConnectorBootstrapModule;
}
