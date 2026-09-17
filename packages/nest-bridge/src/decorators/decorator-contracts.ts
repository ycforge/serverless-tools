/**
 * Signatures of the connector's NestJS decorators.
 *
 * Decorators are thin metadata/injection mechanisms (AGENTS.md section 3.4);
 * their implementations land with issues #4 and #8 and must conform exactly
 * to these signatures. Declared type-only so no half-working decorator is
 * published ahead of its implementing issue.
 */

/** `@YandexContext()` — injects the normalized execution context into a handler parameter. */
export type ContextParameterDecorator = () => ParameterDecorator;

/** `@QueueMessage()` — injects the current normalized queue message into a handler parameter. */
export type QueueMessageParameterDecorator = () => ParameterDecorator;

/** `@QueueHandler()` — marks a provider method as a queue message handler target. */
export type QueueHandlerMethodDecorator = () => MethodDecorator;
