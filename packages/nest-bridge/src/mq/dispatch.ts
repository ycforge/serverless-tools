import type { INestApplication } from "@nestjs/common";
import { ContextIdFactory } from "@nestjs/core";
import {
  extendInvocationScope,
  resolveInvocationExecutionContext,
} from "../context/invocation-scope";
import { getYandexContextParameterIndexes } from "../context/yandex-context.decorator";
import type { InvocationResolutionContext } from "../core/transport";
import { ConnectorError } from "../core/connector-error";
import { getQueueHandlerMethodNames } from "./queue-handler.decorator";
import { getQueueMessageParameterIndexes } from "./queue-message.decorator";
import type { QueueBatch, QueueMessage } from "./message";

/**
 * Message Queue handler dispatch over the normalized batch (issue #8).
 *
 * Responsibilities are deliberately split this way (AGENTS.md section 12):
 * discovery walks the WARM NestJS application container once per application
 * and caches the static result; execution resolves handler instances through
 * the invocation's own container view and runs them inside the invocation
 * scope the transport established. Nothing here touches HTTP response
 * semantics: a queue delivery has no envelope to build, so successful
 * dispatch simply lets the batch flow back to the transport unchanged.
 */

/**
 * Structural description of the @nestjs/core internals queue discovery reads.
 *
 * The connector bootstraps every runtime itself (`NestFactory.create` over
 * `YandexHttpAdapter`, docs/ARCHITECTURE.md section 3.2), so `container`
 * always holds the application's `NestContainer`; the shape below was
 * verified against @nestjs/core 11 (the pinned peer dependency):
 * `getModules()` returns the insertion-ordered `ModulesContainer` (a `Map`
 * keyed by module token), whose VALUES expose their controller/provider
 * instance wrappers under `token`, with optional `metatype`. Accessing it is
 * read-only traversal — no framework behavior is reimplemented beyond
 * locating user-registered instances.
 */
interface NestContainerInternals {
  getModules?(): { values(): Iterable<NestModuleInternals> };
}

interface NestModuleInternals {
  readonly controllers?: ReadonlyMap<unknown, NestInstanceWrapper>;
  readonly providers?: ReadonlyMap<unknown, NestInstanceWrapper>;
}

interface NestInstanceWrapper {
  readonly token?: unknown;
  readonly metatype?: unknown;
  readonly instance?: unknown;
}

/** Minimal view over the per-invocation container seam (src/core/transport.ts). */
interface HandlerResolutionContainer {
  resolve<T>(token: unknown, resolutionContext?: InvocationResolutionContext): Promise<T>;
}

/** One discovered handler registration: which provider, which method. */
export interface DiscoveredQueueHandler {
  /**
   * Injection token of the owning provider, exactly as registered in the
   * NestJS container (class, string or symbol). Resolution goes through the
   * invocation's {@link HandlerResolutionContainer} once per message under a
   * shared DI sub-tree: DEFAULT-scoped providers return their cached
   * singleton, REQUEST-scoped ones are instantiated fresh per message yet
   * stay consistent across every handler of that message, and TRANSIENT
   * ones refresh with each message's sub-tree — platform-standard NestJS
   * semantics throughout.
   */
  readonly token: unknown;
  /** Property key of the decorated method on the resolved instance. */
  readonly methodName: string | symbol;
}

/**
 * Discovery cache keyed by the warm application instance.
 *
 * Handler registrations are static code structure, not invocation state:
 * caching them per application mirrors how `YandexHttpAdapter` records route
 * layers at cold start (AGENTS.md sections 10–11). A WeakMap keeps the cache
 * out of module-level singleton state and lets closed applications be
 * collected with their entries. Concurrent first invocations may scan twice
 * and compute equal results — discovery is pure and synchronous.
 */
const discoveredHandlersByApplication = new WeakMap<
  INestApplication,
  readonly DiscoveredQueueHandler[]
>();

