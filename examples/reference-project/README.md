# @ycforge/reference-project — эталонный end-to-end проект

Канонический reference-проект монорепозитория **serverless-tools** (spec 024): четыре
приложения, проходящие весь конвейер `ycsf-тулов` от исходников (NestJS) до
валидированного `terraform plan`. Никакого `apply`, публикации артефактов, push в
registry и секретов — единственная сетевая активность: `pnpm install` (зависимости)
и `terraform init` (загрузка provider-плагинов).

| App | Builder | Materializer | Terraform address |
|-----|---------|--------------|-------------------|
| `user_service` | `ycforge:function` (nestjs-function) | `yandex-function` | `yandex_function.user_service` |
| `analytics` | `ycforge:docker-image` (docker, `no_push`) | `yandex-serverless-container` | `yandex_serverless_container.analytics` |
| `frontend` | `ycforge:frontend` (vite) | `yandex-storage-bucket` | `yandex_storage_bucket.frontend` + `yandex_storage_object.frontend_*` |
| `openapi` | `ycforge:api-gateway` (composer builder) | `yandex-api-gateway` | `yandex_api_gateway.openapi` |

## Требования

- Node ≥ 22, pnpm (workspace-monorepo), Terraform ≥ 1.5
- Docker daemon — только для полного пути `analytics` (локальная сборка без push)

## Запуск от clone до плана

```bash
pnpm install
pnpm -r build            # собрать dist всех пакетов (включая компаньон-packages)
pnpm --filter @ycforge/reference-project plan
```

`plan` = `ycsf check` → `ycsf build` → `ycsf materialize` (cwd=`infra/`) →
`terraform init` → `terraform validate` → `terraform plan`. Разбиение по стадиям:

```bash
pnpm --filter @ycforge/reference-project check        # ycsf check --validate-tf
pnpm --filter @ycforge/reference-project check:validate-tf
pnpm --filter @ycforge/reference-project build         # ycsf build
pnpm --filter @ycforge/reference-project materialize   # ycsf materialize (cwd=infra/)
cd infra && terraform init && terraform validate && terraform plan
```

**Статус гейтов на текущем тулчейне** (без правок `packages/`):

- `ycsf build` по целям зелёный: `user_service` → `function.zip` (cache-aware,
  детерминированный sha256), `frontend` → статический dist (vite), `openapi` →
  скомпилированный `openapi.json`. Полный `build` падает на `analytics` — docker
  builder передаёт относительный `sourcePath` как build context (см. ограничения).
- `ycsf check` на холодном дереве **зелёный** (exit 0, `All checks passed.`):
  `.ycsf/*.ycsf.tf.json` снапшоты закоммичены в репо по паттерну pilot canonical
  (`packages/pilot/test/check/fixtures/canonical/.ycsf/`). Extensions/outputs
  разрешаются по IDL в снапшотах. Задокументированная граница (T033/T034):
  `generated-loader.ts:16` читает `.ycsf/`, materialize пишет `infra/` — снапшоты
  устареют после T034 (generated-dir alignment).
- `ycsf materialize` заблокирован интеграционными дефектами конвейера (D1/D2/D10) —
  golden-файлы заморожены по контракту + реальным значениям в `test/fixtures/`
  (см. «Генерируемые файлы» и `specs/024-e2e-reference/tasks.md`).

**Граница без креденшалов (CI-путь)**: `terraform plan` без `YC_TOKEN` /
`SERVICE_ACCOUNT_KEY_FILE` гарантированно останавливается на настройке провайдера —
до какого-либо обращения к Yandex Cloud:

```
Error: one of 'token' or 'service_account_key_file' should be specified
```

(exit ≠ 0; все стадии до terraform plan проходят локально и оффлайн). Проверено на
provider-совместимых (boundary) фикстурах `test/fixtures/boundary/`: `terraform validate`
→ 0 диагностик, `plan` → ровно этот stop. На форме вывода текущих materializer-ов
`validate` падает (D12 — провайдер требует `image{url}`, `name`, `memory`; см. ограничения).

## Конфигурация

`.ycsf/*` — версия 1, дерево:

- `apps.yaml` — 4 приложения в map-form; `builder` = artifact-тип (`ycforge:*`);
  `openapi` зависит от трёх остальных (топологический порядок сборки).
- `builders.yaml` — явный маппинг builder-ключей (`ycforge:*`) и materializer-ключей
  (`yandex-*`) на пакеты. Builder `ycforge:api-gateway` указывает на модуль
  composer-сборщика относительным путём.
- `extensions.yaml` — provider-патчи через IDL (`functions.user_service`, `gateways.openapi`).
- `outputs.yaml` — user-outputs через IDL-ссылки
  (`functions.user_service.id`, `gateways.openapi.id`).
- `.ycsf/resources.yaml` в эталоне **отсутствует**: корневой gateway не ссылается
  на apps-функции (composer-ссылки на apps-identity не реализованы — `PML_IDENTITY_COLLISION`);
  интеграции gateway — только `mock`. `apps/openapi/auth.yaml` присутствует с
  `defaultScheme: none` — composer требует файл auth-конфига как вход сборки.

