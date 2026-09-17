import { Global, Module, type Type } from "@nestjs/common";
import { YandexLogger } from "../logger/yandex-logger";
import {
  CONNECTOR_BOOTSTRAP_OPTIONS,
  type ConnectorBootstrapOptions,
} from "./connector-bootstrap-options";
import { GlobalAuthGuard } from "./global-auth.guard";

/**
 * Internal bootstrap wrapper (spec 003, research R2/R5): wraps the
 * application module so the connector can register its own providers — the
 * options token, `GlobalAuthGuard` and the `YandexLogger` application logger —
 * without requiring the application to declare them. `createYandexHandler`
 * creates the Nest application from this wrapper and then registers the
 * resolved guard via `useGlobalGuards` (HTTP pipeline only, before `init()`).
 *
 * `@Global()` (spec 004 FR-012, research R6) combined with `exports: [YandexLogger]`
 * makes the logger visible to EVERY module of the application — including
 * components of `AppModule` covered via `imports` — without the user having to
 * re-export or declare the token in each consumer (explicit, but not magic:
 * the global scope is documented in the contract, contracts §4).
 */
export function createConnectorBootstrapModule(
  appModule: Type<unknown>,
  options: ConnectorBootstrapOptions,
): Type<unknown> {
  @Global()
  @Module({
    imports: [appModule],
    providers: [
      { provide: CONNECTOR_BOOTSTRAP_OPTIONS, useValue: options },
      GlobalAuthGuard,
      { provide: YandexLogger, useClass: YandexLogger },
    ],
    // A @Global module only surfaces providers listed in its exports; the
    // YandexLogger is exported so it is injectable into every application
    // component (FR-012) without the app declaring or re-exporting it.
    exports: [YandexLogger],
  })
  class ConnectorBootstrapModule {}
  return ConnectorBootstrapModule;
}
