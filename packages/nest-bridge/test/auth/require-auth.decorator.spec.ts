import "reflect-metadata";
import { SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
/** Metadata key used by `@nestjs/swagger` `ApiSecurity` (its `API_SECURITY_KEY`); the deep constants import is not in swagger's exports map. */
const API_SECURITY_KEY = "swagger/apiSecurity";
import { AUTH_GUARD_KEY, AUTH_SCHEME_KEY } from "../../src/auth/auth-metadata";
import { RequireAuth } from "../../src/auth/require-auth.decorator";

/**
 * Unit specs for the `@RequireAuth` decorator metadata contract (spec 003,
 * US1 / contracts/auth-decorator.md): the decorator only WRITES metadata —
 * runtime enforcement lives in GlobalAuthGuard (US2), OpenAPI consumption in
 * Project B.
 */

class UserAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

class AdminGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

function readSecurityMetadata(target: object): unknown {
  return Reflect.getMetadata(API_SECURITY_KEY, target);
}

describe("RequireAuth decorator metadata", () => {
  it("writes scheme, guard and ApiSecurity on a controller class (US1/AC1)", () => {
    @RequireAuth("user", UserAuthGuard)
    class SecureController {}

    expect(Reflect.getMetadata(AUTH_SCHEME_KEY, SecureController)).toBe("user");
    expect(Reflect.getMetadata(AUTH_GUARD_KEY, SecureController)).toBe(UserAuthGuard);
    expect(readSecurityMetadata(SecureController)).toEqual([{ user: [] }]);
  });

  it("writes both keys and ApiSecurity on a method (US1/AC2)", () => {
    class SecureController {
      @RequireAuth("admin", AdminGuard)
      handler(): void {}
    }

    const descriptor = Object.getOwnPropertyDescriptor(SecureController.prototype, "handler");
    expect(descriptor).toBeDefined();
    expect(Reflect.getMetadata(AUTH_SCHEME_KEY, SecureController.prototype.handler)).toBe(
      "admin",
    );
    expect(Reflect.getMetadata(AUTH_GUARD_KEY, SecureController.prototype.handler)).toBe(
      AdminGuard,
    );
    expect(readSecurityMetadata(SecureController.prototype.handler)).toEqual([{ admin: [] }]);
  });

  it("records public scheme with null guard and NO ApiSecurity metadata (US1/AC3, FR-002)", () => {
    class PublicController {
      @RequireAuth("public", null)
      handler(): void {}
    }

    expect(Reflect.getMetadata(AUTH_SCHEME_KEY, PublicController.prototype.handler)).toBe(
      "public",
    );
    expect(Reflect.getMetadata(AUTH_GUARD_KEY, PublicController.prototype.handler)).toBeNull();
    expect(
      Reflect.hasMetadata(API_SECURITY_KEY, PublicController.prototype.handler),
    ).toBe(false);
  });

  it("project-local wrapper produces metadata identical to direct application (US1/AC4, FR-009)", () => {
    const Public = (): MethodDecorator & ClassDecorator => RequireAuth("public", null);

    class DirectController {
      @RequireAuth("public", null)
      handler(): void {}
    }
    class WrappedController {
      @Public()
      handler(): void {}
    }

    for (const key of [AUTH_SCHEME_KEY, AUTH_GUARD_KEY]) {
      expect(Reflect.getMetadata(key, WrappedController.prototype.handler)).toEqual(
        Reflect.getMetadata(key, DirectController.prototype.handler),
      );
    }
    expect(
      Reflect.hasMetadata(API_SECURITY_KEY, WrappedController.prototype.handler),
    ).toBe(Reflect.hasMetadata(API_SECURITY_KEY, DirectController.prototype.handler));
  });

  it("throws TypeError on an empty or non-string scheme (data-model validation, fail-fast)", () => {
    expect(() => RequireAuth("", null)).toThrow(TypeError);
    expect(() => RequireAuth(42 as unknown as string, null)).toThrow(TypeError);
    expect(() => RequireAuth(undefined as unknown as string, null)).toThrow(TypeError);
  });

  it("composes with other SetMetadata-based decorators without clobbering them", () => {
    class ComposedController {
      @SetMetadata("app:role", "editor")
      @RequireAuth("user", UserAuthGuard)
      handler(): void {}
    }

    expect(Reflect.getMetadata("app:role", ComposedController.prototype.handler)).toBe(
      "editor",
    );
    expect(Reflect.getMetadata(AUTH_SCHEME_KEY, ComposedController.prototype.handler)).toBe(
      "user",
    );
  });
});
