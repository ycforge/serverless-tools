import { applyDecorators, SetMetadata } from "@nestjs/common";
import { ApiSecurity } from "@nestjs/swagger";
import { AUTH_GUARD_KEY, AUTH_SCHEME_KEY, type AuthGuardType } from "./auth-metadata";

/**
 * Declares the authentication contract of an HTTP route (spec 003, US1;
 * IDEA §11): the auth scheme name (as declared in the application's
 * `auth.yaml` — Project B's zone, the connector never validates it) and the
 * runtime guard class enforcing it.
 *
 * - Always writes {@link AUTH_SCHEME_KEY} and {@link AUTH_GUARD_KEY} metadata
 *   (read by `GlobalAuthGuard` with method > controller precedence).
 * - For any scheme other than `'public'` also applies `ApiSecurity(scheme)`,
 *   so the generated OpenAPI document carries the security requirement.
 * - `guard === null` means an explicitly public route: `GlobalAuthGuard`
 *   skips enforcement. A non-public scheme with `guard === null` is allowed
 *   (scheme enforcement then happens at the API Gateway) — scheme and guard
 *   are independent by design.
 * - HTTP-only: on `@QueueHandler()` methods the metadata has no effect
 *   (FR-011).
 *
 * The decorator is a plain higher-order function, so project-local wrappers
 * compose freely: `export const Public = () => RequireAuth('public', null)`.
 *
 * @throws TypeError when `scheme` is not a non-empty string (fail-fast).
 */
export function RequireAuth(
  scheme: string,
  guard: AuthGuardType,
): MethodDecorator & ClassDecorator {
  if (typeof scheme !== "string" || scheme.length === 0) {
    throw new TypeError(
      `RequireAuth: scheme must be a non-empty string, received ${typeof scheme === "string" ? '""' : String(scheme)}.`,
    );
  }
  return applyDecorators(
    SetMetadata(AUTH_GUARD_KEY, guard),
    SetMetadata(AUTH_SCHEME_KEY, scheme),
    scheme === "public" ? () => {} : ApiSecurity(scheme),
  );
}
