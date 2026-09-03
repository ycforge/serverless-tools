import {
  getQueueHandlerMethodNames,
  hasQueueHandlerRegistration,
  QueueHandler,
} from "./queue-handler.decorator";

/**
 * Specs for the `@QueueHandler()` method decorator (issue #8). Decorators are
 * applied imperatively (exactly what legacy decorator desugaring does) so
 * the suite stays independent of decorator compilation settings.
 */

/**
 * Fresh consumer class per test: registration state lives in module-private
 * registries keyed by prototype, so every spec decorates its own class to
 * stay independent of its siblings.
 */
function createConsumerClass(): abstract new () => object {
  return class {
    handle(): void {}
  };
}

function methodDescriptorOf(
  target: object,
  propertyKey: string | symbol,
): TypedPropertyDescriptor<unknown> {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor) {
    throw new Error(`missing descriptor for ${String(propertyKey)}`);
  }
  return descriptor;
}

describe("@QueueHandler() method decorator", () => {
  it("registers the decorated method for discovery", () => {
    const Consumer = createConsumerClass();

    expect(getQueueHandlerMethodNames(Consumer.prototype)).toEqual([]);
    expect(hasQueueHandlerRegistration(Consumer.prototype, "handle")).toBe(false);

    QueueHandler()(Consumer.prototype, "handle", methodDescriptorOf(Consumer.prototype, "handle"));

    expect(getQueueHandlerMethodNames(Consumer.prototype)).toEqual(["handle"]);
    expect(hasQueueHandlerRegistration(Consumer.prototype, "handle")).toBe(true);
  });

  it("discovers methods in declaration order regardless of decoration order", () => {
    class TwoMethodConsumer {
      first(): void {}
      second(): void {}
    }

    // Decoration order must not leak into fan-out order: dispatch walks own
    // properties in declaration order so multi-handler applications stay
    // deterministic across builds.
    QueueHandler()(
      TwoMethodConsumer.prototype,
      "second",
      methodDescriptorOf(TwoMethodConsumer.prototype, "second"),
    );
    QueueHandler()(
      TwoMethodConsumer.prototype,
      "first",
      methodDescriptorOf(TwoMethodConsumer.prototype, "first"),
    );

    expect(getQueueHandlerMethodNames(TwoMethodConsumer.prototype)).toEqual(["first", "second"]);
  });

  it("deduplicates repeated decoration of the same method", () => {
    const Consumer = createConsumerClass();
    QueueHandler()(Consumer.prototype, "handle", methodDescriptorOf(Consumer.prototype, "handle"));
    QueueHandler()(Consumer.prototype, "handle", methodDescriptorOf(Consumer.prototype, "handle"));

    expect(getQueueHandlerMethodNames(Consumer.prototype)).toEqual(["handle"]);
  });

  it("keeps registrations of different classes isolated", () => {
    const First = createConsumerClass();
    const Second = createConsumerClass();
    QueueHandler()(First.prototype, "handle", methodDescriptorOf(First.prototype, "handle"));

    expect(hasQueueHandlerRegistration(Second.prototype, "handle")).toBe(false);
    expect(getQueueHandlerMethodNames(Second.prototype)).toEqual([]);
  });

  it("supports symbol-named handler methods", () => {
    const Consumer = createConsumerClass();
    const handleSymbol = Symbol("handle");
    Object.defineProperty(Consumer.prototype, handleSymbol, { value: () => undefined });
    QueueHandler()(
      Consumer.prototype,
      handleSymbol,
      methodDescriptorOf(Consumer.prototype, handleSymbol),
    );

    expect(getQueueHandlerMethodNames(Consumer.prototype)).toEqual([handleSymbol]);
    expect(hasQueueHandlerRegistration(Consumer.prototype, handleSymbol)).toBe(true);
  });

  it("resolves registrations through the prototype chain with subclass methods first", () => {
    const DecoratedBase = createConsumerClass();
    QueueHandler()(
      DecoratedBase.prototype,
      "handle",
      methodDescriptorOf(DecoratedBase.prototype, "handle"),
    );

    class ChildConsumer extends DecoratedBase {
      childHandle(): void {}
    }
    QueueHandler()(
      ChildConsumer.prototype,
      "childHandle",
      methodDescriptorOf(ChildConsumer.prototype, "childHandle"),
    );

    // Fan-out order puts the most specific registration first: a subclass
    // overriding behavior must observe deliveries before its base handlers.
    expect(getQueueHandlerMethodNames(ChildConsumer.prototype)).toEqual(["childHandle", "handle"]);
    expect(hasQueueHandlerRegistration(ChildConsumer.prototype, "handle")).toBe(true);
  });

  it("returns an empty list for undecorated classes instead of failing", () => {
    const Plain = createConsumerClass();

    expect(getQueueHandlerMethodNames(Plain.prototype)).toEqual([]);
    expect(getQueueHandlerMethodNames({})).toEqual([]);
    expect(hasQueueHandlerRegistration({}, "handle")).toBe(false);
  });
});
