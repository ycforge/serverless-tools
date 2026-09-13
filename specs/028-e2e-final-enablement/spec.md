# Spec 028: e2e-final-enablement — пять фиксов тулчейна, финальная готовность reference-проекта 024

| | |
|---|---|
| Spec ID | 028 |
| Название | e2e-final-enablement |
| Feature branch | `028-e2e-final-enablement` (от `dev`) |
| Status | 🚧 In progress |
| Created | 2026-09-13 |
| Inputs | пять Fix-областей (решение владельца фичи от 2026-09-13, binding) + `specs/024-e2e-reference/research.md` (эмпирические пробы T001–T006, 2026-09-13) + `specs/024-e2e-reference/spec.md` (FR-010/FR-011/FR-018/FR-019, непереисполнимые на фиксированном тулчейне) |
| Dependencies | 024 (spec-вход: FR-010/011/018/019 + research.md), 025 (🚧 — values через materialize, artifact-типы в реестре, suspicious-keys), 026 (🚧 — `@ycforge/composer/builder`), 027 (🚧 — docker `no_push`, инвариант «never a mutable tag») |
| IDEA.md | §15–19 (resource references, IDL/IDT), §21 (builder registry), §22–24 (dispatch/materialize), §26 (auto-outputs), §30 (pipeline), §37 (serverless containers / docker) |
| Packages | `packages/composer` (B), `packages/pilot` (C), `packages/materializers-core` (019), `packages/builders-core` (018/027) |
| Consumes contract | `@ycforge/pilot/contracts` (все пять фиксов — только additive, Constitution III) |

## 1. Проблема и цель

Reference-проект spec 024 не может пройти конвейер check → build → materialize → terraform init → validate → plan **на фиксированном тулчейне** (`packages/*` не менялись). Эмпирический отчёт `specs/024-e2e-reference/research.md` (2026-09-13, пробы T001–T006; окружение: node 22.22.3, pnpm, Terraform v1.15.8 darwin/arm64, docker CLI 29.5.2 при неработающем daemon) доказал пять разрывов — они и есть пять Fix-областей этой спеки:

1. **Fix-1 — Composer refs против app-модели.** `${resources.functions.user_service.id}` в единственном bearer-поле составления открывает `RESOURCE_REF_NOT_DECLARED`, потому что индекс построен только из `.ycsf/resources.yaml`, а объявление app-identity в resources.yaml запрещено `PML_IDENTITY_COLLISION` (T002). ФР-010 спеки 024 («ссылки на apps, не на resources») непереисполнима.
2. **Fix-2 — Standalone `ycsf materialize`.** Самостоятельный материалize без значения артефактов падает `MTL_MATERIALIZE_FAILED: Cannot destructure property 'specPath' of 'value' as it is undefined` (T003); threading значений живёт только внутри `ycsf plan`. Шести-шаговый скрипт 024 FR-011 (check && build && materialize && init && validate && plan) как написан — неработоспособен.
3. **Fix-3 — Required YC attrs + companion path.** Материализованный config yandex_function (нет `name`/`memory`) и yandex_api_gateway (только `spec`) не проходит `terraform validate`/`plan` — `Missing required argument name` (T005). Companion-файл api-gateway пишется в `resolve(process.cwd(),'generated')`, а не в `infra/generated` (T003) — каноничный entrypoint зависит от cwd.
4. **Fix-4 — Docker dev-modes.** На машине без docker daemon сборка `ycforge:docker-image` падает `BLC_BUILD_FAILED` c «failed to connect to the docker API at unix://…/docker.sock» (T006) — нет режима потребления уже опубликованного immutable-образа и нет построения на remote-host; диагностика не подсказывает выход.
5. **Fix-5 — Pilot registry.** (a) `@ycforge/composer/builder` резолвится реестром как `BRG_PACKAGE_NOT_FOUND` — pilot импортирует по имени из собственного dist и не имеет composer-зависимости (T001); (b) тот же `ycforge:*`-ключ нельзя объявить в `builders:` и `materializers:` одновременно — `BRG_KEY_COLLISION` (T001). Блокер T009 (build_config wiring) и A-3 спеки 026.

**Цель.** Тулчейн становится способным собрать 024: каждый из четырёх блокеров research.md (пункты 1–4 «Сводки блокеров») и оба registry-разрыва (пункт 5) закрываются аддитивными фиксами в `packages/*`, без изменения семантики замороженных контрактов (Constitution III). Наблюдаемый итог — эталонный проект 024 собирается по шести шагам до `terraform validate` (0 структурных ошибок) и `terraform plan` (в границе FR-019) без облачных креденшалов и локального docker daemon.

Это НЕ создание reference-проекта (зона 024) и НЕ новый пользовательский сценарий A/B/C: 028 чинит то, что research.md доказал против фиксированных пакетов.

## 2. Метрика успеха (measurable)

- **SC-001** (Fix-1). В reference-проекте 024 app `openapi` (composer builder) компилируется со ссылками `${resources.functions.user_service.id}`, `${resources.buckets.frontend.name}`, `${resources.containers.analytics.id}` **без** `.ycsf/resources.yaml`: 0 ошибок `RESOURCE_REF_*`; `resourceReferences` содержит ровно ожидаемые записи `{ logical, terraformType }` (`yandex_function`, `yandex_storage_bucket`, `yandex_serverless_container`); auth-ref `functions.user_service` из auth.yaml резолвится.
- **SC-002** (Fix-2). `ycsf build` && `ycsf materialize` (standalone) продуцируют побайтово идентичный набор `infra/*.tf.json` (включая `99-ycsf-outputs.tf.json`) тому, что даёт integrated `ycsf plan` материалize на тех же исходниках; шести-шаговый скрипт 024 FR-011 выполняется до validate без падения materialize-стадии.
- **SC-003** (Fix-3). `terraform validate` на материализованных `yandex_function.*` и `yandex_api_gateway.*` даёт 0 «Missing required argument»; companion-файл `<name>-openapi.yaml` лежит в `<rootDir>/infra/generated/` независимо от cwd запуска; resource addresses соответствуют замороженной таблице D-4 спеки 024.
- **SC-004** (Fix-4). `registry-ref`-режим собирает `ycforge:docker-image` на машине без docker daemon без единого subprocess `docker`; default-режим на недостижимом daemon даёт стабильную actionable `BLC_*`-диагностику (без тихого пропуска); `no_push` (027) работает во всех режимах.
- **SC-005** (Fix-5). `builders.yaml` с `builders: { ycforge:api-gateway: '@ycforge/composer/builder' }` и `materializers: { ycforge:api-gateway: '@ycforge/materializers-core' }` валиден (нет `BRG_KEY_COLLISION` между секциями); `@ycforge/composer/builder` резолвится из dependency graph проекта (workspace subpath), 0 `BRG_PACKAGE_NOT_FOUND`.
- **SC-006** (additivity). Тип-тесты (test-d) легитимируют аддитивность: ни один существующий публичный тип/константа/код не изменён; `BRG_KEY_COLLISION` и `RESOURCE_REF_NOT_DECLARED` сохранены frozen (superseded-комментарии для семантических relaxation); существующие тест-сеты pilot/composer/builders-core/materializers-core зелёные без правок (кроме goldens, затронутых Fix-3 — см. §13).
- **SC-007** (determinism). Повторный прогон на неизменённых исходниках даёт побайтово идентичные `infra/*.tf.json` (вкл. новые attributes Fix-3 и per-app дескрипторы Fix-2); golden-эталоны обновлены ровно в точках эмиссии Fix-3 и закоммичены.
- **SC-008** (unblock). FR-010/FR-011/FR-018/FR-019 спеки 024 становятся исполнимыми на фиксированной конфигурации reference-проекта: каждая из четырёх FR-строк проверена прогоном на 024 (buildable без packages-правок сверх 028).

