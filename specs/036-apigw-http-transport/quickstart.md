# Quickstart: 036 — APIGW HTTP Transport

## Цель

«Шлюз → функция → NestJS → 200» с минимальными руками.

## Сценарий

1. ✅ **Захват реального события** (выполнен 2026-09-17): временный echo-хендлер на `user_service`, `curl` через шлюз (6 кейсов), боевая версия восстановлена. Дампы — `/var/folders/5z/j6z6rscd3s10cls83q4wbnt40000gn/T/opencode/captured-apigw-event*.json`.

2. **Fixture (эвиденс фиксируется в репо)**:
   ```bash
   # санитизируем IP/requestId/даты/заголовки → плейсхолдеры; структура verbatim
   packages/nest-bridge/fixtures/http-apigw/get-without-query.json        # GET без query
   packages/nest-bridge/fixtures/http-apigw/repeated-query-parameters.json # GET с повторами query
   ```

3. **RED-тест** (до реализации):
   ```bash
   pnpm --filter @ycforge/nestjs-connector test -- http-apigw-transport
   ```
   Минимальное Nest-приложение (`GET /users`), fixture через `createYandexHandler` → до фикса падает `unknownInvocationEvent`.

4. **Реализация** (Phase 2 tasks): `yc-apigw-raw-event.ts`, `validate-yc-apigw-event.ts`, `yc-apigw-event-adapter.ts`, правки `adapter.ts` + параметризация `normalize-request.ts`.

5. **GREEN**: suite зелёный; conformance (fixture через публичное API) → 200.

6. **Реальный деплой** (Yandex Cloud, SA ycforge-reference):
   ```bash
   pnpm --filter @ycforge/nestjs-connector build
   rm -rf examples/reference-project/.ycsf/cache     # после правок bundle
   # build (workdir builders-core/pilot) + materialize + terraform apply
   curl -i https://d5dh7d6flrd3cm28mrle.nnekmrav.apigw.yandexcloud.net/users
   # → HTTP/1.1 200  {"users":["alice","bob"]}
   ```

   Прямой invoke captured-событием (без шлюза):
   ```bash
   yc serverless function invoke user-service --data-file packages/nest-bridge/fixtures/http-apigw/get-without-query.json
   # → {"statusCode":200,...}
   ```

## Критерии готовности

- [ ] `pnpm --filter @ycforge/nestjs-connector test` зелёный (дискриминаторы + conformance).
- [ ] Реальный `GET /users` через шлюз → 200.
- [ ] Fixtures `fixtures/http-apigw/*.json` закоммичены с provenance.
- [ ] AGENTS.md / ARCHITECTURE.md / IDEA.md §2 обновлены.