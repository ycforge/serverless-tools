/**
 * Public entry point of the `./context` subpath export (spec 003, FR-007):
 * pure re-exports of the existing execution-context module.
 *
 * FR-008: imports only concrete internal modules, never the root barrel.
 */
export { YandexContext } from "../context/yandex-context.decorator";
export type { YandexExecutionContext } from "../context/yandex-execution-context";
export type { ContextParameterDecorator } from "../decorators/decorator-contracts";
