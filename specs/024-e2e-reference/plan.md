# Implementation Plan: e2e-reference — эталонный end-to-end проект (spec 024)

**Branch**: `024-e2e-reference` | **Date**: 2026-09-12 | **Spec**: [specs/024-e2e-reference/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md` (эталонный проект `examples/reference-project`, FR-001..FR-024, US1..US-N, S-1..S-9, D-1..D-10, границы оценки без секретов/push/apply)

## Summary

Spec 024 добавляет **эталонный end-to-end проект `examples/reference-project`** — единственный обновляемый канонический пример монорепозитория, который прогоняет весь конвейер ycsf-тулов через реальные опубликованные пакеты (`@ycforge/pilot` bin `ycsf`, `@ycforge/builders-core/*`, `@ycforge/materializers-core/*`, `@ycforge/composer`): приложения `user_service` (NestJS-функция), `analytics` (Docker-контейнер), `frontend` (статический сайт в Object Storage), `openapi` (API Gateway поверх остальных), единая команда `pnpm run plan` = `ycsf check && ycsf build && ycsf materialize && terraform init && terraform validate && terraform plan`. Без `.env`/секретов в репозитории, без push образов, без `apply`/деплоя; граница оценки фиксируется эмпирически (terraform 1.15.8, provider `yandex-cloud/yandex`).

**Ключевой вывод планирования**: конфигурация эталонного проекта задана спецификацией намеренно «поверх» реальных пакетов, но текущие публичные контракты package-пака не дают собрать bind с конфига (обнаружено 6 блокирующих интеграционных разрывов BIG-1..BIG-6 с точечными доказательствами — см. раздел ниже). Поэтому план фиксирует целевую конфигурацию/границы/тесты промежуточно и в фазе A объявляет **обязательные правки пакетов** как follow-up спецификации (каждая — отдельный номер, повтор номеров запрещён); без них этап B+C физически не компилируется. Никаких правок `packages/` в этом PR — план описывает design, а не кодификацию.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node 22+ (ESM, `"type": "module"`, `engines.node >= 22`). Пример — `package.json` типа `@ycforge/reference-project` (FR-001; plan-вариант `@ycforge-example/…` — минорный флаг, spec wins), не публикуется (`private`), подключается через `pnpm-workspace.yaml` (`examples/*`). Git — English, docs/examples — Russian.

**Primary Dependencies**: `@ycforge/pilot` (bin `ycsf`, export `./contracts`), `@ycforge/builders-core` (subpath-экспорты `./nestjs-function`, `./docker`, `./vite`), `@ycforge/materializers-core` (subpath-экспорты `./yandex-function`, `./yandex-serverless-container`, `./yandex-storage-bucket`, `./yandex-api-gateway`), `@ycforge/composer` (нужен новый аддитивный export `./builder` — BIG-3), `yaml`, `vitest`, `typescript`. runtime-бины: `terraform` (>= 1.5, в среде 1.15.8), `docker` (опционально, среда `darwin/arm64` без running daemon), `node` 22, `pnpm`.

**Storage**: локальные артефакты build — `.ycsf/artifacts/<app>/` (gitignored, см. `.gitignore` уже содержит `.ycsf/artifacts/`), сгенерированные `.tf.json` — `infra/*.ycsf.tf.json` + `infra/99-ycsf-outputs.tf.json` (коммитятся как golden-файлы), `infra/.terraform.lock.hcl` (коммитится, FR-014), `terraform.tfstate`/`.terraform/` — никогда в git. Никакого облачного хранилища/secrets.

**Testing**: Vitest (unit + characterization). Test-first per Constitution II: каждый FR/US → ≥1 тест, RED → GREEN. Golden-файлы: byte-for-byte-сравнение содержимого `infra/*.ycsf.tf.json` и `99-ycsf-outputs.tf.json` (детерминированная сериализация `serializeJson` с лексикографическим порядком ключей, FR-009; паттерн `GOLDEN_USER_SERVICE_TF_JSON`). Секрет-скан эталонного проекта — собственный тест (BIG-6, FR-023). terraform-шаги не выполняются в vitest (hermetic, без сети): фиксируются через `plan`-скрипт и characterization-тесты границы (см. «Pipeline и границы»). Тесты не ходят в Yandex Cloud (SC-*).

**Target Platform**: `examples/reference-project` — единственный канонический пример (workspace entry). Не пакет с публичным API; `files`/exports отсутствуют. Руководство пользователя — Russian README + пошаговые команды.

**Project Type**: ссылочный/канонический пример проекта (reference project): конфигурация + исходники 4 приложений + golden-тесты. Не библиотека, не CLI, не рантайм.

**Performance Goals**: FR-019 — весь бесплатный путь (check/build/materialize/init/validate) исполняется локально за время, соизмеримое с размером fixture (секунды), без сети кроме `terraform init` (download провайдера). Golden-сравнение — детерминировано. Никакого лишнего фонового поллинга.

**Constraints**: Точность к спецификации: см. раздел «Блокирующие интеграционные разрывы» — целевая конфигурация фиксируется ДО правок (не молча), каждое отклонение/правка нумеруется и доказано (`file:line`). Секреты — структурно исключены: `.env*` (кроме `.env.example`) в `.gitignore`, `{{$ENV}}`-литералы отсутствуют (иначе `PML_ENV_NOT_SET`), `build_env` — только константы, suspicious-ключи (`SECRET|TOKEN|PASSWORD`) запрещены собственным тестом. Terraform: только `infra/main.tf` (user-owned) + C-owned generated-файлы (см. `write.ts`: C трогает только `*.ycsf.tf.json`). `ycsf plan`-команда pilot существует, но эталонный скрипт композирует шаги явно (check + validate не входят в `ycsf plan`).

**Scale/Scope**: 1 каталог `examples/reference-project/` (4 приложения), ~6 тест-файлов, 6 блокирующих правок-амендментов (каждая — follow-up spec), 24 FR, N US. Публичные контракты pilot в этом PR не меняются.

## Constitution Check

*GATE: Passed before Phase 0 research; re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS (с условием) | Эталонный проект — это полное **использование** конвейера: A (нест-функция/контейнер) поднимается из своих исходников, B (composer) компилирует openapi, C (pilot `ycsf`) руководит build/materialize/plan, Terraform provisioning — только terraform CLI (`terraform init/validate/plan`). Правки BIG-1..6 не размывают границы между компонентами: каждая адресует свой овнер (value-threading в C, builder-dispatch в C, `composer/builder` в B, `no_push` в A-билдерах). |
| II. Spec-First, Test-First | ✅ PASS | Каждый FR-001..024 и US → ≥1 тест; golden-файлы фиксируются до/во время реализации (RED через отсутствующий/ожидаемый `.tf.json`, GREEN после сборки). Исключение Constitution II (thin orchestration → characterization-тесты постфактум) применяется ТОЛЬКО к terraform-границам без сети: `terraform validate`/`plan` вывод фиксируется characterization-тестом, а не unit-моком. |
| III. Contracts Versioned | ✅ PASS (additive only) | Публичные контракты `@ycforge/pilot/contracts` и `materializers-core` не ломаются: все правки BIG-1..6 — аддитивные (расширение ключа реестра, новое поле `value` в descriptor, новый subpath export, новая опция `no_push`). Любой breaking fix — отдельная мажорная спецификация с миграцией (по конституции), в 024 не входит. |
| IV. Terraform Stays Terraform | ✅ PASS | Никакого кастомного provisioning: поставить план — значит вызвать `terraform`. Все сгенерированные файлы — стандартный `tf.json`. `.terraform.lock.hcl` — коммитится, state — нет. |
| V. Explicit Over Magic | ✅ PASS | Эмпирическое доказательство границ (раздел «Pipeline») фиксируется в README и тестами, ничего молча не допускается. Бывший пробел — отсутствие категории suspicious-ключей (BIG-6) — закрыт spec 025: категория уже в `ycsf check`; эталонный проект дополнительно держит собственный secret-scan-тест (FR-023), не полагаясь только на cat-слой pilot. |
| VI. Ownership: apps=managed | ✅ PASS | Собственность C на `.ycsf/*.yaml` и `infra/*.ycsf.tf.json` — как в спецификациях 011-016; user-owned `infra/main.tf` читается Terraform-ом, но никогда C. |
| Monorepo Tooling | ✅ PASS | Новый entry в `examples/**` (workspace уже включает `examples/third-party-contracts-plugin`); пакеты подключаются `workspace:*`, бины — из devDeps эталонного проекта. |

**Deviations (не silent, осознанно задокументированные)**: все 6 девиаций — см. раздел «Блокирующие интеграционные разрывы» ниже: каждая требует follow-up спецификаций ДО реализации эталонного проекта (это не правки в данном PR).

**Gate Decision**: Все gates PASS с 6 задокументированными блокирующими правками (BIG-1..6), аддитивными к контрактам. Design proceeded to Phase 1: каноническая конфигурация и границы безопасного plan зафиксированы в разделах ниже; без реализации BIG в Phase A этап B физически не собирается.

### Addendum (после merge 025/026/027)

Все BIG-1..6 закрыты отдельными спецификациями, смёрджены в `dev` (время обновления «Reference layout»):

| BIG | Спека | PR → `dev` | Что вошло |
|-----|-------|------------|-----------|
| BIG-1 (value-threading) | 025 pilot-e2e-enablement | #25 (`dda15aa`) | `ArtifactDescriptor.value`, `DispatchOptions.artifacts`, `materializerOutputs` |
| BIG-2 (`ycforge:*`-ключи) | 025 pilot-e2e-enablement | #25 (`dda15aa`) | artifact-типы в builders-реестре |
| BIG-3 (`composer/builder`) | 026 composer-builder | #26 (`8aef559`) | subpath `@ycforge/composer/builder` |
| BIG-4 (диалект apps.yaml) | 026 composer-builder | #26 (`8aef559`) | builder потребляет C-модель map-form |
| BIG-5 (docker без push) | 027 docker-no-push | #27 (`c7014ac`) | `image.no_push: true`, локальный digest, `BLC_*` fail-fast |
| BIG-6 (suspicious-keys) | 025 pilot-e2e-enablement | #25 (`dda15aa`) | категория в `ycsf check` |

BIG-6 закрыт до реализации 024: ссылка на «явный тест до правки pilot» в Constitution V выше устарела — категория уже в pilot. Эталонный проект использует закрытые gaps и фиксирует их golden-файлами. Примеры конфигов ниже уже приведены к закрытым BIG (app map-form B уже принимает; `ycsf check` выдаёт suspicious-предупреждения; docker-контейнер analytics собирается с `no_push: true`).

## Блокирующие интеграционные разрывы (BIG-1..BIG-6)

Каждый разрыв: **Evidence** (проверено в источнике), **Impact** (что сломается в reference), **Required amendment** (формулировка follow-up правки). Все — аддитивные; правки оформляются как отдельные спецификации (номера не переиспользуемы) и НЕ входят в этот PR.

### BIG-1 — materialize-шаги C не получают значения built-артефактов
- **Evidence**: `packages/pilot/src/materialize/materialize.ts:53` конструирует `ArtifactDescriptor = { id, name, type }` — **без `value`**; `packages/pilot/src/cli/pipeline.ts:141-164` (`runBuildAndMaterialize`) вызывает `buildApps` (артефакты кладутся в `.ycsf/artifacts/<app>/`, cache `content-addressed`) и затем `runMaterializeGeneration(projectModel, registry)` — built-значения **не передаются**; `runMaterializeGeneration` сверху вызывает `dispatch(projectModel, registry)` (`pipeline.ts:45`). Реальные materializers-core require `artifact.value` (yandex-function `value.archivePath`/`entryPoint`, container `value.image`, storage-bucket `value.directory`, api-gateway `value.specPath`/`resourceReferences`) и падают с `YMT_INVALID_ARTIFACT_VALUE` при `undefined` (проверено: fixture-materializers игнорируют value, поэтому unit-тесты проходят только на них).
- **Sub-gap BIG-1b**: `pipeline.ts:102` передаёт `materializerOutputs: new Map()` — декларации `OutputBuilder.declare` (`<app>_function_id`, `<app>_container_id`, `<app>_bucket_id`, `<app>_gateway_id`) из реальных materializers **выбрасываются** в CLI-пайплайне; dispatcher `dispatch.ts:69` консистентно проверяет только collisions. Итог: `99-ycsf-outputs.tf.json` в текущем CLI содержит только user-outputs из `.ycsf/outputs.yaml`, auto-outputs отсутствуют.
- **Sub-gap BIG-1c**: api-gateway materializer пишет companion-файл в `resolve(process.cwd(), 'generated')` (`yandex-api-gateway/index.ts:28-31`) и ссылается на `file("${path.module}/generated/<name>-openapi.yaml")` — срабатывает корректно, только если cwd == `infra/`.
- **Impact**: без BIG-1 реальные materializers не работают через `ycsf plan`/`ycsf materialize`; эталонный e2e падает на стадии materialize.
- **Required amendment** (follow-up, pilot, аддитивно): threading значений built-артефактов в `dispatch`/`materializeAll` (новая опция `DispatchOptions.artifactValues: Map<appId, ArtifactValue>` + включение `value` в descriptor), сбор `materializerOutputs` из общего `OutputBuilder` в `buildOutputs` (`materializerOutputs` из `pipeline.ts:102`), и закрепление cwd=`infra/` для стадии materialize (или перенос companion в generated-files pipeline). Контрактные типы `contracts/materializer.ts`/`artifact.ts` не ломаются — поле `value` уже присутствует в materializers-core-репликах.

### BIG-2 — реестр builders не принимает artifact-типы (`ycforge:*`)
- **Evidence**: `registry/builders-yaml.ts` `KEY_RE = /^[\w-]+$/` — двоеточие запрещено; `registry/validate.ts` `BRG_UNKNOWN_BUILDER` требует `app.builder ∈ builders-map keys`; при этом реальные materializers сечётятся по `artifact.type == 'ycforge:function'` и т.д. (`materialize/select.ts` вызывает `supports`), а `type` берётся из `app.builder` (`materialize.ts:52`). Итого для реального e2e `app.builder` ОБЯЗАН быть artifact-типом, а реестр такие ключи не принимает.
- **Impact**: канонический `apps.yaml`/`builders.yaml` (см. ниже) не проходит валидацию реестра; build невозможен.
- **Required amendment** (follow-up, pilot, аддитивно): KEY_RE для **builders-map** → `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` (совпадает с `ARTIFACT_TYPE_PATTERN` из `contracts/artifact-type.ts`); materializers-map остаётся на семантических ключах (`yandex-function`, …) — их ключи в selection не участвуют.

### BIG-3 — `@ycforge/composer` не экспортирует Builder-модуль
- **Evidence**: `packages/composer/package.json` — exports только `"."`, bin `ycsf-api`, никакого `./builder`; Dependency map C для artifact `ycforge:api-gateway` не может указать builder-пакет. Композитор умеет компилировать openapi (`cli/compile.ts`, env `SERVERLESS_TOOLS_OPENAPI_BUILD=1`, `openapi_entry` из `build_config.yaml`) — но только как CLI-подпроцесс, не как Builder.
- **Impact**: приложение `openapi` не имеет builder'а в проекте C → dispatch/`selectArtifacts` не увидит artifact `ycforge:api-gateway`, gateway-файл не генерируется.
- **Required amendment** (follow-up, composer, аддитивно): new export `@ycforge/composer/builder` — объект с методом `build()`, возвращающий `{ type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }`; specPath указывает на скомпилированный файл (в `.ycsf/artifacts/openapi/`), `resourceReferences` строятся из C-модели проекта (см. ref-грамматику `ref-resolver.ts`: `${resources.<type>.<name>.id}` → `${<terraformType>.<name>.id}`). Source of truth C-модели (apps.yaml map-form, не B-dialect) — принцип решения R-3.

### BIG-4 — конфликт диалектов `.ycsf/apps.yaml` (C map-form vs B array-form)
- **Evidence**: pilot читает map-form (`model/loader.ts` + fixture `packages/pilot/test/check/fixtures/canonical/.ycsf/apps.yaml` — `apps: { user_service: { source_path, builder } }`); composer отдельно парсит array-form (`composer/src/cli/load-config.ts`, fixture `packages/composer/test/fixtures/cli-pass/.ycsf/apps.yaml` — `apps: [{ id, name, builder: 'yandex-api-gateway', path }]`). Один файл не может быть одновременно валиден обоими.
- **Impact**: даже после BIG-3, C-сборка openapi и независимый composer-парс конфликтуют на одном файле.
- **Required amendment** (follow-up, composer, addendum): composer builder перестаёт парсить свой `.ycsf/apps.yaml` и получает проектную модель от C (модель уже загружена в C до dispatch); `openapi_entry` читается из `build_config.yaml` приложения (как сейчас в CLI-шаге). Эталонный проект описывает единый source of truth — map-form.

### BIG-5 — docker-builder всегда push (FR-020 требует сборки без push)
- **Evidence**: `packages/builders-core/src/docker/index.ts` выполняет `buildAndPush` + resolve digest через registry; опции no-push нет; контракт `DockerArtifactValue.image` = `"<repository>@sha256:<hex>"` «never a mutable tag» (`materializers-core/src/types.ts:66-68`). На среде без running docker-демона (проверено: daemon недоступен) эталонный этап не выполнить вовсе.
- **Impact**: без правки эталонный `analytics` выполняет сетевой push (нарушение FR-020 «без push»); с падающим daemon — FR-020 недоказуем.
- **Required amendment** (follow-up, builders-core, аддитивно): опция `image.no_push: true` — локальная `docker build` + digest из локального inspect (`docker image inspect --format '{{index .RepoDigests 0}}'`). В среде с демоном эталон собирает `analytics` без push; сценарий «docker absent» документируется как fail-fast с явным сообщением, а не молча.

### BIG-6 — в текущем `ycsf check` нет категории suspicious-ключей
- **Evidence**: `packages/pilot/src/contracts/check.ts` — категории C1/C4/C7/C13 (`YCK_MISSING_TARGET`, `YCK_REF_UNRESOLVED`, `YCK_ENV_IN_PATCH`, `YCK_TERRAFORM_INVALID`/`_UNAVAILABLE`); поиск `SECRET|TOKEN|PASSWORD` в pilot/builders-core не даёт реализованной категории (пробел спецификации 020 относительно FR-015 spec 024).
- **Impact**: упомянутый в FR-015 детектор «suspicious build_env» в эталонном прогоне молча не сработает.
- **Required amendment** (двойной путь): (а) эталонный проект сразу получает свой репозиторный secret-scan (FR-023 тест: скан всех commited файлов на паттерны ключей; RED при фикстуре с `SECRET`-значением) — это входит в этот PR и не блокируется; (б) follow-up pilot-категория `YCK_SUSPICIOUS_KEY` — записывается как правка, чтобы `ycsf check` консистентно покрыл FR-015.

## Project Structure

### Documentation (this feature)

```text
specs/024-e2e-reference/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (R-1..R-N; границы plan, интеграционные разрывы BIG-1..6 с доказательствами)
├── data-model.md        # Phase 1 output (канонический конфиг .ycsf/*, формы build_config, layout)
├── quickstart.md        # Phase 1 output (пошаговый сценарий Sc1..ScN от clone до terraform plan)
├── contracts/           # Phase 1 output
│   └── reference-project.json  # fixture-схема: ожидаемые .tf.json ресурсы + golden-контракт
├── artifacts/           # (не коммитить: создаётся build'ом)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
examples/reference-project/
├── package.json                  # @ycforge/reference-project (FR-001), private, scripts: plan/check/test
├── README.md                     # Russian: назначение, границы (без push/apply/секретов), пошаговый запуск
├── .env.example                  # документирует ОПЦИОНАЛЬНЫЕ YC_TOKEN/SERVICE_ACCOUNT_KEY_FILE (не .env!)
├── tsconfig.json                 # strict, только для тестов эталона
├── vitest.config.ts              # include test/**/*.spec.ts, без сети
├── .ycsf/
│   ├── apps.yaml                 # version: 1, MAP-form; builder = artifact-type (BIG-2)
│   ├── builders.yaml             # version: 1, builders keys ycforge:* → подпакеты; materializers → yandex-*
│   ├── extensions.yaml           # version: 1, patch функций/gateway (только IDL functions.*/gateways.*)
│   └── outputs.yaml              # version: 1, user outputs через IDL (functions.*/gateways.*)
├── apps/
│   ├── user_service/             # NestJS-функция (ycforge:function)
│   │   ├── build_config.yaml     # entry/out_filename; build_env: {} (без {{$ENV}})
│   │   ├── package.json          # @nestjs/*, @ycforge/nestjs-connector, esbuild-зависимости билдера
│   │   ├── tsconfig.json
│   │   └── src/main.ts           # createYandexHandler(AppModule)
│   ├── analytics/                # Docker-контейнер (ycforge:docker-image)
│   │   ├── build_config.yaml     # image.repository локальный; image.no_push: true (BIG-5)
│   │   ├── Dockerfile            # nodejs22, nginx/экспозиция
│   │   ├── package.json
│   │   └── src/index.ts
│   ├── frontend/                 # статика (ycforge:frontend)
│   │   ├── build_config.yaml     # out_dir: dist, root: ., command: vite build
│   │   │                         # build_env — ТОЛЬКО публичные VITE_* литералы
│   │   ├── package.json          # vite devDep
│   │   ├── index.html
│   │   └── src/…                 # статика (минимальная, 2-3 файла)
│   └── openapi/                  # API Gateway (ycforge:api-gateway, producer: composer)
│       ├── build_config.yaml     # openapi_entry: openapi.yaml
│       └── openapi.yaml          # spec: routes user_service/analytics со ссылками ${resources.<type>.<name>.id}
└── infra/
    ├── main.tf                   # USER-owned: terraform{} + required_providers yandex-cloud/yandex + provider "yandex" {}
    ├── .terraform.lock.hcl       # коммитится (FR-014); обновляется terraform init
    └── *.ycsf.tf.json            # C-generated (не в исходниках: golden-фикстуры в test/, файлы генерирует pipeline)
test/
├── plan.spec.ts                  # US-проверки: единая команда plan = 6 шагов, граница БЕЗ сети
├── golden.spec.ts                # byte-for-byte: файлы .ycsf.tf.json + 99-ycsf-outputs.tf.json против фикстур
├── secret-scan.spec.ts           # FR-023: 0 секретов в commited tree; RED на SECRET-фикстуре
├── check-boundary.spec.ts        # characterization: вывод terraform init/validate/plan без кред (no Yandex)
└── ycsf-model.spec.ts            # самописная валидация: apps/builders/extensions/outputs проходят load без диагностик
```

**Structure Decision**: эталонный проект — обычный example (не пакет с публичным API): весь публичный контракт — это `.ycsf/*.yaml` + `apps/*` + `infra/main.tf`; C-владение см. `IDEA.md` §30/§36-§37. Голден-файлы сгенерированных `.tf.json` хранятся в `test/fixtures/` (как в pilot `GOLDEN_USER_SERVICE_TF_JSON`), а не в `infra/` (infra — результат работы pipeline). Layout приложений зеркалит convention-интеграции composer (`test/fixtures/app-convention`).

### Канонические конфигурации (data-model, известное состояние)

`.ycsf/apps.yaml` (BIG-2: ключи builder — artifact-типы):
```yaml
version: 1
apps:
  user_service:
    source_path: apps/user_service
    builder: ycforge:function
    depends_on: []
  analytics:
    source_path: apps/analytics
    builder: ycforge:docker-image
    depends_on: []
  frontend:
    source_path: apps/frontend
    builder: ycforge:frontend
    depends_on: []
  openapi:
    source_path: apps/openapi
    builder: ycforge:api-gateway
    depends_on: [analytics, frontend, user_service]
```

`.ycsf/builders.yaml` (BIG-2 для builders; materializers-ключи остаются семантическими):
```yaml
version: 1
builders:
  ycforge:function: "@ycforge/builders-core/nestjs-function"
  ycforge:docker-image: "@ycforge/builders-core/docker"
  ycforge:frontend: "@ycforge/builders-core/vite"
  ycforge:api-gateway: "@ycforge/composer/builder"   # BIG-3
materializers:
  yandex-function: "@ycforge/materializers-core/yandex-function"
  yandex-serverless-container: "@ycforge/materializers-core/yandex-serverless-container"
  yandex-storage-bucket: "@ycforge/materializers-core/yandex-storage-bucket"
  yandex-api-gateway: "@ycforge/materializers-core/yandex-api-gateway"
```

`.ycsf/outputs.yaml` (IDL-адресуемы только `functions.*`/`gateways.*` — см. `extensions/idl.ts`; containers/buckets НЕ адресуемы — задокументировано):
```yaml
# Ключи НЕ пересекаются с auto-outputs materializers (`<app>_function_id`/`_container_id`/
# `_bucket_id`/`_gateway_id`, spec 025): коллизия → OUT_DUPLICATE_NAME (outputs/build.ts:89).
version: 1
outputs:
  user_service_id:
    value: functions.user_service
    description: "Yandex Function id (user service)"
  gateway_id:
    value: gateways.openapi
    description: "API Gateway id (front entry)"
```

`infra/main.tf` (user-owned; C его не читает/пишет):
```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.145.0"
    }
  }
}

provider "yandex" {}
```

Ожидаемые C-generated файлы (golden-контракт): `infra/user_service.ycsf.tf.json` (`yandex_function.user_service` с `runtime=nodejs22`, `user_hash=<sha256 архива>`, `content.zip_filename`), `infra/analytics.ycsf.tf.json` (`yandex_serverless_container.analytics` c `image="<repo>@sha256:…"`, `name`), `infra/frontend.ycsf.tf.json` (`yandex_storage_bucket.frontend` + `yandex_storage_object` per file, `acl=public-read`), `infra/openapi.ycsf.tf.json` (`yandex_api_gateway.openapi` c `spec=file("${path.module}/generated/openapi-openapi.yaml")` + companion в `infra/generated/openapi-openapi.yaml`), `infra/99-ycsf-outputs.tf.json` (user outputs + auto `<app>_*_id` после BIG-1b).

## Pipeline и границы безопасного plan (FR-019)

Эмпирически проверено на этой машине (terraform v1.15.8, darwin/arm64; провайдер `yandex-cloud/yandex` ~0.145.0, скачан через registry.terraform.io — **единственная** сетевая зависимость инструментного стека, не Yandex Cloud):

1. `terraform init` — проходит без каких-либо креденшелов (скачивает провайдер, пишет `.terraform.lock.hcl`).
2. `terraform validate` — оффлайн, проходит; **ловит неполноту конфигурации** (эмпирично: `Missing required argument ... "user_hash"`), т.е. гейт работоспособен без облака.
3. `terraform plan` **без** `YC_TOKEN`/`SERVICE_ACCOUNT_KEY_FILE` — останавливается ДО обращения к Yandex API на стадии конфигурации провайдера: `one of 'token' or 'service_account_key_file' should be specified`. Никакого сетевого обращения к облаку до этой точки.

Отсюда граница оценки (wording для README/тестов): *«ycsf check/build/materialize и terraform validate работают локально и оффлайн; terraform init обращается только к registry.terraform.io; terraform plan без credentials гарантированно завершает fail с диагностикой конфигурации провайдера до какого-либо вызова Yandex Cloud. Docker-registry (push) не выполняется вовсе (BIG-5 no_push; digest — локальный).»*

Единая команда эталонного проекта (`package.json`):
```json
"scripts": {
  "plan": "ycsf check && ycsf build && ycsf materialize && terraform init && terraform validate && terraform plan",
  "check": "ycsf check --validate-tf",
  "test": "vitest run"
}
```
`ycsf plan` (pilot) существует, но эталонный скрипт композирует шаги явно: `ycsf plan` не гонит `check` и `validate` (проверено в `cli/terraform.ts` TF_ARGS и `cli/plan.ts`).

## Strategy верификации (тесты и golden-файлы)

- **Golden трубы** (`test/golden.spec.ts`): запуск полноценного `ycsf check && build && materialize` на каноническом проекте в temp-dir; байт-в-байт сравнение каждого `*.ycsf.tf.json` и `99-ycsf-outputs.tf.json` с зафиксированными фикстурами (детерминизм: `serializeJson` сортирует ключи, `user_hash` — детерминированный sha256 архива, `sanitizeFilename` — стабильный).
- **Характеризация Terraform-границ** (`test/check-boundary.spec.ts`): `terraform validate` в `infra/` после генерации — 0-диагностик; `terraform plan` без кред — ожидаемый fail с текстом провайдер-конфигурации и **нулевым** обращением к Yandex (присутствие текста ошибки фиксируется, выходной код ≠ 0; docker-демон не требуется — эталон не вызывает docker в бесплатном пути).
- **Секрет-скан** (`test/secret-scan.spec.ts`, FR-023): сканирование всего дерева эталона (кроме `.terraform/`) на паттерны `SECRET|TOKEN|PASSWORD|PRIVATE KEY` и `{{$ENV}}`-литералы; RED-фикстура с `SECRET_BUILD_ENV_KEY` обязана провалить тест (покрывает BIG-6 до правки pilot).
- **Модельный sanity** (`test/ycsf-model.spec.ts`): загрузка `.ycsf/*` через публичную валидацию (0 diagnostics), `typecheck` билдеров/тестов эталона (`tsc --noEmit`) — без сети.

## Complexity Tracking

> No constitution violations introduced — all gates pass. Эталонный проект — конституционно требуемый пример (канонический reference в его отсутствие = несуществующий контур проверки e2e на реальных пакетах); все 6 правок BIG — аддитивные follow-up specs, не размывающие границы A/B/C/Terraform.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|-------------------------------------|
| — | — | — |

## Artifacts to review (Phase 0/1)

- [research.md](./research.md) — R-1..R-N: доказательства BIG-1..6 (file:line), эмпирика границ terraform-провайдера, грамматика resource-ссылок `ref-resolver.ts`, canonical-config формы.
- [data-model.md](./data-model.md) — канонические `.ycsf/*` + `build_config` формы (приведённые выше), golden-контракт `.tf.json` ресурсов, layout каталогов.
- [contracts/reference-project.json](./contracts/reference-project.json) — схемы ожидаемых сгенерированных ресурсов (для byte-for-byte-фикстур) и boundary-контракт plan без креденшелов.
- [quickstart.md](./quickstart.md) — пошаговый сценарий от clone до `terraform plan` с явными ожидаемыми выходами на каждом гейте.