## 3. Исследование (проверено по коду на 2026-09-13)

### Fix-1 — Composer refs против app-модели

| Утверждение | Доказательство |
|---|---|
| Индекс резолвинга строится ТОЛЬКО из `resources.yaml` | `packages/composer/src/compile-core.ts:64` — `buildResourceIndex(projectRoot)`; `:114` — `resolveReferences(document, envMapping, REFERENCE_BEARER_FIELDS, index)` |
| Отсутствие записи в индексе → `RESOURCE_REF_NOT_DECLARED` | `packages/composer/src/resource/reference-resolver.ts:69-77` (`:72` — `resource not declared`) |
| Объявление app-identity в resources.yaml запрещено | `packages/pilot/src/model/resources.ts:84-96` — `checkIdentityCollision` → `PML_IDENTITY_COLLISION` (functions-домен), вызывается из `model/loader.ts:90` на любом командном пути |
| Ссылка в не-bearer поле остаётся в артефакте сырой → интерполяционная ошибка TF | research T002 (проба C): сбор ссылок — только `REFERENCE_BEARER_FIELDS` (`resource/refs/template.ts`); замена в materializer — только по `value.resourceReferences` (`materializers-core/src/yandex-api-gateway/ref-resolver.ts`) |
| Domain known-set и IDT-таблица совпадают с потребителем | `packages/composer/src/builder/artifact.ts:28-35` — `RESOURCE_DOMAIN_TERRAFORM_TYPES`: functions→`yandex_function`, queues→`yandex_message_queue`, buckets→`yandex_storage_bucket`, containers→`yandex_serverless_container`, gateways→`yandex_api_gateway`; домены — `resource/types.ts:1` (`ResourceDomain`) |
| Контрактные типы артефактов, из которых выводится domain | `packages/materializers-core/src/types.ts:59-87` (`FunctionArtifactValue`, `DockerArtifactValue`, `FrontendArtifactValue`, `ApiGatewayArtifactValue`) |
| 026 не читает apps.yaml (вход identity должен прийти от C аддитивно) | `specs/026-composer-builder/spec.md` FR-005/D-2 (binding): Builder НЕ парсит `.ycsf/apps.yaml`; модель — из `BuildContext` |

**Вариативность Fix-1**: domain выводится из artifact type (`ycforge:function`→`functions`, `ycforge:docker-image`→`containers`, `ycforge:frontend`→`buckets`, `ycforge:api-gateway`→`gateways`); app-identities добавляются в индекс как ref-entries со свойствами домена (functions/gateways/containers: `id`, buckets: `name`, queues: `qurl` — `resource/types.ts:18-24`). Канонический home маппинга — открытый вопрос (§14 OQ-2). Transport identity в composer — добавка C-модели (D-6), не перечитывание apps.yaml.

### Fix-2 — Standalone `ycsf materialize`

| Утверждение | Доказательство |
|---|---|
| Standalone materialize не передаёт artifacts | `packages/pilot/src/cli/materialize.ts:110-111` — `runMaterializeGeneration(rootDir, model, registry, genOpts)` без 5-го параметра |
| Механизм проброса values есть только в pipeline | `packages/pilot/src/cli/pipeline.ts:171-178` — `appArtifacts` из `buildResult.artifacts` строится только в `runBuildAndMaterialize`; `:41-56` — `runMaterializeGeneration` уже принимает `artifacts?` → dispatch |
| Materializer deref'ит `artifact.value` напрямую | `packages/materializers-core/src/yandex-api-gateway/index.ts:13-17` (`value.specPath`), `yandex-function/index.ts:12-16` (`value.archivePath`) → `YMT_INVALID_ARTIFACT_VALUE` / TypeError при отсутствии |
| Store после `ycsf build` | `packages/pilot/src/build/index.ts:273` — `outputDir = '<root>/.ycsf/artifacts/<appId>'`; `packages/pilot/src/cache/blobs.ts:21-45` — blob = `artifact.json` `{type, value}` + копия файлов; `cache/manifest.ts` — manifest `version: 1`; `.gitignore:44-45` — `.ycsf/artifacts/` и `.ycsf/cache/` не коммитятся |
| Эмпирика | research T003: standalone materialize → `MTL_MATERIALIZE_FAILED: Cannot destructure property 'specPath' of 'value' as it is undefined`; канонический 6-шаговый скрипт (plan.md:244-252) неработоспособен |
| Прежняя семантика | 025 US-5/D-2: standalone = «descriptor без value»; 028 расширяет поведение при наличии store (descriptor с value), legacy-путь сохраняется |

### Fix-3 — Required YC attrs + companion path

| Утверждение | Доказательство |
|---|---|
| yandex_function: эмитится runtime/entrypoint/user_hash/content, нет `name`/`memory` | `packages/materializers-core/src/yandex-function/index.ts:30-42` |
| yandex_api_gateway: эмитится только `spec` | `packages/materializers-core/src/yandex-api-gateway/index.ts:33-40` |
| Companion — cwd-зависим | `packages/materializers-core/src/yandex-api-gateway/index.ts:28-31` — `resolve(process.cwd(), 'generated')`; `:38` — `file("${path.module}/generated/${name}-openapi.yaml")` |
| Terraform работает с cwd=infra | `packages/pilot/src/cli/terraform.ts:53` — `cwd: infraDir`; `cli/terraform.ts` оркестрация init/validate/plan |
| Эмпирика validate | research T005: `Missing required argument name` на yandex_api_gateway («openapi.ycsf.tf.json line 6») и yandex_function (кроме того `memory`); yandex_serverless_container и yandex_storage_bucket полны |
| Варт документально зафиксирован | 025 NG-3 / 026 NG-5 (coordination note): cwd-company — известный дефект materializers-core (019) |

### Fix-4 — Docker dev-modes

| Утверждение | Доказательство |
|---|---|
| Текущий поток build → buildAndPush → artifact | `packages/builders-core/src/docker/index.ts:15-23`; `cli.ts:58-115` (build → push/noPush → digest) |
| Конфиг: только repository/tag/no_push | `packages/builders-core/src/docker/config.ts:27-51` (`parseDockerConfig`); `types.ts:64-72` (`DockerBuildConfig`) |
| Диагностика daemon-недостижимости — через stderr build | `cli.ts:69-73` → `BLC_BUILD_FAILED` c `tailStderr`; research T006: `failed to connect to the docker API at unix://…/docker.sock … (BLC_BUILD_FAILED)`; `no_push` не пытается пушить |
| Семейство BLC_* | `packages/builders-core/src/diagnostics.ts:13-19` (`BLC_INVALID_CONFIG`, `BLC_BUILD_FAILED`, `BLC_IMAGE_DIGEST_UNAVAILABLE`, …) — const, аддитивно расширяемо |
| Инвариант image-string | `types.ts:47-49` + `materializers-core/src/types.ts:66-68` — «never a mutable tag»; 027 no_push в image-блоке |

