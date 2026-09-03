import type { CanActivate, Type } from "@nestjs/common";

/**
 * Single source of truth for the auth metadata contract (spec 003,
 * data-model.md): `RequireAuth` writes these keys on the decorated target,
 * `GlobalAuthGuard` reads them with method > controller precedence.
 *
 * The key strings are part of the public contract — they are stable across
 * releases and never renamed.
 */

/** Metadata key carrying the auth scheme name (a string from the application's `auth.yaml`; the connector never validates it — that is Project B's zone). */
export const AUTH_SCHEME_KEY = "ycsf:auth:scheme";

/** Metadata key carrying the runtime guard class, or `null` for an explicitly public route. */
export const AUTH_GUARD_KEY = "ycsf:auth:guard";

/** Value stored under {@link AUTH_GUARD_KEY}: a Nest guard class, or `null` for explicit public access. */
export type AuthGuardType = Type<CanActivate> | null;
