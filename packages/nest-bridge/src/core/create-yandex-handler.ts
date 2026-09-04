import type { INestApplication, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { buildYandexExecutionContext, readInvocationTraceId } from "../context/build-yandex-execution-context";
import { runInInvocationScope } from "../context/invocation-scope";
import { YandexHttpAdapter } from "../http/yandex-http-adapter";
import { createLogWriter } from "../logger/writer";
import { createInvocationLogger, contextFields } from "../logger/invocation-logger";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { detectTransport } from "./detect-transport";
import type {
  InjectableToken,
  InvocationContainer,
  InvocationResolutionContext,
  TransportAdapter,
  TransportId,
  TransportInvocation,
  YandexCloudFunctionHandler,
} from "./transport";
import type { CreateYandexHandlerOptions } from "./handler-options";
import type { ConnectorBootstrapOptions } from "../auth/connector-bootstrap-options";
import { createConnectorBootstrapModule } from "../auth/bootstrap-module";
import { GlobalAuthGuard } from "../auth/global-auth.guard";
import { createBuiltinTransports } from "./transports";

/**
 * Handler returned by {@link createYandexHandler}: the exact
 * `YandexCloudFunctionHandler` signature the Yandex Cloud Functions runtime
 * invokes (docs/ARCHITECTURE.md section 3.1), plus an explicit teardown hook.
 */
export interface ClosableYandexCloudFunctionHandler extends YandexCloudFunctionHandler {
  /**
   * Releases the cached NestJS application.
   *
   * Shutdown behavior of the connector: Yandex Cloud Functions freezes or
   * reclaims execution environments without guaranteed teardown signals, so
   * no automatic hooks are registered and the application is intentionally
   * kept alive for warm invocations until the environment dies with it.
   * Environments where graceful teardown is required (custom runtimes, tests)
   * call `close()` explicitly; the next invocation then performs a fresh cold
   * start. `close()` is idempotent, safe before any invocation, and awaits an
   * in-flight initialization before releasing it.
   */
  close(): Promise<void>;
}

/**
 * Public entry point: turns a NestJS application module into a handler for
 * the Yandex Cloud Functions runtime (docs/ARCHITECTURE.md section 3).
 *
 * The Nest application is bootstrapped lazily on the first invocation and
 * cached for reuse by every later warm invocation; concurrent cold starts
 * share one initialization promise instead of building duplicate
 * applications (AGENTS.md section 10). All per-invocation data travels
 * through the transport invocation object — nothing invocation-scoped is
 * retained between calls (AGENTS.md section 11).
 *
 * `options` is optional; without it every transport runs its documented
 * default behavior. `options.queue` (issue #9) may install a custom queue
 * body deserializer replacing the default strict-JSON policy.
 * `options.defaultAuthGuard` (spec 003) sets the project-default guard
 * applied to HTTP routes without `@RequireAuth` metadata.
 */
export function createYandexHandler(
  appModule: Type<unknown>,
  options?: CreateYandexHandlerOptions,
): ClosableYandexCloudFunctionHandler {
  return createInvocationRuntime(appModule, createBuiltinTransports(options), {
    defaultAuthGuard: options?.defaultAuthGuard ?? null,
  });
}

/**
 * Internal runtime seam allowing tests (and future internal wiring) to drive
 * the full lifecycle against explicit transports without touching the public
 * API surface.
 */
export function createInvocationRuntime(
  appModule: Type<unknown>,
  transports: readonly TransportAdapter[],
  bootstrapOptions: ConnectorBootstrapOptions = {},
): ClosableYandexCloudFunctionHandler {
  // Shared initialization promise in the factory closure: one cache per
  // created handler, never global state shared between unrelated handlers
  // (AGENTS.md sections 10.3 and 11).
  let applicationPromise: Promise<INestApplication> | null = null;

  const getApplication = (): Promise<INestApplication> => {
    if (!applicationPromise) {
      // HTTP-bound application over the connector's in-memory adapter:
      // controllers register through the transport SPI instead of a Node
      // listener, so no @nestjs/platform-express is involved. Message Queue
      // transports share the same warm application and resolve providers
      // from it unchanged; the HTTP transport dispatches through the
      // adapter's registered routes (issue #6, docs/ARCHITECTURE.md
      // section 3.2). `init()` performs the full cold start once — module
      // lifecycles, middleware, route registration — and warm invocations
      // replay routes purely in memory.
      const httpAdapter = new YandexHttpAdapter();
      // The application is created from the connector bootstrap wrapper
      // (spec 003, research R2): it registers the options token and
      // GlobalAuthGuard as providers without touching the application
      // module. The resolved guard joins the HTTP global-guard pipeline
      // before init(); the Message Queue dispatch path never passes through
      // it (FR-011).
      const bootstrapModule = createConnectorBootstrapModule(appModule, bootstrapOptions);
      applicationPromise = NestFactory.create(bootstrapModule, httpAdapter)
        .then((application) => {
          application.useGlobalGuards(application.get(GlobalAuthGuard));
          return application.init();
        })
        .catch((error) => {
          // A failed cold start must not poison the environment forever:
          // clear the promise so the next invocation retries initialization.
          applicationPromise = null;
          throw error;
        });
    }
    return applicationPromise;
  };

  const handler: YandexCloudFunctionHandler = async (rawEvent, rawContext) => {
    // Boundary logging runs on the public invocation path (spec 004, FR-005):
    // one stdout writer per call, fail-open and write-call-atomic (FR-010/011).
    // Fatal pre-scope boundaries (detection/bootstrap) still emit an error
    // record, correlating on the tolerant id read from the raw context when
    // one exists (research R4 / edge case 1). Everything stays side-effect
    // free with respect to the invocation result.
    const logger = createInvocationLogger(createLogWriter());
    const tolerantTraceId = readInvocationTraceId(rawContext);

    // Detection runs once, before any initialization cost, so events nobody
    // claims fail fast and predictably (docs/ARCHITECTURE.md section 4).
    let transport: TransportAdapter;
    try {
      transport = detectTransport(transports, rawEvent);
    } catch (error) {
      logger.error({ trace_id: tolerantTraceId, error });
      throw error;
    }

    let application: INestApplication;
    try {
      application = await getApplication();
    } catch (error) {
      // Cold-start bootstrap failure (FR-008): no normalized execution
      // context exists, so only the tolerant id (when available) is emitted.
      logger.error({ trace_id: tolerantTraceId, error });
      throw error;
    }

    // Normalized once per invocation from the untouched payloads: every
    // transport hands the identical context abstraction to user code, keeping
    // correlation ids and trace metadata consistent across HTTP and Message
    // Queue executions (issue #4).
    let executionContext: YandexExecutionContext;
    try {
      executionContext = buildYandexExecutionContext(rawEvent, rawContext);
    } catch (error) {
      logger.error({ trace_id: tolerantTraceId, error });
      throw error;
    }

    // Fresh per-invocation record: transports receive the untouched raw
    // event/context plus a container view over the warm application. Errors
    // from `invoke` propagate verbatim — HTTP and Message Queue own their
    // different failure semantics above this boundary.
    const invocation: TransportInvocation = {
      rawEvent,
      rawContext,
      container: createInvocationContainer(application),
      executionContext,
    };
    // Dispatch runs inside this invocation's scope: everything reachable from
    // the handler — including `@YandexContext()` parameter injection — reads
    // exactly this invocation's context. Concurrent invocations get isolated
    // stores and nothing survives the call (AGENTS.md section 11). Boundary
    // start/finish/error books the `invoke` inside the scope so all records
    // of one invocation carry the same normalized trace id (research R3).
    return runInInvocationScope({ executionContext }, async () => {
      const trace = contextFields(executionContext);
      logger.start({ ...trace, transport: transport.id });
      try {
        const result = await transport.invoke(invocation);
        logger.finish({
          ...trace,
          transport: transport.id,
          status: boundaryStatus(transport.id, result),
        });
        return result;
      } catch (error) {
        logger.error({ ...trace, transport: transport.id, error });
        throw error;
      }
    });
  };

  return Object.assign(handler, {
    close: async (): Promise<void> => {
      const pending = applicationPromise;
      applicationPromise = null;
      if (!pending) {
        return;
      }
      const application = await pending;
      await application.close();
    },
  });
}

/**
 * Transport-specific `finish` status (FR-006): the HTTP response status code
 * for `http`; the number of delivered messages for `message-queue`. Fail-open:
 * an unexpected result shape (transport returning an opaque value) yields 0
 * rather than throwing inside the logging path.
 */
function boundaryStatus(transportId: TransportId, result: unknown): number {
  if (transportId === "http") {
    const statusCode = (result as { statusCode?: unknown } | null)?.statusCode;
    return typeof statusCode === "number" ? statusCode : 0;
  }
  const messages = (result as { messages?: unknown } | null)?.messages;
  return Array.isArray(messages) ? messages.length : 0;
}

function createInvocationContainer(application: INestApplication): InvocationContainer {
  return {
    resolve<T>(
      token: InjectableToken<T>,
      resolutionContext?: InvocationResolutionContext,
    ): Promise<T> {
      // `resolve` covers DEFAULT, REQUEST and TRANSIENT scopes alike; for
      // singletons it returns the shared instance (verified against
      // NestJS 11), keeping one resolution path for all provider scopes.
      // An explicit context id groups several resolutions into one DI
      // sub-tree (Message Queue dispatch shares one per message); without
      // one, `application.resolve` creates a throwaway sub-tree per call —
      // the pre-#8-lifecycle behavior, unchanged for HTTP-era callers.
      return application.resolve<T>(token, resolutionContext?.contextId);
    },
    getApplication(): INestApplication {
      return application;
    },
  };
}
