// Compile fixture (spec 003, US3/AC1): the auth subpath alone must satisfy a
// consumer without touching the package root.
import {
  AUTH_GUARD_KEY,
  AUTH_SCHEME_KEY,
  GlobalAuthGuard,
  RequireAuth,
} from "@ycforge/nestjs-connector/auth";
import type {
  AuthGuardType,
  ConnectorBootstrapOptions,
} from "@ycforge/nestjs-connector/auth";

const guard: AuthGuardType = null;
const options: ConnectorBootstrapOptions = { defaultAuthGuard: guard };

export const wiring = {
  decorator: RequireAuth("public", null),
  schemeKey: AUTH_SCHEME_KEY,
  guardKey: AUTH_GUARD_KEY,
  guardClass: GlobalAuthGuard,
  options,
};