/**
 * Walks the warm application container for methods registered through
 * `@QueueHandler()`.
 *
 * Traversal order defines fan-out order for multi-handler applications and is
 * fully deterministic: modules in container insertion order (root first),
 * controllers before providers within each module, wrappers in declaration
 * order, method keys in prototype-chain walk order (subclass first,
 * declaration order per level). Registrations duplicated across modules
 * (shared providers surfaced under several module contexts) are deduped by
 * owner type or token, keeping one entry per logical handler.
 *
 * The scan never calls functions on the proxied application object: Nest
 * wraps app methods in its exception zone (`NestFactory.createProxy`), where
 * synchronous failures would abort the process instead of surfacing as
 * invocation failures. Only plain property reads happen here; handler
 * instances are resolved later through the invocation container, whose
 * asynchronous failures propagate normally.
 */
export function discoverQueueHandlers(
  application: INestApplication,
): readonly DiscoveredQueueHandler[] {
  const cached = discoveredHandlersByApplication.get(application);
  if (cached) {
    return cached;
  }

  const handlers = scanApplicationContainer(application);

  discoveredHandlersByApplication.set(application, handlers);
  return handlers;
}

function scanApplicationContainer(
  application: INestApplication,
): readonly DiscoveredQueueHandler[] {
  const internals = application as unknown as {
    container?: Partial<NestContainerInternals> | null;
  };
  const container = internals.container;
  const getModules = container?.getModules;
  if (typeof getModules !== "function") {
    // Impossible while the connector owns the bootstrap — fail loudly rather
    // than silently treating every delivery as handler-less (AGENTS.md §8.3).
    throw new Error("queue handler discovery could not access the NestJS application container");
  }

  const discovered: DiscoveredQueueHandler[] = [];
  const seenByOwner = new Map<unknown, Set<string | symbol>>();

  // ModulesContainer is a Map keyed by module token; `.values()` yields the
  // modules themselves in insertion order (root module first).
  for (const moduleInternals of getModules.call(container).values()) {
    // Controllers first, then providers: mirrors how Nest treats controllers
    // as an application's primary consumers and keeps multi-handler order
    // stable across restarts of the same build.
    const collections = [moduleInternals.controllers, moduleInternals.providers];
    for (const collection of collections) {
      if (!collection) {
        continue;
      }
      for (const wrapper of collection.values()) {
        discoverOnWrapper(wrapper, discovered, seenByOwner);
      }
    }
  }
  return discovered;
}

function discoverOnWrapper(
  wrapper: NestInstanceWrapper,
  discovered: DiscoveredQueueHandler[],
  seenByOwner: Map<unknown, Set<string | symbol>>,
): void {
  // Post-init every statically-scoped provider has its instance, and even
  // unresolved request-scoped stubs carry the class prototype — checking both
  // covers value/factory providers (no metatype) and lazy scopes alike.
  const targets: object[] = [];
  if (typeof wrapper.metatype === "function" && typeof wrapper.metatype.prototype === "object") {
    targets.push(wrapper.metatype.prototype);
  }
  if (typeof wrapper.instance === "object" && wrapper.instance !== null) {
    targets.push(wrapper.instance);
  }

  // Dedup key: the owning class when there is one, otherwise the injection
  // token — one entry per logical handler no matter how many module contexts
  // surface the same registration.
  const ownerKey = typeof wrapper.metatype === "function" ? wrapper.metatype : wrapper.token;

  for (const target of targets) {
    for (const methodName of getQueueHandlerMethodNames(target)) {
      let seenMethods = seenByOwner.get(ownerKey);
      if (!seenMethods) {
        seenMethods = new Set();
        seenByOwner.set(ownerKey, seenMethods);
      }
      if (seenMethods.has(methodName)) {
        continue;
      }
      seenMethods.add(methodName);

      // The token came from the NestJS container itself, so it is an
      // injection token by construction even though traversal sees it as an
      // opaque value.
      discovered.push({ token: wrapper.token, methodName });
    }
  }
}

