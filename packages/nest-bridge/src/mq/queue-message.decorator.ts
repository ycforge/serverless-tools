import type { QueueMessage as NormalizedQueueMessage } from "./message";
import type { QueueMessageParameterDecorator } from "../decorators/decorator-contracts";

/**
 * Module-private registration of decorated parameter positions, keyed by
 * method target (prototype or constructor for static methods) then property
 * key. Self-contained on purpose: no reflect-metadata global is involved,
 * mirroring `src/context/yandex-context.decorator.ts`.
 */
const registry = new WeakMap<object, Map<string | symbol | undefined, readonly number[]>>();

/**
 * `@QueueMessage()` — injects the message a queue handler is currently
 * processing into the decorated parameter (issue #8).
 *
 * The decorator is a thin registration mechanism (AGENTS.md section 3.4): it
 * only records which parameter positions want the current message. The value
 * is supplied at invocation time by the Message Queue dispatch
 * (`src/mq/dispatch.ts`), which reads it from the invocation scope
 * (`src/context/invocation-scope.ts`) — one normalized {@link QueueMessage}
 * per handler call, published as an immutable scope extension so concurrent
 * invocations and sibling messages of one delivery stay isolated.
 *
 * Parameter registration uses a module-private WeakMap registry instead of
 * reflect-metadata: the connector owns both ends (decoration and discovery),
 * so no global metadata namespace and no extra dependency is involved.
 */
export const QueueMessage: QueueMessageParameterDecorator = () => {
  return (target, propertyKey, parameterIndex) => {
    let indexesByProperty = registry.get(target);
    if (!indexesByProperty) {
      indexesByProperty = new Map();
      registry.set(target, indexesByProperty);
    }

    const existing = indexesByProperty.get(propertyKey) ?? [];
    if (!existing.includes(parameterIndex)) {
      // Sorted ascending keeps multi-parameter discovery deterministic.
      indexesByProperty.set(
        propertyKey,
        [...existing, parameterIndex].sort((left, right) => left - right),
      );
    }
  };
};

/**
 * Discovers the parameter positions registered for {@link QueueMessage} on a
 * method, ascending. Lookup walks the prototype chain so handlers inherited
 * from a decorated base class resolve too.
 *
 * Internal seam consumed by queue dispatch and specs; deliberately not part
 * of the public export surface.
 */
export function getQueueMessageParameterIndexes(
  target: object,
  propertyKey: string | symbol | undefined,
): readonly number[] {
  let current: object | null = target;
  while (current) {
    const indexes = registry.get(current)?.get(propertyKey);
    if (indexes) {
      return indexes;
    }
    current = Object.getPrototypeOf(current);
  }
  return [];
}

/**
 * Re-exports the normalized message contract under the decorator's name so
 * consumers can both call `@QueueMessage()` and type parameters with
 * `QueueMessage` — including the application payload type parameter, e.g.
 * `QueueMessage<OrderEvent>` for `payload: OrderEvent` (issue #9) — from the
 * same import (the public surface pins exactly this name;
 * docs/ARCHITECTURE.md section 7).
 */
export type QueueMessage<T = unknown> = NormalizedQueueMessage<T>;
