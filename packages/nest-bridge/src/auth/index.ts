/**
 * Public entry point of the `./auth` subpath export (spec 003, FR-007).
 *
 * FR-008: this module imports only concrete internal modules, never the root
 * barrel `src/index.ts`; the static guard test in
 * `test/packaging/no-root-barrel-import.spec.ts` enforces it.
 */
export { RequireAuth } from "./require-auth.decorator";
export { AUTH_GUARD_KEY, AUTH_SCHEME_KEY } from "./auth-metadata";
export type { AuthGuardType } from "./auth-metadata";
export { GlobalAuthGuard } from "./global-auth.guard";
export type { ConnectorBootstrapOptions } from "./connector-bootstrap-options";
