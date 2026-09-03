import type { QueueHandlerMethodDecorator } from "../decorators/decorator-contracts";

/**
 * Module-private registration of queue handler methods, keyed by the decorated
 * target (prototype or constructor for static methods) then property key.
 * Self-contained on purpose: no reflect-metadata global is involved, mirroring
 * `src/context/yandex-context.decorator.ts`.
 */
const registry = new WeakMap<object, Set<string | symbol | undefined>>();

/**
 * `@QueueHandler()` — marks a provider or controller method as a Message
 * Queue consumer (issue #8).
 *
 * The decorator is a thin registration mechanism (AGENTS.md section 3.4): it
 * only records which methods want deliveries. Dispatch happens at invocation
 * time inside the Message Queue transport (`src/mq/dispatch.ts`), which walks
 * the warm NestJS application container for registered providers and invokes
 * every discovered handler — one call per delivered message, in deterministic
 * discovery order. There is deliberately no selector argument: with the
 * current trigger model every handler receives EVERY delivered message
 * (fan-out), so multiple handlers are unambiguous by construction and run in
 * a stable order. Queue/attribute-based routing may arrive later as an
 * explicit, separately-versioned extension of this decorator's signature.
 *
 * Parameter registration uses a module-private WeakMap registry instead of
 * reflect-metadata: the connector owns both ends (decoration and discovery),
 * so no global metadata namespace and no extra dependency is involved.
 */
export const QueueHandler: QueueHandlerMethodDecorator = () => {
  return (target, propertyKey) => {
    let methodKeys = registry.get(target);
    if (!methodKeys) {
      methodKeys = new Set();
      registry.set(target, methodKeys);
    }
    methodKeys.add(propertyKey);
  };
};

/**
 * Discovers the property keys registered as queue handlers on a target,
 * own properties first (subclass before base class along the prototype
 * chain), declaration order within each level.
 *
 * Internal seam consumed by queue dispatch and specs; deliberately not part
 * of the public export surface.
 */
export function getQueueHandlerMethodNames(target: object): readonly (string | symbol)[] {
  const discovered: (string | symbol)[] = [];
  const seen = new Set<string | symbol>();

  let current: object | null = target;
  while (current && current !== Object.prototype) {
    // Own-property enumeration order is normative for string keys
    // (declaration order), keeping multi-handler discovery deterministic.
    for (const propertyKey of Reflect.ownKeys(current)) {
      if (!registry.get(current)?.has(propertyKey) || seen.has(propertyKey)) {
        continue;
      }
      seen.add(propertyKey);
      discovered.push(propertyKey);
    }
    current = Object.getPrototypeOf(current);
  }
  return discovered;
}

/**
 * Checks whether exactly `propertyKey` on `target` was decorated with
 * {@link QueueHandler}, walking the prototype chain like
 * {@link getQueueHandlerMethodNames}.
 *
 * Internal seam consumed by queue dispatch and specs.
 */
export function hasQueueHandlerRegistration(target: object, propertyKey: string | symbol): boolean {
  let current: object | null = target;
  while (current && current !== Object.prototype) {
    if (registry.get(current)?.has(propertyKey)) {
      return true;
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}
