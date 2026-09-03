/**
 * Contracts of the transport adapter SPI.
 *
 * A transport owns exactly one invocation shape (HTTP/API Gateway, Message
 * Queue, future triggers). Transports are independent from each other and are
 * detected/routed once by the core runtime (docs/ARCHITECTURE.md section 4).
 *
 * These declarations are intentionally type-only until issue #3 implements
 * the runtime that consumes them.
 */

import type { INestApplication } from "@nestjs/common";
import type { YandexExecutionContext } from "../context/yandex-execution-context";

/** Stable discriminator ids. Extending this union is the single registration point for a new transport. */
export type TransportId = "http" | "message-queue";

/**
 * Signature invoked by the Yandex Cloud Functions runtime.
 *
 * Parameters stay `unknown`: transports receive untrusted runtime payloads and
 * perform their own structural validation before narrowing.
 */
export type YandexCloudFunctionHandler = (
  rawEvent: unknown,
  rawContext: unknown,
) => Promise<unknown>;

/**
 * Token accepted by {@link InvocationContainer}.
 *
 * The constructor arm uses `never[]` arguments so both concrete and abstract
 * NestJS classes work as tokens without demanding a specific constructor
 * signature.
 */
export type InjectableToken<T = unknown> = (abstract new (...args: never[]) => T) | string | symbol;

/**
 * Dependency-injection sub-tree a resolution belongs to.
 *
 * `contextId` is the structural subset of @nestjs/core's `ContextId` that
 * `NestApplicationContext.resolve` accepts (verified against @nestjs/core 11,
 * the pinned peer dependency): resolutions sharing one context id observe the
 * same REQUEST-scoped instances, because the framework caches per-context
 * instances in structures keyed by that exact object. Create ids through
 * `ContextIdFactory.create()`; the framework stores them weakly, so dropping
 * the reference after use lets the collector reclaim the whole sub-tree.
 */
export interface InvocationResolutionContext {
  readonly contextId: {
    readonly id: number;
  };
}

/**
 * Read-only view over the warm NestJS application instance.
 *
 * Since issue #6 the runtime bootstraps one HTTP-bound application
 * (`NestFactory.create` over the connector's in-memory adapter) instead of a
 * standalone context: Message Queue transports resolve providers through it
 * exactly as before, while the HTTP transport additionally reaches the
 * registered routes via {@linkcode INestApplication.getHttpAdapter}.
 */
export interface InvocationContainer {
  /**
   * Resolves a provider through the warm application.
   *
   * Without {@link InvocationResolutionContext} each call creates its own
   * throwaway DI sub-tree. Passing one groups several resolutions into a
   * single sub-tree: Message Queue dispatch uses one per delivered message so
   * REQUEST-scoped providers behave per delivery while staying consistent
   * across every handler of that message. DEFAULT-scoped providers return
   * their cached singleton either way (verified against NestJS 11); failures
   * propagate verbatim to the caller.
   */
  resolve<T>(
    token: InjectableToken<T>,
    resolutionContext?: InvocationResolutionContext,
  ): Promise<T>;
  /** The warm application backing this invocation's container. */
  getApplication(): INestApplication;
}

/** Per-invocation input handed to the transport that claimed an event. */
export interface TransportInvocation<TRawEvent = unknown> {
  /** Validated raw event, narrowed by {@link TransportAdapter.supports}. */
  readonly rawEvent: TRawEvent;
  /** Raw function context; opaque to the core, interpreted only where needed. */
  readonly rawContext: unknown;
  /**
   * Normalized execution context built once per invocation by the core from
   * the untouched event/context pair (issue #4). Identical abstraction for
   * every transport, so correlation ids and trace metadata stay consistent
   * across HTTP and Message Queue executions.
   */
  readonly executionContext: YandexExecutionContext;
  /** Access to the warm application container for handler resolution. */
  readonly container: InvocationContainer;
}

/**
 * A transport adapter claims and handles one invocation shape.
 *
 * `supports` must be cheap, deterministic, side-effect-free and must never
 * throw; deeper validation belongs to `invoke`, which reports failures as
 * `INVALID_INVOCATION_EVENT` (docs/ARCHITECTURE.md sections 4 and 6.3).
 */
export interface TransportAdapter<TRawEvent = unknown, TResult = unknown> {
  readonly id: TransportId;

  /** Structural claim check used once at the detection boundary. */
  supports(rawEvent: unknown): rawEvent is TRawEvent;

  /** Executes the transport-specific invocation semantics. */
  invoke(invocation: TransportInvocation<TRawEvent>): Promise<TResult>;
}