**Вариативность Fix-4**: три режима — `registry-ref` (consume `<repository>@sha256:<hex>` без build/push/daemon), `remote` (build через удалённый Docker host), default (локальный daemon). Где живёт поверхность (per-app `build_config.yaml` image-блок vs project-level `.ycsf/project-config.yaml`) — открытый вопрос (§14 OQ-1): project-level потребовал бы НОВЫЙ versioned-формат (contract change), per-app image-блок аддитивен внутри существующего versionless-конфига (011) и C его не валидирует (pilot build passthrough, build/index.ts:277).

### Fix-5 — Pilot registry

| Утверждение | Доказательство |
|---|---|
| `await import(packageName)` из dist pilot | `packages/pilot/src/registry/load.ts:18`; `:37-39` — `ERR_MODULE_NOT_FOUND` → `BRG_PACKAGE_NOT_FOUND` (`:44-45`) |
| pilot не зависит от composer | `packages/pilot/package.json` — dependencies: только commander/yaml; composer container subpath добавил 026 (`packages/composer/package.json` — export `./builder`) |
| Cross-section коллизия — fail-fast | `packages/pilot/src/registry/builders-yaml.ts:119-126` — цикл по `Object.keys(builders)` ∩ `materializers` → `BRG_KEY_COLLISION`; семантика закреплена 025 FR-010/US-2-AC3 |
| Рабочий обход в scratch (подтверждает корень) | research T001: относительный путь `../../../composer/dist/builder/index.js` от `dist/cli/` сработал |

## 4. Non-goals (что НЕ делаем в 028)

| # | Тема | Почему не здесь | Куда |
|---|---|---|---|
| NG-1 | Создание/правки reference-проекта 024 (`examples/reference-project`) | 028 чинит тулчейн; 024 строит проект и его тесты поверх | 024 |
| NG-2 | Новые форматы `.ycsf/*.yaml` (никакой version bump сверх `version: 1`) | Конституция III; все поверхности 028 аддитивны внутри существующих форматов | — |
| NG-3 | Управление/запуск docker daemon | инфраструктура хост-окружения; 028 даёт диагностику и режимы, не «включает» daemon | docs |
| NG-4 | Собственный registry / pull-кэш / offline-дистрибуция слоёв | `registry-ref` — потребление уже опубликованного образа, а не построение registry | future |
| NG-5 | Реализация remote-docker build агента / setup ssh | используется штатный механизм удалённого Docker host (`DOCKER_HOST`/context); только поверхность конфигурации | future |
| NG-6 | Terraform provisioning, `ycsf apply`, push в registry | за пределами e2e enablement (024 останавливается до apply) | — |
| NG-7 | Изменение формата `image`-строки / mutable тегов | инвариант 018/019 «never a mutable tag» сохраняется во всех режимах Fix-4 | — |
| NG-8 | Переписывание value-threading 025 (pipeline.ts) | 028 стоит НА 025: продка `artifacts?` уже есть; меняется только источник значений для standalone | — |
| NG-9 | Правки остальных materializers (container/bucket) помимо required attrs + companion path | дефект не подтверждён research для них (T005: container/bucket полны) | — |
| NG-10 | Изменение legacy CLI-пути композиции (`ycsf-api compile`, array-form) | legacy остаётся ресурсно-индексным; Fix-1 адресует C-конвейер (builder), legacy fixtures не трогаем | — |

## 5. Домен и ключевые сущности

- **C-модель app-identities** — выведенные из `.ycsf/apps.yaml` (map-form C, spec 011) записи `(domain, app_id)`; domain получается из `app.builder` (artifact type) по маппингу Fix-1.
- **ResourceIndex (merged)** — индекс композиции: external-entries из `resources.yaml` + app-identities; единый источник для `resolveReferences` и `validateFunctionReferences` (auth).
- **artifact-type→domain map** — `ycforge:function`→`functions`, `ycforge:docker-image`→`containers`, `ycforge:frontend`→`buckets`, `ycforge:api-gateway`→`gateways` (additive; канонический home — open question).
- **Artifact store** — мандorator `ycsf build` записывает per-app артефакты в `<root>/.ycsf/artifacts/<appId>/` + дескриптор `{type, value}`; source для standalone `ycsf materialize`.
- **`ycsf materialize` standalone** — CLI-путь 021, потребляющий store (или `--artifacts <dir>`) и дающий byte-идентичный pipeline-выход.
- **Required YC attributes** — минимальный детерминированный набор полей provider-типов: yandex_function (`name`, `memory` — точный set open question), yandex_api_gateway (`name`); значения производны от стабильной app identity/констант.
- **Companion path** — `<rootDir>/infra/generated/<name>-openapi.yaml`, адресуемый `${path.module}/generated/...` из `.tf.json`; project-root-relative, cwd-независим.
- **Docker dev-modes** — `registry-ref` / `remote` / default в surface конфигурации `ycforge:docker-image`; `no_push` (027) совместим.
- **Registry resolution (consumer graph)** — резолюция `packageName` (включая subpath exports) из `node_modules`/workspace project root, а не из dist pilot.
- **Builder/Materializer key namespaces** — раздельные пространства имён секций `builders:` и `materializers:`; cross-section дубликат не ошибка.

## 6. User stories

### US-1 (P1) — Gateway ссылается на apps через `${resources.*}` без resources.yaml

Как разработчик reference-проекта 024, я хочу выражать связки gateway↔apps исключительно logical-синтаксисом `${resources.<type>.<app_id>.<property>}`, где `<app_id>` — имя из `.ycsf/apps.yaml`, чтобы FR-010 (ссылки на apps, не на resources) исполнялся без деклараций в resources.yaml.

Когда build app `openapi` через composer builder, а apps.yaml (map-form C) объявляет `user_service`, `analytics`, `frontend`:
- ресурсный индекс = resources.yaml (external) + app-identities (domain из artifact type);
- `${resources.functions.user_service.id}`, `${resources.buckets.frontend.name}`, `${resources.containers.analytics.id}` валидны и сохраняют каноническую форму в `specPath`;
- `resourceReferences` содержит записи `{ logical: 'functions.user_service', terraformType: 'yandex_function' }` и т.д. (IDT-таблица D-4);
- auth.yaml-ссылка `functions.user_service` резолвится без ручной декларации.
→ {US-1} АС: FR-001, FR-002, FR-003, FR-004, FR-005.

**Why this priority**: без Fix-1 ФР-010 спеки 024 эмпирически невыполнима (research T002); это блокер №1.

**Independent Test**: fixture map-form проекта (4 app) + builders.yaml с composer builder; композиция openapi app со ссылками на три другие; assert: выходной document и `resourceReferences`.

**Acceptance Scenarios**:

1. **Given** apps.yaml (map-form) с `user_service`, `analytics`, `frontend`, `openapi` и БЕЗ `.ycsf/resources.yaml`, **When** build app `openapi`, **Then** 0 `RESOURCE_REF_*`; `value.resourceReferences` содержит `functions.user_service`, `containers.analytics`, `buckets.frontend` с корректными `terraformType`.
2. **Given** auth.yaml открытой схемы с `function`-ссылкой на `functions.user_service`, **When** build, **Then** `validateFunctionReferences` проходит (нет «not declared in the composition functions set») — композиция не отклоняется.
3. **Given** ссылка на несуществующий app (`${resources.functions.ghost.id}`), **When** build, **Then** fail-fast `RESOURCE_REF_NOT_DECLARED` (семантика 009 сохранена).
4. **Given** в resources.yaml вдруг объявлен `functions.user_service` при существующем app-identity, **When** load модели (любой путь), **Then** `PML_IDENTITY_COLLISION` fail-fast (apps — единственный источник).

### US-2 (P1) — Standalone `ycsf materialize` после `ycsf build` (6-шаговый скрипт)

Как контрибьютор 024, я хочу запускать стадии отдельно (`ycsf check && ycsf build && ycsf materialize && terraform init && terraform validate && terraform plan`), чтобы скрипт из FR-011 работал как написан и каждая стадия была наблюдаема.

Когда `ycsf build` завершён успешно:
- per-app артефакты и дескрипторы `{type, value}` доступны в store (`<root>/.ycsf/artifacts/`);
- `ycsf materialize` подхватывает их (или `--artifacts <dir>`), прошивает `value` в descriptors и исполняет dispatch → extensions → moves → outputs → write;
- результат побайтово равен materialize-части `ycsf plan` на тех же исходниках.
→ {US-2} АС: FR-006, FR-007, FR-008, FR-009.

**Why this priority**: блокер №2 research.md; без него эталонный конвейер нельзя разбить на шаги для CI/отладки.

**Independent Test**: fixture-проект с реальными builders-core + materializers-core; `buildApps` → standalone `runMaterializeGeneration` с store; сравнение файлов byte-for-byte с `runBuildAndMaterialize`.

**Acceptance Scenarios**:

1. **Given** завершённый `ycsf build` на 4-app проекте, **When** выполнен `ycsf materialize`, **Then** генерируются все `infra/*.tf.json` (+ `99-ycsf-outputs.tf.json`) и каждый descriptor материализован с реальным `value` (нитей значений как в pipeline).
2. **Given** тот же проект, **When** выполнены `ycsf plan` и (после build) standalone `ycsf materialize`, **Then** сгенерированные файлы побайтово идентичны (SC-002).
3. **Given** store отсутствует и `--artifacts` не задан, **When** `ycsf materialize` на проекте с materializer'ами, требующими value, **Then** fail-fast с actionable диагностикой («запусти `ycsf build` / `--artifacts <dir>`»), а не `Cannot destructure property … of 'value' as it is undefined`.
4. **Given** fixture-проект с материализаторами, не требующими value (legacy 021), **When** `ycsf materialize` без store, **Then** поведение как раньше (descriptor без value, 0 регрессий).

### US-3 (P1) — terraform validate принимает материализованные function/gateway; companion рядом с инфраструктурой

Как пользователь `terraform validate`/`plan`, я хочу, чтобы сгенерированный `.tf.json` для функции и gateway содержал обязательные YC-атрибуты, а сопутствующий OpenAPI-файл лежал deterministically в `infra/generated`, чтобы не зависеть от текущего каталога.

Когда материализация yandex_function / yandex_api_gateway завершена:
- в configuration появляются обязательные атрибуты провайдера с детерминированными значениями (имя приложения → `name`, константы → остальные required);
- companion `<name>-openapi.yaml` пишется в `<rootDir>/infra/generated/`, и tf.json ссылается на `${path.module}/generated/…`;
- `terraform validate` — 0 структурных ошибок на generated-конфиге (присутствие креденшалов не требуется, T005).
→ {US-3} АС: FR-010, FR-011, FR-012, FR-013.

**Why this priority**: блокер №3 (validate), блокер №4 (companion/cwd); цепочка «validate→plan» не дойдёт до provider-границы иначе.

**Independent Test**: materialize fixture функции и gateway; golden `.tf.json`; `terraform validate -no-color` (characterization, Constitution II extraction для thin orchestration); прогон из корня и из подкаталога — одинаковое размещение companion.

**Acceptance Scenarios**:

1. **Given** проект с `user_service` (yandex-function), **When** materialized configuration проверяется `terraform validate`, **Then** 0 «Missing required argument» (включая `name`; `memory` — по решению plan, OQ-3).
2. **Given** проект с `openapi` (yandex-api-gateway), **When** materialized, **Then** configuration содержит `name`; companion существует в `<root>/infra/generated/<name>-openapi.yaml`; tf.json-ссылка `${path.module}/generated/<name>-openapi.yaml` валидна (файл на месте).
3. **Given** запуск из каталога, отличающегося от root (например `ycsf -p <root> materialize`), **When** materialized, **Then** companion размещается в root-relative месте, а не в `process.cwd()/generated`.
4. **Given** user `extensions.yaml` задаёт provider-поле поверх function/gateway, **When** применены extensions, **Then** базовый required-набор materializer'а + extensions deep-merge работают (IV), дубликата/маскирования нет.

### US-4 (P1) — Docker dev-modes: сборка на машине без daemon

Как разработчик на машине без работающего docker daemon (например darwin/arm64), я хочу потреблять уже опубликованный образ по immutable-дижесту или строить на удалённом хосте, а при default-режиме получать actionable диагностику, чтобы docker-стадия не блокировала локальный `terraform plan`.

Когда build app с `ycforge:docker-image`:
- `registry-ref`: builder возвращает `ycforge:docker-image` из заданного `<repository>@sha256:<hex>` БЕЗ вызова docker (daemon не требуется, креды не читаются);
- `remote`: build выполняется против удалённого Docker host штатным механизмом (DOCKER_HOST/context); digest — content-digest этого host;
- default: локальный daemon; при недостижимости — стабильная `BLC_*`-диагностика с направлением на registry-ref/remote/запуск daemon (без тихого пропуска и без «generic» ошибки).
→ {US-4} АС: FR-014, FR-015, FR-016, FR-017.

**Why this priority**: блокер №4; в текущем окружении автора даemon не запущен, и эталонная docker-ветка иначе непроходима (research T006).

**Independent Test**: fake-docker (`packages/builders-core/test/helpers/fake-bins.ts`) + журнал argv: в `registry-ref` — ни одного `docker`-вызова; в `remote` — корректный host-аргумент; в default-провале — код + текст диагностики.

**Acceptance Scenarios**:

1. **Given** конфигурация `registry-ref` (published immutable `<repository>@sha256:<64hex>`), **When** `build()`, **Then** artifact `{ type: 'ycforge:docker-image', value: { image: '<repository>@sha256:<64hex>' } }`; журнал argv пуст от docker; daemon не требуется.
2. **Given** конфигурация `remote` + недоступный локальный daemon, **When** `build()`, **Then** docker-команда исполняется с удалённым host (механизм plan/доки); digest — result удалённого host; локальный daemon не обязателен.
3. **Given** default-конфигурация (без режима) и недостижимый daemon, **When** `build()`, **Then** fail-fast с кодом `BLC_*` (аддитивно расширяемым, 027-совместимым) и текстом, явно направляющим на `registry-ref`/`remote`/запуск daemon; ни одного частичного артефакта.
4. **Given** конфигурация `registry-ref`, но ref не в форме `@sha256:<64hex>` (mutable tag), **When** `build()`, **Then** fail-fast `BLC_INVALID_CONFIG` (инвариант «never a mutable tag» охраняется).

