# @ycforge/reference-project — эталонный end-to-end проект

Канонический reference-проект монорепозитория **serverless-tools** (spec 024): четыре
приложения, проходящие весь конвейер `ycsf-тулов` от исходников (NestJS) до
валидированного `terraform plan` (и опционального `apply` через скрипт `deploy`).
Гейтящий путь — без `apply`, публикации артефактов, push в registry и секретов;
сетевая активность гейтов: `pnpm install` (зависимости) и `terraform init`
(загрузка provider-плагинов).

| App | Builder | Materializer | Terraform address |
|-----|---------|--------------|-------------------|
| `user_service` | `ycforge:function` (nestjs-function) | `yandex-function` | `yandex_function.user_service` |
| `analytics` | `ycforge:docker-image` (docker, `registry-ref`) | `yandex-serverless-container` | `yandex_serverless_container.analytics` |
| `frontend` | `ycforge:frontend` (vite) | `yandex-storage-bucket` | `yandex_storage_bucket.frontend` + `yandex_storage_object.frontend_*` |
| `openapi` | `ycforge:api-gateway` (composer builder) | `yandex-api-gateway` | `yandex_api_gateway.openapi` |

## Требования

- Node ≥ 22, pnpm (workspace-monorepo), Terraform ≥ 1.5
- Docker daemon — только для пути `analytics`, требующего локальной сборки образа
  без родного amd64 (см. ниже); базовый `plan`-путь без docker

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

**Статус гейтов на текущем тулчейне**:

- `ycsf build` зелёный по всем четырём приложениям: `user_service` → `function.zip`
  (cache-aware, детерминированный sha256), `frontend` → статический dist (vite),
  `openapi` → скомпилированный `openapi.json`, `analytics` → registry-ref
  (детерминированно, без docker-демона).
- `ycsf check` на холодном дереве **зелёный** (exit 0, `All checks passed.`):
  `.ycsf/*.ycsf.tf.json` снапшоты закоммичены в репо по паттерну pilot canonical
  (`packages/pilot/test/check/fixtures/canonical/.ycsf/`). Extensions/outputs
  разрешаются по IDL в снапшотах. Задокументированная граница (T033/T034):
  `generated-loader.ts:16` читает `.ycsf/`, materialize пишет `infra/` — снапшоты
  устареют после T034 (generated-dir alignment).
- `ycsf materialize` зелёный: эмитит provider-совместимый tf-JSON
  (`image`-блок, `name`/`memory`, extension-патчи) и companion gateway-спеки
  с flat-рефами (`${yandex_function_user_service_id}`) + `templatefile`.
  Golden-файлы в `test/fixtures/` регенерируются из реального выхода конвейера
  (с подстановкой `<ROOT>`); boundary-набор `test/fixtures/boundary/` — та же
  генерация + companion-спека в `generated/`.

**Граница без креденшалов (CI-путь)**: `terraform plan` без `YC_TOKEN` /
`YC_SERVICE_ACCOUNT_KEY_FILE` гарантированно останавливается на настройке провайдера —
до какого-либо обращения к Yandex Cloud:

```
Error: one of 'token' or 'service_account_key_file' should be specified
```

(exit ≠ 0; все стадии до terraform plan проходят локально и оффлайн). Проверено на
boundary-фикстурах `test/fixtures/boundary/`: `terraform validate` → 0 диагностик,
`plan` → ровно этот stop.

**Деплой (`pnpm ... deploy`)**: `check → build → materialize → terraform init →
validate → apply -auto-approve`. Требует креденшалы через env:
`YC_SERVICE_ACCOUNT_KEY_FILE` (путь к ключу SA; пример — `sa-key.json` в корне,
gitignore-нут) и `YC_FOLDER_ID`. Smoke после apply:
`https://<gateway-domain>/users`, `/analytics`, `/analytics/kms` (domain —
`yc serverless api-gateway get <id>`).

### Ручная проверка логов: `/users/logs`

`user_service` отдаёт диагностический роут `GET /users/logs`, который пишет
структурированные логи Nest через коннектор с выбранным уровнем (spec 037), —
удобно проверять severity в Cloud Logging руками:

| Параметр  | Значения                                                                     | По умолчанию       |
|-----------|------------------------------------------------------------------------------|--------------------|
| `level`   | `verbose`, `debug`, `log`, `info`, `warn`, `error`, `fatal`, `all`           | `log`              |
| `message` | произвольный текст                                                            | `manual log probe` |
| `count`   | целое 1..100                                                                  | `1`                |
| `context` | строка (поле `context` записи)                                                | `users-manual-probe` |

