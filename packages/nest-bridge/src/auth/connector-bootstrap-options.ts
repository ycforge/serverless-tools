import type { CanActivate, Type } from "@nestjs/common";

/**
 * Bootstrap options accepted by `createYandexHandler` (spec 003, US2;
 * contracts/auth-decorator.md). The object is registered in the Nest
 * container under {@link CONNECTOR_BOOTSTRAP_OPTIONS} by the connector
 * bootstrap module, so `GlobalAuthGuard` receives it through DI.
 */
export interface ConnectorBootstrapOptions {
  /**
   * Project-default guard applied to HTTP routes that carry NO auth metadata
   * on either the method or the controller (FR-006). `null`/`undefined`
   * disables the default; it is never consulted when `@RequireAuth` metadata
   * is present (even with `guard === null`), and a guard is never derived
   * from a scheme name.
   */
  readonly defaultAuthGuard?: Type<CanActivate> | null;
}

/**
 * Injection token under which the connector bootstrap registers the
 * {@link ConnectorBootstrapOptions} object. Internal wiring; exported so
 * custom bootstrap setups can re-register it when constructing
 * `GlobalAuthGuard` outside `createYandexHandler`.
 */
export const CONNECTOR_BOOTSTRAP_OPTIONS = "YCSF_CONNECTOR_BOOTSTRAP_OPTIONS";