/**
 * Runs every discovered handler against every delivered message.
 *
 * Semantics pinned here (docs/ARCHITECTURE.md sections 4 and 6.2):
 *
 * - **Batch iteration**: messages run sequentially in delivery order; the
 *   batch model stays authoritative regardless of the current trigger's
 *   grouped-message limit of 1 (**observed**).
 * - **Per-message isolation**: each handler round runs inside an immutable
 *   scope extension carrying exactly that message (`@QueueMessage()`), on
 *   top of the invocation scope holding the delivery and execution context
 *   (`@YandexContext()`). No module-level state carries the current message,
 *   and handler instances are resolved INSIDE that extension, so NestJS
 *   provider state can never leak across messages of one delivery.
 * - **One DI sub-tree per message**: all handlers of one round resolve under
 *   a single NestJS context id (`ContextIdFactory.create()`), so
 *   REQUEST-scoped providers are instantiated fresh per message yet observed
 *   consistently by every handler call of that message — mirroring how a
 *   platform request shares one DI sub-tree. The framework caches per-context
 *   instances weakly (verified against @nestjs/core 11): dropping the context
 *   id after the round lets the collector reclaim it, keeping warm processes
 *   flat in memory. DEFAULT-scoped providers stay cached singletons;
 *   TRANSIENT-scoped ones refresh with each message's new sub-tree.
 * - **Fan-out**: EVERY discovered handler receives EVERY message, in
 *   discovery order; handler return values are ignored — the queue transport
 *   has no response envelope, and acknowledgement/retry policy belongs to
 *   issue #10.
 * - **Failure propagation**: any resolution or handler failure rejects the
 *   whole invocation immediately; messages after the failing one are not
 *   attempted. Yandex Message Queue retry/dead-letter configuration therefore
 *   sees a failed invocation, never a swallowed error (AGENTS.md section 8.2).
 */
export async function dispatchQueueHandlers(
  invocationContainer: HandlerResolutionContainer,
  handlers: readonly DiscoveredQueueHandler[],
  batch: QueueBatch,
): Promise<void> {
  if (handlers.length === 0) {
    throw ConnectorError.noQueueHandler();
  }

  for (const message of batch.messages) {
    await extendInvocationScope({ queueMessage: message }, () =>
      deliverToAllHandlers(invocationContainer, handlers, message),
    );
  }
}

async function deliverToAllHandlers(
  invocationContainer: HandlerResolutionContainer,
  handlers: readonly DiscoveredQueueHandler[],
  message: QueueMessage,
): Promise<void> {
  // One DI sub-tree per message, created inside this message's scope
  // extension so REQUEST/TRANSIENT provider lifecycles are bound to exactly
  // that message. Sequential resolution keeps factory side effects ordered
  // and stops at the first failure without starting later sub-trees.
  const resolutionContext: InvocationResolutionContext = {
    contextId: ContextIdFactory.create(),
  };
  const resolved: { instance: unknown; methodName: string | symbol }[] = [];
  for (const handler of handlers) {
    resolved.push({
      instance: await invocationContainer.resolve(handler.token, resolutionContext),
      methodName: handler.methodName,
    });
  }

  const executionContext = resolveInvocationExecutionContext();
  for (const { instance, methodName } of resolved) {
    const method = readHandlerMethod(instance, methodName);
    const parameters = buildHandlerParameters(instance, methodName, message, executionContext);
    await method.apply(instance, parameters);
  }
}

function readHandlerMethod(
  instance: unknown,
  methodName: string | symbol,
): (...args: unknown[]) => unknown {
  const method = (instance as Record<string | symbol, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(
      `queue handler "${String(methodName)}" is no longer a function on its resolved provider`,
    );
  }
  return method as (...args: unknown[]) => unknown;
}

/**
 * Fills decorated parameter positions: `@QueueMessage()` positions receive
 * the current message, `@YandexContext()` positions the invocation context.
 * When both decorate one position the context wins (applied last);
 * undecorated positions receive `undefined`, mirroring how external callers
 * invoke methods with sparse argument lists.
 */
function buildHandlerParameters(
  instance: unknown,
  methodName: string | symbol,
  message: QueueMessage,
  executionContext: ReturnType<typeof resolveInvocationExecutionContext>,
): unknown[] {
  const target = Object.getPrototypeOf(instance) ?? instance;
  const messageIndexes = getQueueMessageParameterIndexes(target, methodName);
  const contextIndexes = getYandexContextParameterIndexes(target, methodName);

  const highestDecoratedIndex = Math.max(-1, ...messageIndexes, ...contextIndexes);
  const parameters = new Array<unknown>(Math.max(highestDecoratedIndex + 1, 0)).fill(undefined);

  for (const index of messageIndexes) {
    parameters[index] = message;
  }
  for (const index of contextIndexes) {
    parameters[index] = executionContext;
  }
  return parameters;
}
