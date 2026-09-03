import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import {
  createYandexHandler,
  type ClosableYandexCloudFunctionHandler,
} from "../../src/core/create-yandex-handler";
import type { RawHttpApiGatewayV2Event } from "../../src/http/raw-event";
import { RequireAuth } from "../../src/auth";

/**
 * Integration specs for the runtime auth contract (spec 003, US2;
 * contracts/auth-decorator.md): `createYandexHandler` registers
 * `GlobalAuthGuard` automatically, the guard reads `ycsf:auth:guard` metadata
 * with method > controller precedence and delegates to the declared guard
 * through Nest DI — never `new`, never derived from the scheme.
 *
 * Guard call recording uses statics (reset in beforeEach) so assertions are
 * independent of how Nest scopes provider instances.
 */

interface WireResponse {
  statusCode: number;
  body: string;
}

function makeHttpEvent(path: string): RawHttpApiGatewayV2Event {
  return {
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers: { Accept: "*/*" },
    queryStringParameters: {},
    requestContext: {
      authorizer: {},
      http: {
        method: "GET",
        path: `${path}?`,
        sourceIp: "203.0.113.10",
        userAgent: "fixture-agent/1.0",
      },
      requestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
      time: "21/Aug/2026:16:16:30 +0000",
      timeEpoch: 1787328990,
    },
    body: "",
    isBase64Encoded: true,
    pathParameters: {},
    parameters: {},
    multiValueParameters: {},
    operationId: "41cf33042e33".padEnd(64, "0"),
  };
}

/** Observed-shape runtime context, placeholder values only. */
const RUNTIME_CONTEXT = {
  awsRequestId: "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  functionName: "fn-auth-integration",
  functionVersion: "$LATEST",
  functionFolderId: "folder-fixture",
  memoryLimitInMB: "1024",
  deadlineMs: 1787328996791,
  logGroupName: "",
};

@Injectable()
class UserAuthGuard implements CanActivate {
  static calls = 0;
  static verdict = true;

  canActivate(_context: ExecutionContext): boolean {
    UserAuthGuard.calls += 1;
    return UserAuthGuard.verdict;
  }
}

@Injectable()
class AdminGuard implements CanActivate {
  static calls = 0;

  canActivate(_context: ExecutionContext): boolean {
    AdminGuard.calls += 1;
    return true;
  }
}

@Injectable()
class DefaultProjectGuard implements CanActivate {
  static calls = 0;

  canActivate(_context: ExecutionContext): boolean {
    DefaultProjectGuard.calls += 1;
    return true;
  }
}

/** Guard whose own dependency must come from the Nest container (US2/AC4). */
@Injectable()
class TokenDirectory {
  readonly marker = "token-directory-instance";
}

@Injectable()
class DiAwareGuard implements CanActivate {
  static seenMarker: unknown;

  constructor(@Inject(TokenDirectory) private readonly tokens: TokenDirectory) {}

  canActivate(_context: ExecutionContext): boolean {
    DiAwareGuard.seenMarker = this.tokens.marker;
    return true;
  }
}

/** Deliberately NOT registered in any module (Edge Case: DI resolve must fail loudly). */
@Injectable()
class UnregisteredGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

@Controller("secure")
@RequireAuth("user", UserAuthGuard)
class SecureController {
  @Get("profile")
  profile(): object {
    return { profile: true };
  }

  @Get("admin")
  @RequireAuth("admin", AdminGuard)
  admin(): object {
    return { admin: true };
  }

  @Get("health")
  @RequireAuth("public", null)
  health(): object {
    return { ok: true };
  }

  @Get("gateway-only")
  @RequireAuth("user", null)
  gatewayOnly(): object {
    return { gatewayOnly: true };
  }
}

@Controller("plain")
class PlainController {
  @Get("info")
  info(): object {
    return { info: true };
  }
}

@Controller("di")
@RequireAuth("user", DiAwareGuard)
class DiController {
  @Get("check")
  check(): object {
    return { checked: true };
  }
}

@Controller("broken")
@RequireAuth("user", UnregisteredGuard)
class BrokenController {
  @Get("resource")
  resource(): object {
    return { reached: true };
  }
}

@Module({
  controllers: [SecureController, PlainController, DiController, BrokenController],
  providers: [UserAuthGuard, AdminGuard, DefaultProjectGuard, TokenDirectory, DiAwareGuard],
})
class AppModule {}

