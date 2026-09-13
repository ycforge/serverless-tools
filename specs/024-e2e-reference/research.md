# 024 — Исследование фактического поведения инструментария (research.md)

Статус: P0 / эмпирические пробы T001–T006 (данные получены в сессии 2026-09-13).

Ожидание из plan.md против реальности. Все утверждения — про **фиксированный тулчейн** (`packages/*` НЕ менялись), окружение: node 22.22.3, pnpm, Terraform v1.15.8 darwin/arm64, docker CLI 29.5.2 (демон не запущен), не-монолитная среда сборки запускалась из корня монорепо и из scratch-проекта `$TMPDIR/opencode/scratch-024`.

## T001 — регистрация builders/materializers

| Утверждение (plan.md) | Факт |
|---|---|
| Ключ `ycforge:api-gateway` допустим в `builders:` и `materializers:` | ЛОЖЬ: `BRG_KEY_COLLISION` `duplicate key '…' in builders and materializers` (`packages/pilot/src/registry/builders-yaml.ts:123`). Materializer-ключ обязан быть иным (семантический, напр. `yandex-api-gateway`). |
| `@ycforge/composer/builder` резолвится реестром pilot | ЛОЖЬ: `BRG_PACKAGE_NOT_FOUND` `package '…' not found` (`packages/pilot/src/registry/load.ts:44-45`) — реестр делает `await import(entry.packageName)` из дистрибутива pilot (`load.ts`), а pilot не зависит от composer. Рабочий обход в scratch: относительный путь `../../../composer/dist/builder/index.js` (от `packages/pilot/dist/cli/`). |

## T002 — resources.yaml / ссылки `${resources.*}` (ФР-010, пробы A/B/C)

ФР-010 утверждает: `.ycsf/resources.yaml` отсутствует; builder «собирает resourceReferences без обращения к resources.yaml».

- `compileCompositionInner` строит индекс `buildResourceIndex(projectRoot)` и вызывает `resolveReferences(..., index)` — `packages/composer/src/compile-core.ts:64` и `:114`.
- При ПУСТОМ индексе ссылка `${resources.functions.user_service.id}` в ОДИНСТВЕННОМ bearer-поле → `RESOURCE_REF_NOT_DECLARED` (`resource not declared: functions.user_service`, `reference-resolver.ts:72`; сообщение `packages/composer/src/resource/errors.ts:52`). Проба B — фактический текст ошибки шага build.
- При отсутствии ссылки в bearer-поле, но её наличии в path-integration (`x-yc-apigateway-integration.function_id`) build ПРОХОДИТ, но: сбор ссылок касается только bearer-полей (`REFERENCE_BEARER_FIELDS`, см. `packages/composer/src/resource/refs/template.ts`), и ссылка остаётся в артефакте как есть; materializer-замена затрагивает только `value.resourceReferences` (`packages/materializers-core/src/yandex-api-gateway/ref-resolver.ts`) → в `*.tf.json` попадает сырой `${resources.functions.user_service.id}` → интерполяционная ошибка terraform. Проба C.
- Объявление `functions.user_service` в resources.yaml запрещено: `checkIdentityCollision` (только домен `functions`) → `PML_IDENTITY_COLLISION` `identity 'functions.user_service' exists in both apps.yaml and resources.yaml` — `packages/pilot/src/model/resources.ts:84-96`, вызывается на любом командном пути из `packages/pilot/src/model/loader.ts:90`.
- Функциональная схема auth требует индекс: `validateFunctionReferences` → «auth config function reference functions.user_service is not declared in the composition functions set». Проба A.

**Вывод**: при фиксированном тулчейне эталонный gateway НЕ может сослаться на `user_service` через `${resources.functions.user_service.id}` ни в одном из способов. ФР-010 эмпирически невыполнима без изменений в `packages/*` ИЛИ без авторизованного отклонения в спецификации.

## T003 — материализация и сопутствующие файлы