### US-5 (P1) — Pilot registry: сабпать-резолюция и раздельные key namespaces

Как автор `.ycsf/builders.yaml` reference-проекта, я хочу объявлять `ycforge:api-gateway` одновременно в `builders:` (composer builder) и `materializers:` (yandex-api-gateway) и чтобы `@ycforge/composer/builder` резолвился из графа зависимостей проекта, чтобы явный маппинг 024 (T009 wiring) собирался без обходных путей.

Когда загружен registry проекта:
- `packageName` из секций резолвится с учётом subpath exports из dependency graph потребителя (workspace `@ycforge/composer/builder` достижим);
- ключи секций `builders` и `materializers` живут в раздельных namespaces: один и тот же ключ в обеих секциях — не ошибка;
- legacy-ключи (`user_service_builder`) и legacy-конфигурации работают без изменений.
→ {US-5} АС: FR-018, FR-019, FR-020.

**Why this priority**: блокер №5 (пункт 5 сводки research) — без него reference-проект не загружает composer builder, а семантика коллизии мешает каноничному маппингу.

**Independent Test**: интеграционный тест `loadRegistry(rootDir)` в workspace (монорепо) на builders.yaml с обоими `ycforge:api-gateway`; assert 0 `BRG_PACKAGE_NOT_FOUND`/`BRG_KEY_COLLISION`, запись `ycforge:api-gateway` есть в обоих store.

**Acceptance Scenarios**:

1. **Given** `builders: { ycforge:api-gateway: '@ycforge/composer/builder' }` в consumer-проекте workspace, **When** `loadRegistry(rootDir)`, **Then** модуль загружен (subpath export); 0 `BRG_PACKAGE_NOT_FOUND`; распознан как Builder.
2. **Given** `materializers: { ycforge:api-gateway: '@ycforge/materializers-core' }` параллельно с той же строкой в `builders:`, **When** парсинг builders.yaml, **Then** файл валиден; обоим key-пространствам присвоены разные записи; `BRG_KEY_COLLISION` не возникает.
3. **Given** legacy-ключ `user_service_builder` в `builders:`, **When** парсинг, **Then** поведение 013/025 без изменений (0 регрессий).
4. **Given** `packageName` не существует ни в графе потребителя, ни в workspace, **When** `loadRegistry`, **Then** fail-fast `BRG_PACKAGE_NOT_FOUND` с actionable сообщением (пакет не достижим из проекта).

### US-6 (P2) — 024 собирается на починенном тулчейне (сквозной прогон)

Как контрибьютор 024, я хочу, чтобы все пять фиксов вместе позволяли прогон всего конвейера reference-проекта с детерминированным результатом, чтобы 024 стал зелёным без дальнейших правок packages.

Когда 028 реализован и 024 использует его:
- `check → build → materialize → terraform init → terraform validate → terraform plan` проходят на эталонном проекте в границе FR-019 (план либо успешен, либо стоп ровно на provider-границе);
- сервисная повторимость: два прогона на чистом checkout дают байт-идентичные `infra/*.tf.json`.
→ {US-6} АС: FR-001, FR-006, FR-007, FR-010, FR-011, FR-013, FR-017, FR-018, FR-019 (traceability-свод).

**Why this priority**: интеграционное подтверждение, что фиксы не только unit-рабочи, но и совместно разблокируют FR-010/011/018/019.

**Independent Test**: полный прогон конвейера на канонической конфигурации reference-проекта (fixture 024), golden-сравнение `infra/*.tf.json`, characterization-локи terraform-стадий.

**Acceptance Scenarios**:

1. **Given** reference-конфигурация 024 (4 app, map-form, свой маппинг), **When** полный прогон, **Then** build/materialize/validate зелёные; plan — в границе FR-019.
2. **Given** две идентичные остановки на чистом checkout, **When** повторный прогон, **Then** `infra/*.tf.json` байтово идентичен (SC-007).
3. **Given** изменение одного приложения (например только `user_service`), **When** повторный прогон, **Then** инкрементальный кэш 022 переиспользует неизменённые артефакты; affected-инвалидация корректна.

## 7. Точные требования (Functional Requirements)

В скобках — привязка к fix-области и решению; нумерация собственная для этой спеки (не переиспользуется).

**Fix-1 — composer refs против app-модели**

- **FR-001**. Ресурсный индекс композиции включает app-identities C-модели: запись `(domain, app_id)` для каждого managed-приложения, чей `app.builder` — artifact type из маппинга FR-002; `${resources.<domain>.<app_id>.<property>}` валиден без декларации в `.ycsf/resources.yaml` (research T002, 024 FR-010 amendment). (US-1, US-6)
- **FR-002**. artifact-type→domain маппинг фиксируется: `ycforge:function`→`functions`, `ycforge:docker-image`→`containers`, `ycforge:frontend`→`buckets`, `ycforge:api-gateway`→`gateways`; свойства идентичности — доменные (`functions/containers/gateways: id`, `buckets: name`, `queues: qurl`, согласовано с `DOMAIN_PROPERTIES`). Канонический home — OQ-2; расширение новыми типами — аддитивно. (US-1)
- **FR-003**. Объединение индекса детерминировано и стабильно: entries из `.ycsf/resources.yaml` (external) + app-identities в фиксированном порядке (существующая сортировка 009 сохранена, app-identities — после или до по фиксированному правилу плана); коллизия (app_id == external resource id в том же домене) — fail-fast (`PML_IDENTITY_COLLISION` в C, согласованный `RESOURCE_REF_*`-семантика в B), никогда не merge (V/VI). (US-1)
- **FR-004**. Fail-fast синтаксис/домен/свойство сохраняются без изменений: `RESOURCE_REF_SYNTAX_INVALID`, `RESOURCE_REF_DOMAIN_UNKNOWN`, `RESOURCE_REF_PROPERTY_INVALID`, а `RESOURCE_REF_NOT_DECLARED` остаётся для имён, отсутствующих и в resources.yaml, и в app-identities (009 сохранён). (US-1-AC3)
- **FR-005**. Валидация функциональных auth-ссылок (`validateFunctionReferences`) резолвит app-identities так же, как ресурсные refs (research T002, «auth config function reference … is not declared»); reference `functions.<app_id>` в auth.yaml проходит без деклараций. (US-1-AC2)

**Fix-2 — standalone `ycsf materialize`**