Per-app `build_config.yaml` лежит на корне эталона рядом с приложением
(`<root>/<appId>/build_config.yaml`, читается моделью Project C), исходники — в
`apps/<appId>/`.

## Генерируемые файлы

`infra/*.ycsf.tf.json` (по файлу на приложение) + `infra/99-ycsf-outputs.tf.json`
(user + auto outputs) + `infra/generated/openapi-openapi.yaml` (companion
gateway-спеки). Golden-эталоны — в `test/fixtures/`, provider-совместимый набор для
terrafrom-границы — в `test/fixtures/boundary/`. Абсолютные пути в фикстурах
заменены на плейсхолдер `<ROOT>` (материализуется при сравнении).

## Тесты

```bash
pnpm --filter @ycforge/reference-project test   # hermetic vitest: golden, plan, check-boundary, model, secret-scan, docs-lint
```

Без сети и без облака: golden-структура, композиция plan-скриптов, границы
`ycsf check` (холодный = green / suspicious-key RED), конфигурационная
санитарная проверка, секрет-скан, docs-линт. CLI-зависимые тесты
пропускаются на чищеном checkout без `packages/*/dist` (skipIf).

## Известные ограничения

- `@ycforge/composer/builder` не резолвится реестром pilot напрямую (`BRG_PACKAGE_NOT_FOUND`,
  pilot не зависит от composer); в эталоне используется относительный путь к
  модулю composer-сборщика. После исправления резолюции реестра значение ключа
  заменяется на `@ycforge/composer/builder`.
- CLI pilot при вызове через pnpm-shim не запускается (guard `process.argv[1]`):
  скрипты эталона вызывают `node ../../packages/pilot/dist/cli/index.js` по
  реальному пути из репозитория — без правок `packages/` это единственный рабочий
  инвокейшн (D7).
- Логические ссылки gateway→apps через `authorizer function_id` не собираются
  (единственный reference-bearing field composer-сборщика; path-level
  `x-yc-apigateway-integration`-ссылки не поддерживаются) — в эталоне `mock`-
  integration, файл `auth.yaml` требуется composer-ом как вход (D11). Carrier
  `x-yc-apigateway-authorizer.function_id` требует декларацию функции в
  `resources.yaml` (в эталоне отсутствует, PML_IDENTITY_COLLISION); path-level
  refs — зарегистрирован follow-up **spec 034** `composer-path-level-refs`.
- `ycsf check` читает сгенерированную tf-модель только из `.ycsf/`, а materialize
  пишет только в `infra/` — на холодном дереве check выдаёт 6 диагностик без
  снапшотов (D9). T033 решает cold-check-green коммитом `.ycsf/*.ycsf.tf.json`
  снапшотов; полная генерализация — T034 (follow-up spec).
- docker-builder передаёт относительный `sourcePath` как build context при
  `cwd=sourcePath` → `unable to prepare context: path ... not found` (D10).
- materializer-ы эмитят tf-JSON, несовместимый со схемой provider `yandex-cloud`
  ~> 0.145: `image` должны быть блоком `[{url}]`, для `yandex_function` /
  `yandex_serverless_container` обязательны `name`+`memory` (D12) — provider-валидная
  форма проверена в `test/fixtures/boundary/`.
- `ycsf materialize` / materialization через `ycsf plan` на текущей версии тулов
  упирается в `archivePath` (должен быть относительным, а build-пайплайн отдаёт
  абсолютные пути; D1/D2) — см. `specs/024-e2e-reference/tasks.md` и финальный
  отчёт фазы.

## Локальная разработка (US-7)

```bash
pnpm --filter @ycforge/reference-project dev:user_service   # http://127.0.0.1:3000, через @ycforge/js-dev-tools/server
pnpm --filter @ycforge/reference-project dev:analytics       # http://127.0.0.1:8080, analytics через @ycforge/js-dev-tools/server
```

Обе команды fail-open без IAM-токена (`JDT_IAM_UNAVAILABLE` в логе, запросы
обрабатываются без подписи), порт берётся из `PORT` (по умолчанию 3000 и 8080).
Локальный запрос:

```bash
curl http://127.0.0.1:3000/
curl http://127.0.0.1:8080/
```

`dev:analytics` сначала компилирует приложение через `tsc -p apps/analytics/tsconfig.json`
(`design:paramtypes` эмитит только tsc — esbuild/tsx не умеют `emitDecoratorMetadata`,
а `node --experimental-strip-types` не разбирает декораторы вовсе), затем поднимает
dev-server на скомпилированном `dist/app.module.js`. Gradle-образ той же сборки
(`apps/analytics/Dockerfile`, многоступенчатый `tsc` → `node dist/main.js`) —
container-рантайм (US-4).

## Вне scope

`terraform apply` / `ycsf apply`, destroy, publish, деплой, push docker-image,
cloud-креденшалы в репо (`.env*` запрещены; credentials — runtime-env),
внешние `resources.yaml`-сущности.