```bash
DOMAIN=$(yc serverless api-gateway get <gateway-id> --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["domain"])')

# один уровень, с явным маркером и контекстом
curl -s "https://$DOMAIN/users/logs?level=warn&message=probe&count=2&context=manual"
# все шесть уровней одним вызовом (verbose→TRACE … fatal→FATAL)
curl -s "https://$DOMAIN/users/logs?level=all&message=probe"

# записи функции за последние 15 минут (там видно колонку уровня)
yc serverless function logs <function-id> --since 15m | grep probe
```

Ожидаемая колонка уровня в Cloud Logging: `TRACE/DEBUG/INFO/WARN/ERROR/FATAL`
(Nest `verbose/log/info/error` маппятся в `TRACE/INFO/INFO/ERROR`). Каждая запись
несёт `trace_id`/`awsRequestId` текущего вызова, поэтому запрос легко
скоррелировать с ответом (ошибки возвращают `trace_id` в теле). `count`
объявлен как `type: integer, default: 1`: шлюз материализует дефолт числом, а
коннектор (spec 038) принимает типизированные значения параметров и нормализует
их в строки, поэтому вызов без параметра тоже отвечает `200`. Само значение
дефолта в запрос приложения не подмешивается — контроллер применяет свою
логику по умолчанию.

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

Per-app `build_config.yaml` лежит в `source_path` приложения
(`apps/<appId>/build_config.yaml`, читается моделью Project C), исходники — там же, в
`apps/<appId>/`.

Имя бакета Object Storage глобально-уникально (S3-парадигма), поэтому эталон
использует схему `<appId>-<slug>`: slug — 8-hex, сгенерирован на первой сборке и
закреплён в `.ycsf/state.json` (коммитится в эталоне для детерминизма golden;
обычный проект может gitignore-ать его — каждая среда получит свой бакет).
Пользовательский override — `build_config.bucket_name` (vite builder, spec 035):
тогда имя бакета ровно `bucket_name`, без slug. Materializer получает это значение
в `FrontendArtifactValue.bucketName`; при его отсутствии
materializer падает на app id (обратная совместимость).

Контейнер `analytics` в эталоне закреплён за уже запушенным amd64-образом через
`image.mode: registry-ref` (spec 028): деплой ревизии контейнера в YC-рантайм
требует x86_64, тогда как локальная `docker build` на Apple Silicon даёт arm64 и
`yandex_serverless_container` падает с Internal error на стадии деплоя ревизии.
`registry-ref` делает `ycsf build` детерминированным (без docker-демона); чтобы
пересобрать образ из исходников, выполните кросс-сборку
(`docker buildx build --platform linux/amd64 --push`) и обновите `apps/analytics/build_config.yaml`.

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
- Логические ссылки gateway→apps собираются через path-level рефы
  (`${resources.functions.<app>.id}` / `${resources.containers.<app>.id}` в
  `apps/openapi/openapi.yaml`), которые materializer переписывает в flat-переменные
  `templatefile`. Carrier `x-yc-apigateway-authorizer.function_id` требует декларацию
  функции в `resources.yaml` (в эталоне отсутствует, PML_IDENTITY_COLLISION).
- `ycsf check` читает сгенерированную tf-модель только из `.ycsf/`, а materialize
  пишет только в `infra/` — на холодном дереве check выдаёт диагностики без
  снапшотов (D9). T033 решает cold-check-green коммитом `.ycsf/*.ycsf.tf.json`
  снапшотов; полная генерализация — T034 (follow-up spec).
- api-gateway materializer пишет companion-спеку (`generated/openapi-openapi.yaml`)
  как побочный эффект `dispatch` — тесты (`test/dispatch.spec.ts`) поэтому работают
  в sandbox-директории, чтобы не затирать реальный выход `infra/`.

## Локальная разработка (US-7)

```bash
pnpm --filter @ycforge/reference-project dev:user_service   # http://127.0.0.1:3000, через @ycforge/serverless-dev-tools/server
pnpm --filter @ycforge/reference-project dev:analytics       # http://127.0.0.1:8080, analytics через @ycforge/serverless-dev-tools/server
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

`ycsf apply` как отдельная стадия тулчейна, destroy, publish, push docker-image
из конвейера, cloud-креденшалы в репо (`.env*`/`sa-key.json` запрещены;
credentials — runtime-env: `YC_SERVICE_ACCOUNT_KEY_FILE`, `YC_FOLDER_ID`),
внешние `resources.yaml`-сущности. `terraform apply` доступен опционально через
скрипт `deploy` (см. «Деплой» выше) и не является частью гейтящего `plan`-пути.