import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import { firstValueFrom, isObservable } from "rxjs";
import { AUTH_GUARD_KEY, type AuthGuardType } from "./auth-metadata";
import {
  CONNECTOR_BOOTSTRAP_OPTIONS,
  type ConnectorBootstrapOptions,
} from "./connector-bootstrap-options";

/**
 * Global guard registered automatically by `createYandexHandler` on the HTTP
 * pipeline (spec 003, US2; research R2–R5).
 *
 * Per request:
 * 1. Reads {@link AUTH_GUARD_KEY} metadata with method > controller
 *    precedence (`Reflector.getAllAndOverride`).
 * 2. A declared guard class is resolved through the Nest container
 *    (`ModuleRef.get`, `strict: false`) — never constructed with `new` — and
 *    its `canActivate` decides the response. Resolution failures (guard not
 *    registered in DI) propagate as the natural Nest error; they are NOT
 *    swallowed into a silent pass.
 * 3. `guard === null` (explicit public) skips enforcement.
 * 4. No metadata on either level falls back to the bootstrap
 *    `defaultAuthGuard` (also resolved through DI); without it the request
 *    passes. A guard is NEVER derived from the scheme (FR-006).
 *
 * Scope: HTTP transport only — Message Queue dispatch does not pass through
 * this guard (FR-011).
 *
 * Constructor dependencies use explicit `@Inject` on every parameter: the
 * published bundle is built without `emitDecoratorMetadata`, so type-based
 * injection metadata is unavailable at runtime.
 */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(CONNECTOR_BOOTSTRAP_OPTIONS)
    private readonly options: ConnectorBootstrapOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const declared = this.reflector.getAllAndOverride<AuthGuardType | undefined>(AUTH_GUARD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (declared === null) {
      return true;
    }

    const guardClass = declared ?? this.options.defaultAuthGuard;
    if (guardClass === undefined || guardClass === null) {
      return true;
    }

    const guard = this.moduleRef.get<CanActivate>(guardClass, { strict: false });
    const verdict = guard.canActivate(context);
    if (typeof verdict === "boolean") {
      return verdict;
    }
    if (verdict instanceof Promise) {
      return verdict;
    }
    if (isObservable(verdict)) {
      return firstValueFrom(verdict);
    }
    return Boolean(verdict);
  }
}