- **FR-006**. `ycsf materialize` читает per-app артефакты из store после `ycsf build` (`<root>/.ycsf/artifacts/<appId>/`; контракт store — OQ-4) ИЛИ из явного `--artifacts <dir>`; прошивает `{type, value}` в descriptors (механизм 025 FR-002/FR-003 переиспользуется). (US-2, US-6)
- **FR-007**. Standalone materialize исполняет полную цепочку dispatch(с value) → extensions → moves → outputs → write и производит byte-идентичный набор `infra/*.tf.json` (вкл. `99-ycsf-outputs.tf.json`) integrated-materialize на тех же исходниках; идемпотентен (повторный прогон — тот же output). (SC-002, US-2-AC1/AC2)
- **FR-008**. При отсутствии store и без `--artifacts` поведение для materializer'ов, требующих value: документированный fail-fast `MTL_MATERIALIZE_FAILED`/`YMT_INVALID_ARTIFACT_VALUE` с actionable текстом (запусти `ycsf build` или передай `--artifacts`), без TypeError-destructure-сюрприза и без тихого каскада; fixture-materializers без value работают как раньше (legacy 025 US-5). (US-2-AC3/AC4)
- **FR-009**. Контракт store аддитивен: дескриптор `{type, value}` — JSON-сериализуем, содержит `version` (решение OQ-4); запись выполняется без изменения fingerprint-логики кэша 022 (stores не входят в filesHash; `.ycsf/artifacts/` и `.ycsf/cache/` не коммитятся, .gitignore:44-45). (US-2)

**Fix-3 — required YC attrs + companion path**

- **FR-010**. Материализатор `yandex-function` эмитит обязательные YC-атрибуты продуцируемых сервисов (research T005: `name`, `memory`) с детерминированными значениями из стабильной app identity/констант; точный минимальный набор — OQ-3; отсутствие атрибута → «Missing required argument» исключено. (US-3-AC1, SC-003)
- **FR-011**. Материализатор `yandex-api-gateway` эмитит обязательный `name`; companion-файл пишется в `<rootDir>/infra/generated/<name>-openapi.yaml`, ссылка в tf.json — `${path.module}/generated/<name>-openapi.yaml`; размещение project-root-relative и cwd-независимо (wart NG-3 025/026 устранён; research T003). (US-3-AC2/AC3, SC-003)
- **FR-012**. Авто-outputs (025, 019 `context.output.declare`) не изменяются: `<name>_function_id`, `<name>_gateway_id` и др. продолжают объявляться; новые attributes не конфликтуют с user-extensions (базовый set + extensions deep-merge, IV; дубликат не маскируется). (US-3-AC4)
- **FR-013**. `terraform validate` на материализованных function/gateway: 0 «Missing required argument» для всех продуцируемых типов; граница validate/plan без креденшалов — семантика 024 FR-019 (validate проходит оффлайн до provider-configure, T005). (SC-003, US-3)

**Fix-4 — docker dev-modes**

- **FR-014**. `DockerBuildConfig` получает аддитивную поверхность режимов `ycforge:docker-image`: `registry-ref` (consume `<repository>@sha256:<hex>`; build/push/daemon не вызываются; креды не читаются), `remote` (build через удалённый Docker host штатным mechanism), default (локальный daemon); `no_push` (027) совместим во всех режимах; форма поверхности — OQ-1. (US-4, SC-004)
- **FR-015**. `registry-ref`: artifact возвращается без вызова docker (журнал argv пуст); значение строго `"<repository>@sha256:<hex64>"` (инвариант 018/027); ref с mutable tag (`:latest` и т.п.) → `BLC_INVALID_CONFIG` fail-fast. (US-4-AC1/AC4)
- **FR-016**. `remote`: build исполняется против документированного удалённого host; digest — content-digest удалённого daemon; локальный daemon не обязателен; провалы remote-специфичны (connect/auth) диагностируются явно. (US-4-AC2)
- **FR-017**. default-режим: недостижимый локальный daemon → стабильная `BLC_*`-диагностика (продлена аддитивно относительно 027 codes; настрой: `BLC_DOCKER_UNREACHABLE` или уточнённое message — OQ-1/plan) с actionable направлением на registry-ref/remote/запуск daemon; никакого тихого пропуска и partial-артефакта. (US-4-AC3, SC-004)

**Fix-5 — pilot registry**

- **FR-018**. Резолюция `packageName` в registry выполняется из dependency graph consumer-проекта (rootDir node_modules/workspace) с поддержкой subpath exports (`@ycforge/composer/builder`); `BRG_PACKAGE_NOT_FOUND` — только при недостижимости из проекта; сообщение actionable. (US-5-AC1/AC4, SC-005)
- **FR-019**. Секции `builders` и `materializers` — раздельные key namespaces: любой ключ (legacy или artifact-type), валидный в одной секции, может присутствовать в другой без `BRG_KEY_COLLISION`; внутрисекционный дубликат остаётся fail-fast (`BRG_DUPLICATE_KEY`/YAML uniqueKeys). `BRG_KEY_COLLISION` сохраняется frozen с superseded-комментарием (паттерн 025 D-3); семантика 025 FR-010/US-2-AC3 пересматривается в этой спеке. (US-5-AC2/AC3, SC-005)
- **FR-020**. Legacy-совместимость registry: существующие `builders.yaml` (bare-ключи, прошлая коллизия-семантика валидных сценариев) валидны; 0 регрессий файлов и тестов registry; `isArtifactType`/грамматика 025 `BRG_INVALID` не изменяются. (US-5-AC3, SC-005/006)

## 8. Edge cases

- **Ссылка на app с builder-ключом НЕ artifact-type** (например `user_service_builder`) — domain не выводится; при ссылке на такой app → `RESOURCE_REF_NOT_DECLARED` (документировано; маппинг только для artifact-типов) — D-6/FR-002.
- **`ycforge:queue`/новые типы** — маппинг аддитивно расширяем; в v1 четыре канонических типа; ссылка на тип без домена — fail-fast (не угадывание, V).
- **Частичный store (built часть apps)** — apps без артефактов получают descriptor без value → документированная ошибка для value-needing materializer (тот же текстовый путь FR-008); `--target` взаимодействие — план.
- **Stale store по отношению к source** — повторная сборка с изменёнными исходниками меняет fingerprint 022 (эффект кэша) → store перезаписывается; «материализовать из устаревшего store» — документированное требование full rebuild (консистентно 025 A-2).
- **User extensions уже задают `name`/`memory`** — materializer-база детерминирована, extensions применяются поверх (deep merge, IV); расхождение «base vs user» не маскируется; маскирование → `EXT_*` семантика 015.
- **Companion-директория с предыдущим файлом** — детерминированная перезапись (идентичные входы → идентичный файл); отсутствие загрузки/сети при validate.
- **registry-ref + `no_push: true`** — комбинация определена (no-op: push и так не выполняется); валидна, не конфликтует (027).
- **remote-режим без авторизации host** — явная диагностика remote-connect/auth (не путать с локальным daemon-кейсом FR-017).
- **clone по mutable tag в registry-ref** — `BLC_INVALID_CONFIG` (FR-015), инвариант охраняется тестами форм.
- **subpath, отсутствующий в exports пакета** — резолюция падает с actionable сообщением (не-silent), код `BRG_LOAD_ERROR`/`BRG_PACKAGE_NOT_FOUND` по фактической причине; проверка exports-контракта.
- **pnpm strict node_modules / hoisting** — резолюция обязана ходить в `node_modules/.pnpm`-структуру честно (корректно), а не полагаться на случайный hoist.
- **Bare-key дубликат внутри секции после разделения namespaces** — по-прежнему fail-fast (uniqueKeys/YAML `BRG_DUPLICATE_KEY`); новый namespace не ослабляет внутрисекционную грамматику.
- **Determinism при новых attributes** — `name`/`memory` из стабильных входов (app_id/константы); никаких UUID/timestamps в emitted config (иначе golden-детерминизм 024 D-8 ломается).

