import { getQueueMessageParameterIndexes, QueueMessage } from "./queue-message.decorator";

/**
 * Specs for the `@QueueMessage()` parameter decorator (issue #8). Decorators
 * are applied imperatively (exactly what legacy decorator desugaring does) so
 * the suite stays independent of decorator compilation settings.
 */

/** Rest-parameter handlers keep decorated positions valid at any arity. */
class HandlerFixture {
  handle(...parameters: unknown[]): void {
    void parameters;
  }
}

/**
 * Fresh handler class per test: registration state lives in module-private
 * registries keyed by prototype, so every spec decorates its own class to
 * stay independent of its siblings.
 */
function createHandlerClass(): typeof HandlerFixture {
  return class extends HandlerFixture {};
}

describe("@QueueMessage() parameter decorator", () => {
  it("registers the decorated parameter position for discovery", () => {
    const Handler = createHandlerClass();

    expect(getQueueMessageParameterIndexes(Handler.prototype, "handle")).toEqual([]);

    QueueMessage()(Handler.prototype, "handle", 1);

    expect(getQueueMessageParameterIndexes(Handler.prototype, "handle")).toEqual([1]);
  });

  it("accumulates multiple decorated parameters in ascending order", () => {
    const Handler = createHandlerClass();
    QueueMessage()(Handler.prototype, "handle", 2);
    QueueMessage()(Handler.prototype, "handle", 0);

    expect(getQueueMessageParameterIndexes(Handler.prototype, "handle")).toEqual([0, 2]);
  });

  it("deduplicates repeated decoration of the same parameter", () => {
    const Handler = createHandlerClass();
    QueueMessage()(Handler.prototype, "handle", 0);
    QueueMessage()(Handler.prototype, "handle", 0);

    expect(getQueueMessageParameterIndexes(Handler.prototype, "handle")).toEqual([0]);
  });

  it("keeps registrations of different methods and classes isolated", () => {
    const First = createHandlerClass();
    const Second = createHandlerClass();
    QueueMessage()(First.prototype, "handle", 0);
    QueueMessage()(Second.prototype, "handle", 1);
    QueueMessage()(First.prototype, "otherMethod", 2);

    // A registration on one method must never surface on another method or
    // another provider's identically named method (no cross-talk).
    expect(getQueueMessageParameterIndexes(Second.prototype, "handle")).toEqual([1]);
    expect(getQueueMessageParameterIndexes(First.prototype, "otherMethod")).toEqual([2]);
    expect(getQueueMessageParameterIndexes(First.prototype, "handle")).toEqual([0]);
  });

  it("resolves registrations through the prototype chain for inherited handlers", () => {
    const DecoratedBase = createHandlerClass();
    QueueMessage()(DecoratedBase.prototype, "handle", 0);
    class ChildConsumer extends DecoratedBase {}

    expect(getQueueMessageParameterIndexes(ChildConsumer.prototype, "handle")).toEqual([0]);
  });

  it("returns an empty list for undecorated methods instead of failing", () => {
    const Plain = createHandlerClass();

    expect(getQueueMessageParameterIndexes(Plain.prototype, "handle")).toEqual([]);
    expect(getQueueMessageParameterIndexes({}, undefined)).toEqual([]);
  });

  it("keeps the normalized message contract importable under the decorator name", () => {
    // Merged export (issue #8): consumers import one `QueueMessage` name and
    // get both the decorator factory (value) and the normalized message type.
    // Using the same identifier as a type below proves the merge compiles.
    const message: QueueMessage | null = null;
    expect(typeof QueueMessage).toBe("function");
    expect(message).toBeNull();
  });
});