- Самостоятельный `ycsf materialize` с реальными materializer'ами: `MTL_MATERIALIZE_FAILED: Cannot destructure property 'specPath' of 'value' as it is undefined` — `cli/materialize.ts:111` вызывает `runMaterializeGeneration` БЕЗ артефактов (без value); threading значений есть только в `plan`/`apply` (`cli/pipeline.ts:178`). → канонический скрипт из 6 шагов (check && build && materialize && init && validate && plan) неработоспособен «как написано в plan.md:244-252».
- `ycsf plan` материализует, инжектит values, гонит init и plan (но НЕ `check` и НЕ `validate`).
- Companion-файл `generated/<name>-openapi.yaml` пишется в `process.cwd()/generated`, т.к. `resolve(process.cwd(), 'generated')` — `packages/materializers-core/src/yandex-api-gateway/index.ts:28-31`; tf.json ссылается на `${path.module}/generated/<name>-openapi.yaml` (там же `:38`) → требуется `infra/generated/`. Pilot не chdir'ит; terraform-процесс работает с cwd=infra (`cli/terraform.ts`). Эмпирически: при cwd=scratch файл попал в `$S/generated/`, `$S/infra/generated` отсутствует → terraform plan упал бы на чтении файла.
- Относительный `source_path` в apps.yaml НЕ нормализуется относительно root: `context.sourcePath = app.source_path` как есть (`packages/pilot/src/build/index.ts:274-280`), docker builder спавнит `spawn('docker', …, {cwd: sourcePath})` (`packages/builders-core/src/docker/cli.ts:32`) → cwd≠root + относительный путь = несуществующий cwd = маскированный `spawn docker ENOENT`. При абсолютном `source_path` — реальная ошибка демона.

## T004 — outputs

- Авто-выходы материализаторов: `<name>_function_id` (yandex-function), `<name>_container_id` (yandex-serverless-container), `<name>_bucket_id` (yandex-storage-bucket), `<name>_gateway_id` (yandex-api-gateway) — `context.output.declare(...)` в каждом `packages/materializers-core/src/yandex-*/index.ts`.
- Объявление пользовательского output с тем же именем → `OUT_DUPLICATE_NAME` `output name '…' declared more than once` / `collides in the merged output file` (`packages/pilot/src/outputs/build.ts:58,91`).

## T005 — terraform-граница

- `terraform init` (декод provider, загрузка плагина) — единственный сетевой шаг; без кредов проходит.
- `terraform validate -no-color` оффлайн: ловит неполноту конфигурации («Missing required argument …») и проходит при корректной конфигурации — до кредов.
- `terraform plan` без кредов останавливается на границе провайдера: `one of 'token' or 'service_account_key_file' should be specified; if you are inside compute instance, …` , exit≠0. Эмпирически на yandex_function (полная конфигурация) и на пустой конфигурации (пустой план = успех).
- `ycsf check --validate-tf` спомнит `terraform validate` с cwd=infra (`packages/pilot/src/check/categories/terraform-validate.ts`), 30s timeout.
- **Критический факт**: материализованная конфигурация yandex_api_gateway содержит только `spec` → `terraform plan` падает `Missing required argument name` («openapi.ycsf.tf.json line 6»). Аналогично yandex_function: эмитятся runtime/entrypoint/user_hash/content, но требуются `name` и `memory`. yandex_serverless_container (name+image) и yandex_storage_bucket (bucket+acl) — полны. Т.е. материализованный TF-конфиг для функции и gateway не готов к `validate`/`plan` — до границы кредов эталонный проект не дойдёт.

## T006 — docker-граница (без демона)

- Холодная сборка: `CLI_BUILD_FAILED: build failed for app 'analytics': docker build failed: ERROR: failed to connect to the docker API at unix://…/docker.sock … connect: no such file or directory (BLC_BUILD_FAILED)` — стабильное имя стадии, `no_push` не пытается пушить.
- Тест на герметичность no-push (фейковый docker) — из `packages/builders-core/test/helpers/fake-bins.ts` (паттерн для golden-каптча).

## Сводка блокеров для эталонного проекта (needs decision)

1. ФР-010 (без resources.yaml) невыполнима — нужны правки `packages/composer`/`packages/pilot` или авторизованное отклонение.
2. Скрипт из 6 шагов (standalone `ycsf materialize`) неработоспособен — пути нет вне `ycsf plan` или правок pilot.
3. Материализованные конфиги function/gateway не проходят `terraform validate`/`plan` без правок materializers-core.
4. Companion-файл пишется не в `infra/generated` (композиция шагов/`cwd` в тулчейне).
5. Прочее (не блокеры, а отклонения-флаги): относительный `source_path`, `BRG_KEY_COLLISION`, `BRG_PACKAGE_NOT_FOUND` для `@ycforge/composer/builder`, коллизия output-имён.