## 9. Decisions (D)

- **D-1 (Fix-1 binding, 2026-09-13)**. Composer разрешает `${resources.*}` по индексу, объединяющему external-entries (resources.yaml) и app-identities C-модели (domain из artifact type). Объявление app-identity в resources.yaml остаётся запрещённым (apps — single source, VI); рекомендательные reference chains 024 FR-010 (ссылки на apps) становятся исполнимыми.
- **D-2 (Fix-2 binding, 2026-09-13)**. Standalone `ycsf materialize` потребляет artifacts из store `ycsf build` (или `--artifacts <dir>`) и даёт байт-идентичный pipeline-output.
- **D-3 (Fix-3 binding, 2026-09-13)**. Materializers завершают required YC attributes для продуцируемых типов; companion path — project-root-relative (рядом с `.tf.json`, в `infra/generated`); D-4 таблица адресов спеки 024 не меняется.
- **D-4 (Fix-4 binding, 2026-09-13)**. Docker builder получает surface dev-режимов: `registry-ref`, `remote`, default с actionable диагностикой; никакого silent skip; инвариант «never a mutable tag» охраняется во всех режимах; `no_push` (027) совместим.
- **D-5 (Fix-5 binding, 2026-09-13)**. Pilot registry: subpath/consum-граф-резолюция packageName; builder vs materializer key namespaces разделены (cross-section дубликат допустим).
- **D-6 (транспорт app-identities в composer)**. App-identities доставляются composer'у аддитивно из C-модели (BuildContext/compile-параметр), НЕ перечитыванием `.ycsf/apps.yaml` — сохранён 026 FR-005/D-2 (Builder не парсит apps.yaml). В CLI-пути `ycsf-api compile` (без C-модели) индекс остаётся resources.yaml-only (legacy-поведение NG-10). Точная форма транспорта и канонический home маппинга — OQ-2.
- **D-7 (companion placement)**. `infra/generated/` — каноническое project-root-relative расположение companion; materializers получают `projectRoot` аддитивным полем MaterializationContext (контракт pilot + структурная копия materializers-core), не `process.cwd()`.
- **D-8 (relaxation pattern)**. Семантические relaxation в 028 (FR-003 «ридил app-identity валиден», FR-019 «cross-section дубликат допустим») объявляются по паттерну 025 D-3: константы-коды frozen, комментарий superseded, «ранее invalid → valid» со strict-ограничениями; существующие тесты, ассертящие «старые ошибки», обновляются явно и перечислены в §13.

## 10. Ограничения (что НЕ делаем)

- Не вводится новый формат `.ycsf/*.yaml` / version bump (NG-2): Fix-4 surface либо per-app image-блок (OQ-1), Fix-2 store — JSON-дескриптор внутри `.ycsf/artifacts/` (не `.ycsf/*.yaml`).
- Не меняются публичные контракты: всё новое аддитивно (`MaterializationContext.projectRoot?`, опциональные поля `DockerBuildConfig`, дескрипторы/`--artifacts`, маппинг Fix-1); существующие типы не редактируются (test-d guard, SC-006).
- Не удаляются/не переименовываются существующие коды: `BRG_KEY_COLLISION`, `RESOURCE_REF_NOT_DECLARED`, `OUT_*`, `BLC_*` — frozen; только дополнительный суперсед-комментарий и, для `BLC_*`, аддитивное расширение.
- Не импортируются значения из секретов/kредов в build/materialize; `registry-ref` не читает registry-credentials.
- Не исполняется docker daemon, не строится приватный registry, не реализуется отдалённый build-агент (NG-3..NG-5).
- Не изменяется семантика terraform-оркестрации (`cli/terraform.ts`), авто-outputs (025 FR-008) и IDT-таблица (026 D-4): D-4 спеки 024 frozen.
- Не парсится `.ycsf/apps.yaml` внутри composer builder (026 FR-005): только additive transportation C-модели.

## 11. Конституция и контракты (additivity per Fix)

Принципы: I (границы A/B/C — каждый фикс в своём пакете-слое), III (contract versioning, additive-only), V (fail-fast вместо тихих merge/деградаций), VI (apps=managed single source).

| Fix | Публичные поверхности | Surfaces touched/added (аддитивно) | Контракт-след |
|---|---|---|---|
| Fix-1 | Composer (B): построитель ресурсного индекса; auth-validation | добавка app-identities в индекс; (опц.) аддитивный вход BuildContext/C-модели; запрет collision не снимается (`PML_IDENTITY_COLLISION` и C, и B) | `composer` внутренний; при транспорте через BuildContext — аддитивное optional-поле `@ycforge/pilot/contracts` (test-d) |
| Fix-2 | Pilot (C): `ycsf materialize` CLI + store-контракт | чтение `.ycsf/artifacts/`; флаг `--artifacts`; per-app JSON-дескриптор `{version, type, value}` — код файл, не `.ycsf/*.yaml` | store-manifest versioned (как cache manifest 022 `version: 1`); 025 US-5 поведение расширено при наличии store, legacy сохранён |
| Fix-3 | Materializers-core (019, B-слой): function/gateway эмиссия + companion | addition required attrs (детерминированные); relocation companion → `infra/generated`; `MaterializationContext.projectRoot?` (additive) | `@ycforge/pilot/contracts` materializer.ts optional-поле + структурная копия materializers-core; контракт `TerraformResource.configuration` не меняется (opaque) |
| Fix-4 | Builders-core docker (018/027): DockerBuildConfig | optional-поля режимов; аддитивные `BLC_*` (или уточнённые message) | `DockerBuildConfig`/JSON-schema builders-core.json — только optional; `DockerArtifactValue` не меняется; pilot/C не трогают (build_config versionless opaque, V) |
| Fix-5 | Pilot (C): registry loader + builders-yaml | consumer-graph резолюция (поведение loader); раздельные namespaces секций | `registry.ts` коды frozen; `BRG_KEY_COLLISION` superseded-комментарий; parsing builders.yaml семантика отката с 025 FR-010 |

**Fix-3: tf.json impact на determinism и auto-outputs.** Добавление required-атрибутов меняет эмитируемую форму `*.ycsf.tf.json` для `yandex_function.*`/`yandex_api_gateway.*` (новые детерминированные поля `name`, для функции `memory`). Это НЕ ломает byte-determinism (значения из стабильных входов, T-сущностно детерминированы — никаких volatile), но требует обновления golden-эталонов 014/019 и фикстуры pilot, где эти конфиги уже заморожены (§13 «regression anchors»). Авто-outputs 025 (materializerOutputs → buildOutputs) структурно не затронуты: ключи/значения output-объявлений не меняются, меняется только configuration продуцируемого ресурса. D-4 таблица addresses (024) frozen: resource label остаётся стабильной app identity, `name`-атрибут — значение производно от неё же. Companion relocation также меняет размещение файлов (не формат `.tf.json`): `path.module`-ссылка сохраняется, файл становится root-relative.

