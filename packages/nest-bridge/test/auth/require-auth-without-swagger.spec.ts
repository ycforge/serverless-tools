import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";

/**
 * `@nestjs/swagger` is an optional peer of the connector: an application that
 * never emits an OpenAPI document must not be forced to install it. This spec
 * pins the degraded path — with swagger unavailable, `@RequireAuth` still
 * writes the connector's own metadata and simply omits the OpenAPI security
 * requirement instead of throwing at decoration time.
 */
vi.mock("../../src/auth/api-security", () => ({
  loadApiSecurity: () => undefined,
}));

/** Metadata key used by `@nestjs/swagger` `ApiSecurity` (its `API_SECURITY_KEY`). */
const API_SECURITY_KEY = "swagger/apiSecurity";

import { AUTH_GUARD_KEY, AUTH_SCHEME_KEY } from "../../src/auth/auth-metadata";
import { RequireAuth } from "../../src/auth/require-auth.decorator";

class UserAuthGuard {
  canActivate(): boolean {
    return true;
  }
}

describe("RequireAuth without @nestjs/swagger installed", () => {
  it("still writes scheme and guard metadata", () => {
    @RequireAuth("user", UserAuthGuard)
    class SecureController {}

    expect(Reflect.getMetadata(AUTH_SCHEME_KEY, SecureController)).toBe("user");
    expect(Reflect.getMetadata(AUTH_GUARD_KEY, SecureController)).toBe(UserAuthGuard);
  });

  it("omits ApiSecurity metadata instead of failing", () => {
    class SecureController {
      @RequireAuth("admin", UserAuthGuard)
      handler(): void {}
    }

    expect(Reflect.hasMetadata(API_SECURITY_KEY, SecureController.prototype.handler)).toBe(false);
  });
});
