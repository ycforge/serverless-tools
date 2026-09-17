import type { ContextParameterDecorator } from "../decorators/decorator-contracts";

/**
 * Module-private registration of decorated parameter positions, keyed by
 * method target (prototype or constructor for static methods) then property
 * key. Self-contained on purpose: no reflect-metadata global is involved.
 */
const registry = new WeakMap<object, Map<string | symbol | undefined, readonly number[]>>();

/**
 * `@YandexContext()` — injects the current invocation's normalized
 * {@link YandexExecutionContext} into a handler/controller method parameter
 * (issue #4).
 *
 * The decorator is a thin registration mechanism (AGENTS.md section 3.4): it
 * only records which parameter positions want the context. The value is
 * supplied at invocation time by the transport dispatch, which reads it from
 * the invocation scope (`src/context/invocation-scope.ts`) — the same
 * transport-neutral source for HTTP and Message Queue executions.
 *
 * Parameter registration uses a module-private WeakMap registry instead of
 * reflect-metadata: the connector owns both ends (decoration and discovery),
 * so no global metadata namespace and no extra dependency is involved.
 */
export const YandexContext: ContextParameterDecorator = () => {
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
 * Discovers the parameter positions registered for {@link YandexContext} on a
 * method, ascending. Lookup walks the prototype chain so handlers inherited
 * from a decorated base class resolve too.
 *
 * Internal seam consumed by transport dispatch (issues #5, #7/#8) and specs;
 * deliberately not part of the public export surface.
 */
export function getYandexContextParameterIndexes(
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