**Superseded-семантика (relaxation).**
- 025 FR-010 / US-2-AC3 («BRG_KEY_COLLISION сохраняется неизменным») superseded Fix-5b (D-8): cross-section дубликат artifact-типа допустим. Этап verify: обновить тест 025, ассертящий прежний fail; константа `BRG_KEY_COLLISION` frozen.
- 009/структуры: `RESOURCE_REF_NOT_DECLARED` для app-identities больше не возникает (Fix-1) — «ранее error → valid» для имён apps; для несуществующих имён код остаётся.

## 12. Assumptions

- **A-1**. 025, 026, 027 реализованы и доступны (дeps готовы: dispatch с `artifacts`, subpath `@ycforge/composer/builder`, docker `no_push`); 028 надстраивает, не дублирует.
- **A-2**. App-identities и domain-вывод вычисляет C (владелец C-модели и `app.builder`); composer получает готовые записи аддитивно (D-6) — точная форма OQ-2/plan.
- **A-3**. `terraform validate` оффлайн (T005) ловит неполноту конфигурации до креденшалов; после Fix-3 материализованные function/gateway проходят validate; план остаётся в границе FR-019 (provider configure).
- **A-4**. Docker daemon в среде разработки недоступен (darwin/arm64, 2026-09-13) — приёмка Fix-4 hermetic через fake-docker; smoke на реальном daemon — вне unit-цикла.
- **A-5**. `ycsf plan` и standalone `ycsf materialize` на reference-проекте выполняются без `--target` (полный build), давая store для всех приложений (025 A-2).
- **A-6**. Идентичность: `buckets.frontend.name` и `containers.analytics.id` — свойства, заявленные 024 FR-010/FR-002; правка доменных свойств вне 028.
- **A-7**. Резолюция consumer-graph выполнима в монорепо (workspace) и в опубликованном виде package; pnpm strict-структура учитывается (не полагаемся на hoist).
- **A-8**. Контракты проверяются type-tests (test-d против `@ycforge/pilot/contracts`); materializers-core/builders-core — структурные replica, согласованные test-d (положение D-2 019/018).

## 13. План верификации (test surface + regression anchors)

**Пакеты и поверхности.**

- **packages/composer (B)** — unit: merged-индекс (external + apps; порядок FR-003), домен-вывод (FR-002/FR-001), fail-fast (FR-004), auth-ref (FR-005); integration: build app `openapi` на map-form fixture со ссылками на три других app; golden: `specPath`-документ и `resourceReferences` (детерминизм 009/008). Регресс: весь существующий CLI suite (array-form fixtures) зелёный без правок (NG-10).
- **packages/pilot (C)** — unit: строитель+читатель store-дескрипторов (version, `{type, value}`), `--artifacts`-флаг (FR-006/009); standalone materialize vs pipeline byte-compare на реальных builders/materializers (FR-007, SC-002); регистр: consumer-graph резолюция subpath (FR-018), namespace-коллизия (FR-019), legacy (FR-020); диагностика отсутствующего store (FR-008). Golden: `infra/*.tf.json` + `99-ycsf-outputs.tf.json` fixture. Регресс: 025/021 suites; их тесты на «BIG-key collision» обновляются с superseded-комментарием (D-8).
- **packages/materializers-core (019)** — unit/golden: конфигурация yandex-function (name/memory — по OQ-3) и yandex-api-gateway (name + companion root-relative) (FR-010/011); авто-outputs без изменений (FR-012); characterization: `terraform validate -no-color` на golden (Constitution II extraction для thin tf-orchestration; T005). Golden-фикстуры конфигов обновляются (это anchors Fix-3); существующие тесты конфигов получают ожидаемую форму.
- **packages/builders-core (018/027)** — fake-docker (`test/helpers/fake-bins.ts`) + журнал argv: registry-ref (0 docker-вызовов, форма digest, mutable-tag → BLC_INVALID_CONFIG), remote (host-механизм, digest), default-unreachable (actionable BLC_*, без partial) (FR-014..017); инвариантные формы image-строки; 027 no_push compat. Регресс: полный docker.spec.ts.
- **Contracts (test-d)** — аддитивность всех optional-полей, frozen-кодов, superseded-комментариев (SC-006).

**Goldens/anchors.** `infra/*.tf.json` golden для 4 resource-типов (в том числе с новыми атрибутами Fix-3); `specPath`/`resourceReferences` composer; store-дескриптор; registry fixtures builders.yaml (both-секции namespace); сборка всех четырех пакетов + typecheck + lint (конвенция CI репо).

**Regression anchors (обязательно обновляются в этой спеке).** тест 025 BRG_KEY_COLLISION (superceded); тесты materializers-core configuration (ожидаемая форма с required attrs); любые pilot-golden, содержащие function/gateway конфиг; тесты cwd-companion (после Fix-3 — root-relative). Изменений в тестах composer CLI (legacy) нет.

**Smoke (не CI-обязателен).** полный конвейер reference-проекта при событии 024; реальный docker daemon — только на машине с `docker info` OK.

## 14. Open questions → plan

- **OQ-1 (Fix-4 форма поверхности).** `registry-ref`/`remote`/default конфигурации: per-app `build_config.yaml` image-блок (additive, versionless, C-opaque — рекомендуемый, пока не требует нового формата) vs project-level `.ycsf/project-config.yaml` (потребует НОВОГО versioned формата — contract change, нежелательно). Также: имена полей (`image.mode`, `image.ref`, `image.host`…), набор BLC-кодов (новый `BLC_DOCKER_UNREACHABLE` vs уточнение message с сохранением const).
- **OQ-2 (Fix-1 канонический home маппинга artifact→domain + транспорт identity).** Где живёт маппинг `ycforge:*`→domain: аддитивный export `@ycforge/pilot/contracts` (поконтрактный source of truth для C/B) vs константа composer builder vs дублирование? Транспорт C-модели в composer: аддитивный optional-поле BuildContext vs отдельный параметр `compileComposition`; оба сохраняют 026 FR-005. Нужен ли pilot-контракту новый тип (например `AppIdentity { appId, artifactType }` с domain-выводом).
- **OQ-3 (Fix-3 минимальный required attr set).** Точный набор: yandex_function — `name` + `memory` (значение-константа? какое; отсутствует ли в provider-ветке); yandex_api_gateway — `name`. Сверка с pinned provider (research T005 фиксирует эмпирику; точная версия/required-схема — на plan).
- **OQ-4 (Fix-2 artifact-store contract).** Форма store: per-app `artifact.json` в `.ycsf/artifacts/<appId>/` (добавочная запись build) vs чтение cache-blob `artifact.json` (зависимость от cache dir) vs project-level manifest; версия контракта; семантика `--artifacts <dir>` (указание корня store или blob-каталога); stale-инвалидация.

Все OQ-* НЕ блокируют реализацию остальных фиксов; решения фиксируются в `/speckit.plan` до `/speckit.tasks`.

## 15. Приемка (acceptance)

US-1..US-6 считаются приемлемыми, когда каждая When-последовательность даёт описанный результат на конфигурации тестового проекта; метрики SC-001..SC-008 измерены. Все FR-001..FR-020 закрыты тестами RED→GREEN (наличествующие thin orchestration — characterization, Constitution II). Существующие suites четырёх пакетов зелёные, кроме явно обновлённых goldens/superseded-интерпретаций (§13). Никаких [NEEDS CLARIFICATION].