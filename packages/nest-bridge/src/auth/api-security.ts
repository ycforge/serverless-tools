import { createRequire } from "node:module";

/**
 * Type of `@nestjs/swagger`'s `ApiSecurity` factory, structurally redeclared so
 * the connector never statically imports swagger (spec: optional peer).
 */
export type ApiSecurityDecorator = (name: string) => MethodDecorator & ClassDecorator;

/**
 * Resolves `@nestjs/swagger`'s `ApiSecurity` **optionally**.
 *
 * Swagger is an optional peer of this package: an application that never emits
 * an OpenAPI document must not be forced to install it. `RequireAuth` still
 * wants to attach the security requirement when swagger IS present, so the
 * module is loaded through `createRequire` at decoration time and any failure
 * (missing module, incompatible shape) degrades to `undefined` instead of
 * breaking the decorator.
 *
 * The require base is format-agnostic: the CJS build defines `__filename`, the
 * ESM build falls back to `import.meta.url`. Both resolve `@nestjs/swagger`
 * from the consuming application's `node_modules`.
 */
export function loadApiSecurity(): ApiSecurityDecorator | undefined {
  try {
    const base = typeof __filename === "string" ? __filename : import.meta.url;
    const require = createRequire(base);
    const mod = require("@nestjs/swagger") as { ApiSecurity?: unknown };
    return typeof mod.ApiSecurity === "function"
      ? (mod.ApiSecurity as ApiSecurityDecorator)
      : undefined;
  } catch {
    return undefined;
  }
}