describe("GlobalAuthGuard runtime enforcement (US2)", () => {
  let runtime: ClosableYandexCloudFunctionHandler | null = null;

  beforeEach(() => {
    UserAuthGuard.calls = 0;
    UserAuthGuard.verdict = true;
    AdminGuard.calls = 0;
    DefaultProjectGuard.calls = 0;
    DiAwareGuard.seenMarker = undefined;
  });

  afterEach(async () => {
    await runtime?.close();
    runtime = null;
  });

  function startRuntime(options?: Parameters<typeof createYandexHandler>[1]): void {
    runtime = createYandexHandler(AppModule, options);
  }

  it("routes a controller-level guard through DI and lets its verdict decide (US2/AC1)", async () => {
    startRuntime();

    const allowed = (await runtime!(makeHttpEvent("/secure/profile"), RUNTIME_CONTEXT)) as WireResponse;
    expect(allowed.statusCode).toBe(200);
    expect(UserAuthGuard.calls).toBe(1);

    UserAuthGuard.verdict = false;
    const denied = (await runtime!(makeHttpEvent("/secure/profile"), RUNTIME_CONTEXT)) as WireResponse;
    expect(denied.statusCode).toBe(403);
    expect(UserAuthGuard.calls).toBe(2);
  });

  it("applies method-level metadata over controller-level (US2/AC2, SC-002)", async () => {
    UserAuthGuard.verdict = false;
    startRuntime();

    const response = (await runtime!(makeHttpEvent("/secure/admin"), RUNTIME_CONTEXT)) as WireResponse;

    expect(response.statusCode).toBe(200);
    expect(AdminGuard.calls).toBe(1);
    expect(UserAuthGuard.calls).toBe(0);
  });

  it("skips enforcement for an explicit ('public', null) route (US2/AC3, FR-005)", async () => {
    startRuntime({ defaultAuthGuard: DefaultProjectGuard });

    const response = (await runtime!(makeHttpEvent("/secure/health"), RUNTIME_CONTEXT)) as WireResponse;

    expect(response.statusCode).toBe(200);
    expect(UserAuthGuard.calls).toBe(0);
    expect(AdminGuard.calls).toBe(0);
    expect(DefaultProjectGuard.calls).toBe(0);
  });

  it("resolves a guard's own DI dependency through the container (US2/AC4, SC-004, FR-004)", async () => {
    startRuntime();

    const response = (await runtime!(makeHttpEvent("/di/check"), RUNTIME_CONTEXT)) as WireResponse;

    expect(response.statusCode).toBe(200);
    expect(DiAwareGuard.seenMarker).toBe("token-directory-instance");
  });

  it("applies the bootstrap defaultAuthGuard only when no metadata exists (US2/AC5, FR-006)", async () => {
    startRuntime({ defaultAuthGuard: DefaultProjectGuard });

    const response = (await runtime!(makeHttpEvent("/plain/info"), RUNTIME_CONTEXT)) as WireResponse;
    expect(response.statusCode).toBe(200);
    expect(DefaultProjectGuard.calls).toBe(1);

    // A declared scheme without a guard must NOT synthesize one and must NOT
    // fall back to the default: metadata is present, guard is explicitly null.
    const gatewayOnly = (await runtime!(
      makeHttpEvent("/secure/gateway-only"),
      RUNTIME_CONTEXT,
    )) as WireResponse;
    expect(gatewayOnly.statusCode).toBe(200);
    expect(DefaultProjectGuard.calls).toBe(1);
    expect(UserAuthGuard.calls).toBe(0);
  });

  it("passes requests without metadata when no defaultAuthGuard is configured (US2/AC5)", async () => {
    startRuntime();

    const response = (await runtime!(makeHttpEvent("/plain/info"), RUNTIME_CONTEXT)) as WireResponse;

    expect(response.statusCode).toBe(200);
    expect(DefaultProjectGuard.calls).toBe(0);
  });

  it("fails loudly when the declared guard is not registered in DI (Edge Case)", async () => {
    startRuntime();

    const response = (await runtime!(
      makeHttpEvent("/broken/resource"),
      RUNTIME_CONTEXT,
    )) as WireResponse;

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).not.toEqual({ reached: true });
  });
});
