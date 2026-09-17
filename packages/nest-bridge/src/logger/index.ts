/**
 * Public entry point of the `./logger` subpath export (spec 004, FR-012):
 * the application logger provider and its type contracts.
 *
 * FR-008: imports only concrete internal modules, never the root barrel
 * `src/index.ts`; the static guard test in
 * `test/packaging/no-root-barrel-import.spec.ts` enforces it.
 */
export { YandexLogger, type YandexLogLevel, type YandexLogRecord } from "./yandex-logger";