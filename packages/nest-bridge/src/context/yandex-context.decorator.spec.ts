import { getYandexContextParameterIndexes, YandexContext } from "./yandex-context.decorator";

/**
 * Specs for the `@YandexContext()` parameter decorator (issue #4). Decorators
 * are applied imperatively (exactly what legacy decorator desugaring does) so
 * the suite stays independent of decorator compilation settings.
 */

/** Rest-parameter handlers keep decorated positions valid at any arity. */
class HandlerFixture {
  readonly receivedParameters: unknown[] = [];

  handle(...parameters: unknown[]): void {
    this.receivedParameters.push(...parameters);
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

describe("@YandexContext() parameter decorator", () => {
  it("registers the decorated parameter position for discovery", () => {
    const Handler = createHandlerClass();

    expect(getYandexContextParameterIndexes(Handler.prototype, "handle")).toEqual([]);

    YandexContext()(Handler.prototype, "handle", 1);

    expect(getYandexContextParameterIndexes(Handler.prototype, "handle")).toEqual([1]);
  });

  it("accumulates multiple decorated parameters in ascending order", () => {
    const Handler = createHandlerClass();
    YandexContext()(Handler.prototype, "handle", 2);
    YandexContext()(Handler.prototype, "handle", 0);

    expect(getYandexContextParameterIndexes(Handler.prototype, "handle")).toEqual([0, 2]);
  });

  it("deduplicates repeated decoration of the same parameter", () => {
    const Handler = createHandlerClass();
    YandexContext()(Handler.prototype, "handle", 0);
    YandexContext()(Handler.prototype, "handle", 0);

    expect(getYandexContextParameterIndexes(Handler.prototype, "handle")).toEqual([0]);
  });

  it("keeps registrations of different methods and classes isolated", () => {
    const First = createHandlerClass();
    const Second = createHandlerClass();
    YandexContext()(First.prototype, "handle", 0);
    YandexContext()(Second.prototype, "handle", 0);
    YandexContext()(First.prototype, "otherMethod", 0);

    // A registration on one method must never surface on another method or
    // another provider's identically named method (no cross-talk).
    expect(getYandexContextParameterIndexes(Second.prototype, "handle")).toEqual([0]);
    expect(getYandexContextParameterIndexes(First.prototype, "otherMethod")).toEqual([0]);
    expect(getYandexContextParameterIndexes(First, "handle")).toEqual([]);
  });

  it("resolves registrations through the prototype chain for inherited handlers", () => {
    const DecoratedBase = createHandlerClass();
    YandexContext()(DecoratedBase.prototype, "handle", 0);
    class ChildController extends DecoratedBase {}

    expect(getYandexContextParameterIndexes(ChildController.prototype, "handle")).toEqual([0]);
  });

  it("returns an empty list for undecorated methods instead of failing", () => {
    const Plain = createHandlerClass();

    expect(getYandexContextParameterIndexes(Plain.prototype, "handle")).toEqual([]);
    expect(getYandexContextParameterIndexes({}, undefined)).toEqual([]);
  });
});
