import { AsyncLocalStorage } from "node:async_hooks";
import type { NormalizedHttpRequest } from "../http/normalized-request";
import type { QueueBatch, QueueMessage } from "../mq/message";
import type { YandexExecutionContext } from "./yandex-execution-context";

/**
 * Per-invocation state shared with everything that runs inside one handler
 * execution (issue #4).
 *
 * Deliberately minimal and extensible: transports add their normalized models
 * on top without changing how application code reads the context.
 */
export interface InvocationScopeState {
  readonly executionContext: YandexExecutionContext;

  /**
   * Normalized HTTP request published by the claiming HTTP transport before
   * user code runs (issue #5). Absent for non-HTTP invocations; application
   * code reads it through {@link resolveInvocationHttpRequest}, mirroring how
   * the execution context is resolved — never from module-level singletons
   * (AGENTS.md section 11).
   */
  readonly httpRequest?: NormalizedHttpRequest;

  /**
   * Normalized Message Queue delivery published by the claiming MQ transport
   * before user code runs (issue #7). Absent for non-queue invocations;
   * application code reads it through {@link resolveInvocationQueueBatch},
   * mirroring how the HTTP request is resolved — never from module-level
   * singletons (AGENTS.md section 11).
   */
  readonly queueBatch?: QueueBatch;

  /**
   * The one message a queue handler is currently processing, published as an
   * immutable scope extension around each handler call during dispatch
   * (issue #8). Absent outside queue handler execution — including between
   * messages of the same delivery — so concurrent and sequential handlers
   * stay isolated while sharing their invocation's batch and execution
   * context (AGENTS.md section 11).
   */
  readonly queueMessage?: QueueMessage;
}

/**
 * Invocation-scoped propagation mechanism.
 *
 * AsyncLocalStorage keeps the state attached to the asynchronous execution
 * chain of exactly ONE handler invocation: concurrent invocations get isolated
 * stores, sequential invocations never observe each other's data, and nothing
 * survives after the invocation completes (AGENTS.md section 11). This is not
 * singleton state holding `currentEvent`/`currentContext` — it is the
 * sanctioned isolation boundary those rules require.
 */
const invocationStorage = new AsyncLocalStorage<InvocationScopeState>();

/**
 * Runs `operation` inside the scope of one invocation. The core wraps every
 * transport dispatch with this call, making the normalized context reachable
 * from any depth of user code (guards, services, handlers) regardless of
 * which transport claimed the event.
 */
export function runInInvocationScope<TResult>(
  state: InvocationScopeState,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  return invocationStorage.run(state, operation);
}

/** Current invocation state when called inside one; otherwise `undefined`. */
export function getInvocationScopeState(): InvocationScopeState | undefined {
  return invocationStorage.getStore();
}

/**
 * Runs `operation` inside the current invocation's scope with additional
 * per-invocation state merged in.
 *
 * Extension seam for transport dispatch (issue #5): the claiming transport
 * publishes its normalized models after detection but before any user code
 * runs. The store is replaced immutably, so concurrent invocations keep fully
 * isolated views and nothing mutates behind readers' backs (AGENTS.md
 * section 11).
 */
export function extendInvocationScope<TResult>(
  extension: Partial<InvocationScopeState>,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  const current = invocationStorage.getStore();
  if (!current) {
    throw new Error(
      "the invocation scope can only be extended while handling a Yandex Cloud Function invocation",
    );
  }
  return invocationStorage.run({ ...current, ...extension }, operation);
}

/**
 * Resolves the current invocation's normalized execution context.
 *
 * Transport dispatch uses this to fill `@YandexContext()` parameters.
 * Resolution outside any invocation scope is a programming error and fails
 * loudly instead of returning an undefined context typed as present.
 */
export function resolveInvocationExecutionContext(): YandexExecutionContext {
  const state = invocationStorage.getStore();
  if (!state) {
    throw new Error(
      "@YandexContext() can only be resolved while handling a Yandex Cloud Function invocation",
    );
  }
  return state.executionContext;
}

/**
 * Resolves the current invocation's normalized HTTP request.
 *
 * Internal seam consumed by transport dispatch and specs; deliberately not
 * part of the public export surface yet. Fails loudly outside an HTTP
 * invocation instead of returning an undefined request typed as present.
 */
export function resolveInvocationHttpRequest(): NormalizedHttpRequest {
  const state = invocationStorage.getStore();
  if (!state?.httpRequest) {
    throw new Error(
      "no HTTP request is associated with the current invocation; only the HTTP / API Gateway transport publishes one",
    );
  }
  return state.httpRequest;
}

/**
 * Resolves the current invocation's normalized Message Queue delivery.
 *
 * Internal seam consumed by queue dispatch (issue #8) and specs; deliberately
 * not part of the public export surface yet, mirroring
 * {@link resolveInvocationHttpRequest}. Fails loudly outside a queue
 * invocation instead of returning an undefined batch typed as present.
 */
export function resolveInvocationQueueBatch(): QueueBatch {
  const state = invocationStorage.getStore();
  if (!state?.queueBatch) {
    throw new Error(
      "no Message Queue delivery is associated with the current invocation; only the Message Queue transport publishes one",
    );
  }
  return state.queueBatch;
}

/**
 * Resolves the message a queue handler is currently processing.
 *
 * Internal seam consumed by queue dispatch (issue #8) and specs; deliberately
 * not part of the public export surface, mirroring
 * {@link resolveInvocationQueueBatch}. Published only around one handler call
 * at a time, so resolution between messages of the same delivery — or during
 * a non-queue invocation — fails loudly instead of returning a stale or
 * undefined message typed as present.
 */
export function resolveInvocationQueueMessage(): QueueMessage {
  const state = invocationStorage.getStore();
  if (!state?.queueMessage) {
    throw new Error(
      "no Message Queue message is associated with the current execution; messages are only published while a queue handler runs",
    );
  }
  return state.queueMessage;
}
