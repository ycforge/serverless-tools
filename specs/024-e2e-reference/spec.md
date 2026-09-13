# Spec 024: e2e-reference — канонический reference-проект (user_service + analytics + frontend + openapi), build → terraform plan

## Metadata

- **Spec ID**: 024
- **Title**: e2e-reference — канонический reference-проект (user_service + analytics + frontend + openapi), build → terraform plan
- **Feature Branch**: `024-e2e-reference`
- **Created**: 2026-09-12
- **Status**: 🚧 In Progress
- **Input**: roadmap row `024 | e2e-reference — reference-проект (user_service + orders + frontend + openapi), build → terraform plan | §30, §41 | ⬜ | все волны 1–3` (исправлено: `orders` → `analytics`, см. D-1)
- **Dependencies**: 001, 002, 003–022 (фундамент + все волны 1–3), 023 (js-dev-tools — локальная разработка user_service/analytics)
- **IDEA.md sections**: §30 (B + C + Terraform pipeline), §36 (Frontend), §37 (Serverless Containers), §38 (Local development), §39 (Incremental builds), §41 (Общая architecture)
- **Packages/examples**: `examples/reference-project` (`@ycforge/reference-project`) — пакет reference-проекта в workspace; используется `@ycforge/nestjs-connector` (A), `@ycforge/composer` (B), `@ycforge/pilot` (C), `@ycforge/builders-core/*`, `@ycforge/materializers-core/*`

---

## Problem Statement

Инструменты serverless-tools спроектированы и верифицированы по слоям: A — runtime connector, B — API composition, C — orchestration/build, Terraform — provisioning. Спеки 001–023 проверяли каждый слой (и отдельные стыки) изолированно. **Нигде нет одного проекта, который проходит весь конвейер целиком**: от «обычного NestJS-приложения + конфигов» до валидированного `terraform plan`. Потенциальному контрибьютору приходится склеивать понимание из четырёх пакетов, fixture-директорий и разрозненных примеров в документации.

Отсутствие единого reference-проекта порождает и **дрейф канонического примера**: набор приложений `user_service + analytics + frontend + openapi` зафиксирован в constitution, AGENTS.md и во всех предыдущих спеках, но в roadmap (строка 024 до текущей правки) он был записан как `user_service + orders + frontend + openapi` — расхождение между источниками, которое некому было поймать.

Spec 024 добавляет недостающий связующий артефакт: **канонический reference-проект**, который:

1. проходит весь конвейер A → B → C → Terraform **do plan** (без `apply`);
2. при этом **не требует облачных креденшалов и не содержит секретов** — пригоден для CI smoke-проверки «из коробки» (единственная сетевая активность — загрузка terraform provider plugins);
3. становится **единственным источником истины** для канонического примера во всей документации (constitution, AGENTS.md, IDEA.md, specs 001–023).

Наблюдаемая цель (один абзац): **любой контрибьютор запускает одну CLI-команду из корня монорепо и получает валидированный `terraform plan`** — как без облачного аккаунта (валидация структуры, CI-gate), так и с аккаунтом (реальный план с корректной связкой ресурсов). Никакого `apply`, публикации артефактов, push в registry и секретов в репо.

Это **НЕ новая функция A/B/C** (Constitution I: A owns runtime, B owns composition, C owns orchestration, Terraform owns provisioning): reference-проект лишь **использует публичные контракты всех слоёв**, демонстрируя их совместную работу. Spec 024 не меняет контракты пакетов, не добавляет новых builder/materializer/материализационных возможностей и не реимплементирует пайплайн.

---

## Scope (In Scope)

### S-1 — Reference-проект: расположение, форма, назначение

| Аспект | Решение |
|--------|---------|
| **Расположение** | `examples/reference-project` — пакет pnpm workspace (глоб `examples/*` уже подключён через `pnpm-workspace.yaml:1`), имя `@ycforge/reference-project`. |
| **Комм-ит** | Директория целиком коммитится в монорепо: исходники приложений, конфиги, снэпшоты/эталоны для тестов, документация пайплайна. |
| **Назначение** | Канонический, всегда-консистентный пример для всей документации: имя, структура и конфигурация проекта являются источником правды для примеров в specs/docs (Constitution, «Единый reference-проект»). |
| **Пакет НЕ** | не является новым builder/materializer/плагином; не содержит кода runtime (A), composition (B) или orchestration (C); только пример-приложение + конфиги + проверки. |
| **Параллель** | Пример устроен как известный `examples/third-party-contracts-plugin` (пакет в workspace), но демонстрирует внутренний стек serverless-tools целиком, а не стороннюю интеграцию. |

### S-2 — Канонический набор приложений (spanning весь стек)

Reference-проект содержит **ровно четыре** приложения — канонический набор из constitution (user_service — runtime-функция A, analytics — контейнер, frontend — статика, openapi — gateway-композиция B):

| App | Тип (наблюдаемый) | Демонстрирует | Builder (registry) | Materializer (registry) |
|-----|-------------------|---------------|---------------------|-------------------------|
| **user_service** | NestJS-приложение через `@ycforge/nestjs-connector` (Project A runtime), HTTP API | A runtime + bundling; логический ресурс `functions.user_service` | nestjs-function | yandex-function |
| **analytics** | NestJS-приложение, упакованное как **serverless container** (IDEA §37) | docker builder + container-target; логический ресурс `containers.analytics` | docker | yandex-serverless-container |
| **frontend** | статическое приложение (vite), собирается **только из public build-time данных** (Constitution; §36) | vite builder; public-only окружение сборки | vite | yandex-storage-bucket |
| **openapi** | единая точка входа API Gateway — **композиция Project B** (совмещённые API user_service + analytics), безопасный режим | Project B safe mode, logical resource references, gateway-materializer | composer builder | yandex-api-gateway |

Каждый из **четырёх core-builders** (nestjs-function, docker, vite) и **четырёх core-materializers** (function, serverless-container, api-gateway, storage-bucket; «materializers-yandex», spec 019) задействован в reference-проекте — это критерий полноты покрытия (SC-002). Непосредственное использование пакета `@ycforge/builders-core/*`/`@ycforge/materializers-core/*` через явный маппинг `.ycsf/builders.yaml` (Constitution V, specs 013/014) — единственный способ подключения; локально-определённых плагинов в v1 нет (D-3).

### S-3 — Один командный entrypoint: конвейер check → build → materialize → terraform init → validate → plan

Reference-проект предоставляет **единую CLI-команду** (pnpm-script пакета `@ycforge/reference-project`), которая из корня монорепо выполняет полный конвейер (IDEA §30), остановленный **до** `apply`:

```text
ycsf check (spec 020, контрактная валидация проекта)
  → ycsf build (spec 021: run builders → Artifacts; spec 022: инкрементальный кэш)
  → ycsf materialize (spec 021: run materializers → TerraformResource → extensions → infra/*.tf.json)
  → terraform init (provider plugin download — единственная сеть)
  → terraform validate (глубокая Terraform-валидация сгенерированного кода)
  → terraform plan (финальный артефакт; применяется только «если возможно», S-5)
```

Наблюдаемый результат: `terraform plan` с корректным набором ресурсов (D-4) — либо, в окружении без креденшалов, детерминированный стоп ровно на границе настройки provider (FR-019). Команда идемпотентна: повторный запуск на неизменённых исходниках не меняет структуру результата (FR-012, SC-003). Секретов команда не требует (S-6).

`ycsf plan` (spec 021) — тонкая оркестрация поверх Terraform CLI; в контексте reference-проекта это **characterization-lock** объект (Constitution II: тонкие оркестрационные слои C покрываются characterization-тестами постфактум).

### S-4 — Конфигурационная модель (данные проекта)

Проект несёт полный набор `.ycsf/*.yaml` форматов `version: 1` (spec 011, 012, 013–017) плюс per-app конфиги:

| Конфиг | Что задаёт |
|--------|------------|
| `.ycsf/apps.yaml` | четыри managed-приложения (source_path + builder-ссылка); ownership: apps = managed, resources = external (Constitution VI; внешние `resources.yaml`-сущности в v1 отсутствуют — D-3) |
| `.ycsf/builders.yaml` | явный registry-маппинг builders **и** materializers на `@ycforge/builders-core/*` и `@ycforge/materializers-core/*` (спеки 013/014); без auto-discovery (V) |
| `.ycsf/extensions.yaml` | provider-specific поля через IDL-адресацию и deep merge (spec 015) — демонстрация «Terraform остаётся Terraform» (IV) |
| `.ycsf/outputs.yaml` | авто-генерируемые outputs (spec 016) |
| `<app>/build_config.yaml` + `build_env` | per-app конфиг сборки; `build_env` — **только public данные**, без секретов (spec 012, FR-005) |

Никаких `.env*` в репо (см. `.gitignore` репо и S-6). Версии/provider и `.terraform.lock.hcl` коммитятся (AGENTS.md).

### S-5 — Верификация без облачного аккаунта (CI-gate)

Reference-проект обязан проходить сквозную проверку **без доступа к Yandex Cloud** (креденшалы не вводятся, сеть — только для terraform provider plugin download):

- Жёсткий CI-gate: `check` → `build` → `materialize` → `terraform init` → `terraform validate` — последовательность обязана завершаться успешно и **никогда не падать раньше** `terraform plan`-стадии.
- `terraform plan` без креденшалов — поведение, зависящее от provider-семантики настройки. Требование сформулировано **ограниченно** (FR-019): либо plan завершается успехом (провайдер допускает конфигурацию без авторизации), либо пайплайн останавливается **ровно и только** на документированной границе настройки provider с понятным сообщением; никакие предыдущие стадии не могут упасть по причине отсутствия аккаунта.
- Корректность структуры плана верифицируется без облака: по детерминированному `infra/*.tf.json`, по стабильным resource addresses (FR-017) и по `terraform validate`.
- С аккаунтом (реальный сценарий контрибьютора) — `terraform plan` показывает ожидаемый набор ресурсов и корректную связку через logical references (US-4).

### S-6 — Безопасность: никаких секретов

- Секреты/креденшалы **не могут** находиться в репо: `.env*`, ключи, токены — запрещены в reference-проекте (репо `.gitignore`).
- `build_env` frontend — только public build-time данные; `ycsf check` (spec 020) обязан проходить чисто по suspicious-ключам (`SECRET`/`TOKEN`/`PASSWORD`, §36).
- Runtime-секреты выходят за scope (см. Out of Scope); в в1 пайплайн plan-стадии не требует ни одного секрета.
- CI-тест сканирует директорию reference-проекта на секреты (FR-023, SC-007).

### S-7 — Test-first и characterization locks

Приёмка spec 024 превращается в тесты ДО реализации (Constitution II):

- **RED→GREEN авто-тесты** (внутри reference-проекта, без сети): прохождение стадий `check`/`build`/`materialize` на fixture-исходниках; детерминированность `infra/*.tf.json` (byte-for-byte, golden-файлы); граф зависимостей openapi → user_service/analytics/frontend; fail-fast на коллизиях.
- **Характеризация тонкой оркестрации** (Constitution II — осознанное исключение): стадии, вызывающие Terraform CLI (`init`/`validate`/`plan`), покрываются characterization-тестами постфактум на зафиксированную последовательность команд и коды выхода.
- **Интеграционные gates без облака**: `terraform init`/`validate`/`plan`-граница в CI (S-5) — разрешённый сетевой сценарий (загрузка provider plugins).
- **Docs-lint**: grep-тест в CI, запрещающий неканонические имена приложений (`orders` и т.п.) в документации/specs (FR-022, SC-006).

---

## Scope Boundaries (Out of Scope)

| Что | Почему не в scope | Кто/когда |
|-----|-------------------|-----------|
| `terraform apply` / `ycsf apply`, destroy, publish, деплой | Строка roadmap: «build → terraform plan»; plan — финальная наблюдаемая стадия reference-проекта | Future/reference-companion |
| Push docker-image в registry (`cr.yandex`) | Plan не требует registry; контейнерная сборка создаёт локальный image-reference с детерминированным digest без публикации (FR-024); реальное разворачивание — вне v1 | На этапе apply-feedback |
| Облачные креденшалы/IAM-токен внутри проекта | Секреты запрещены (S-6); аккаунт — только у контрибьютора, в runtime-окружении | — |
| Runtime-секреты (Lockbox, secrets-manager), авторизация Gateway | Вне цели проверки конвейера до плана | Future |
| Новые возможности A/B/C/Terraform materializers | Reference-проект использует существующие публичные контракты; новых фич не добавляет | — |
| Внешние `resources.yaml`-сущности (external resources) | Ownership-демонстрация external-ветки не обязательна для плана; все четыре приложения — managed (Constitution VI) | Future |
| `yandex-message-queue`/`yandex-storage-bucket` глубокая функциональность | В reference-проекте bucket/queue не разворачиваются семантически; узел bucket — цель materializer-аплана | На этапе деплоя |
| Performance-бенчмарки, мульти-регион, production-hardening | Reference — развивающийся канонический пример, не нагрузочный стенд | — |
| Один-в-один повторение фич из 001–023 (например полный набор MQ/очередей) | Специфичные фичи уже покрыты своими specs; reference демонстрирует сквозной конвейер | — |

---

## Decisions

### D-1 — Канонический набор приложений фиксируется reference-проектом; roadmap исправляется (specs первичны)

**Решение**: Reference-проект использует канонический набор `user_service + analytics + frontend + openapi` (Constitution, «Единый reference-проект»). В том же коммите roadmap строка 024 исправляется: `orders` → `analytics`, статус ⬜ → 🚧.

**Рациональность**: spec-ы первичны относительно roadmap (§ rules, AGENTS.md); канонический пример — связывающее соглашение всей документации. Расхождение roadmap с constitution/AGENTS/prior-specs — это именно тот класс дрейфа, который 024 и должен устранять (Problem Statement). `orders` отсутствует во всех остальных источниках.

### D-2 — Reference-проект живёт в `examples/reference-project` как workspace-пакет

**Решение**: Пакет `@ycforge/reference-project` в `examples/` (глоб `examples/*` уже в `pnpm-workspace.yaml`); исходники, конфиги и тесты коммитятся.

**Рациональность**: workspace-пакет получает все механики монорепо (pnpm install, фильтры `--filter`, одни lockfile, экспортные зависимости workspace). Существующий `examples/third-party-contracts-plugin` показывает паттерн. Канонический пример должен быть частью репо (specs первичны, примеры — артефакт репо), а не отдельным репозиторием.

### D-3 — Демонстрация полного стека: функция, контейнер, статика, gateway

**Решение**: user_service → nestjs-function → yandex-function; analytics → docker → yandex-serverless-container; frontend → vite → yandex-storage-bucket; openapi → composer → yandex-api-gateway. Внешних resources.yaml-сущностей в v1 нет (все четыре — managed).

**Рациональность**: Reference-проект обязан показать, что каждая из четырёх веток IDEA §41 (Nest/Docker/Vite builders; Function/Container/API GW materializers) реально работает в общем конвейере — это критерий SC-002 и ценность для контрибьютора. Container-ветка (analytics) закрепляет поддержку serverless containers (§37). Один-в-один произвольный выбор (например все apps → function) урезал бы демонстрацию до малой части стека. Managed-only в v1 — минимальный объём при полном соответствии Constitution VI (apps = managed).

### D-4 — Состав плана и resource addresses — верхнеуровневый observable-контракт

**Решение**: План обязан содержать ровно четыре managed-ресурса с **стабильными** Terraform addresses: `yandex_function.user_service`, `yandex_serverless_container.analytics`, `yandex_storage_bucket.frontend`, `yandex_api_gateway.openapi`, связанные logical-reference цепочкой `${resources...}` (spec 009) от openapi к user_service/analytics и через `extensions.yaml`-патчи (spec 015). Точная топология (какие links, какие extensions-поля) фиксируется на этапе `/speckit.plan`.

**Рациональность**: Адреса вида `functions.user_service → yandex_function.user_service` стабильны по дизайну (spec 034/IDEA §34, `moved.yaml`). «Четыре ресурса + связка» — измеримый и однозначный результат плана без реальных ID облака; он же — хард-ассерт CI без креденшалов (структурная корректность, S-5).

### D-5 — Без-креденшальный `plan`: ограниченная семантика границы (provider-dependent)

**Решение**: Требование «валидированный plan без аккаунта» формулируется ограниченно (FR-019): check/build/materialize/init/validate обязаны всегда проходить; план либо успешен, либо падает **ровно** на документированной границе настройки provider — и никогда раньше. Документация reference-проекта фиксирует ожидаемое поведение под конкретный pinned provider.

**Рациональность**: Честность к платформе: настройка Yandex Cloud provider может требовать авторизационных полей на стадии configure; «plan без аккаунта всегда успешен» — это обещание, которое toolchain гарантировать не может. Ограниченная семантика сохраняет главное: **все стадии до provider-границы детерминированы и валидны без облака** (SC-004), а аккаунт нужен ровно одной последней стадии, с понятной диагностикой.

### D-6 — Container build без push: детерминированный локальный image-reference

**Решение**: Стадия контейнерной сборки аналитики создаёт локальный образ и детерминированный image-reference (immutable digest) **без публикации в registry** (§37 показывает push как полный flow; в reference-проекте до плана пуш не требуется). Для `terraform plan` валиден image-reference и его digest; креденшалы registry не нужны.

**Рациональность**: «Без облачных креденшалов и сети, кроме provider plugins» (Problem Statement). Push — это deploy-действие, выпадающее за scope «до плана»; локальный digest даёт плану стабильный образ без сетевой зависимости. Реальный push появится на apply-этапе (вне 024).

### D-7 — Public-only build окружение frontend + gate on suspicious keys

**Решение**: `build_env` frontend содержит только public build-time данные; `ycsf check` (spec 020) по сигнатуре `SECRET`/`TOKEN`/`PASSWORD` (IDEA §36) проходит чисто; CI-тест это подтверждает.

**Рациональность**: Constitution (secret-правила) + §36 прямо предписывают public-only для frontend bundle. Reference-проект — принудительный эталон: если бы он нарушал собственное правило, вся документация учила бы нарушению.

### D-8 — Детерминизм: byte-for-byte `infra/*.tf.json` + структурно стабильный plan

**Решение**: Повторный прогон на чистом checkout даёт побайтово одинаковый `infra/*.tf.json`; план — одинаковый по составу ресурсов/addresses (вплоть до известных provider-добавлений вроде временных меток, документируется в reference-README).

**Рациональность**: Детерминизм — условие golden-тестов (S-7) и полезного инкрементального кэша (§39, spec 022). Без него reference-проект невозможно тестировать стабильно.

### D-9 — Тонкая оркестрация → characterization locks (Constitution II)

**Решение**: Стадии, вызывающие Terraform CLI, и сама композиция entrypoint покрываются characterization-тестами (зафиксированная последовательность команд/стадий и коды выхода), а не unit-тестами на контракт — это осознанное исключение принципа II для тонких оркестрационных слоёв C.

**Рациональность**: Предсказуемость стадий важна, но имитировать реальный Terraform CLI в unit-тестах нецелесообразно; фиксация наблюдаемого поведения (lock) даёт стабильный CI-gate без переписывания семантики провайдера.

### D-10 — Документационная консистентность: reference-проект = источник истины, docs-lint

**Решение**: Для примеров в документации единственный источник — reference-проект (имена, структура, конфиги). CI grep-тест падает на неканонические имена приложений (`orders`) в docs/specs.

**Рациональность**: Problem Statement — именно такой дрейф (roadmap `orders`). Запрет в CI делает рецидив невозможным не только на уровне дискуссии, но и на уровне merge-gate.

---

## User Scenarios & Testing

### User Story 1 — Контрибьютор оценивает toolchain: одна команда → валидированный план без аккаунта (Priority: P1)

Новый контрибьютор клонирует монорепо, выполняет `pnpm install` и запускает единственную команду reference-проекта. Не вводя облачных креденшалов, он получает либо корректный `terraform plan`, либо документированный стоп ровно на границе настройки provider — и в любом случае видит, что все стадии до плана прошли детерминированно.

**Why this priority**: Это ядро ценности spec (Problem Statement): «весь конвейер из одной команды». Без US-1 остальные сценарии не складываются в единый артефакт.

**Independent Test**: На чистом checkout выполняется full-pipeline команда; ассертится кодовый выход, наличие `infra/*.tf.json`, успех `terraform validate`, отсутствие секретов в дереве проекта.

**Acceptance Scenarios**:

1. **Given** чистый checkout + `pnpm install` + установленный terraform CLI, **When** выполнена одна команда конвейера, **Then** стадии `check → build → materialize → terraform init → terraform validate` завершаются успешно, `infra/*.tf.json` существует, и финальный результат — валидированный план (или документированный стоп ровно на provider-границе, FR-019; FR-018).
2. **Given** полный прогон, **When** команда выполнена повторно на неизменённых исходниках, **Then** `infra/*.tf.json` побайтово идентичен и состав ресурсов плана не изменился (SC-003).
3. **Given** отсутствие сети к registry/облаку (есть только доступ к terraform registry), **When** выполнен конвейер, **Then** check/build/materialize/validate проходят (FR-011, FR-014, S-5).
4. **Given** неканонический набор приложений в конфиге (например, добавлен `orders`), **When** запускается `ycsf check`, **Then** коллизия/несоответствие каноническому набору диагностируется fail-fast (Constitution V, FR-021/022).

---

### User Story 2 — CI гоняет smoke-проверку без облака (Priority: P1)

CI-джоба (ветки `dev`/`main`) после сборки пакетов выполняет smoke-проверку reference-проекта головым образом: без креденшалов Yandex Cloud, без сети, кроме terraform provider plugin download. Эта «канарейка» ловит регрессии на стыках A/B/C/Terraform, не требуя инфраструктуры.

**Why this priority**: Сквозной конвейер — главный интеграционный риск монорепо, а CI без креденшалов — единственный способ проверять его автоматически и часто.

**Independent Test**: CI-шаг `pnpm --filter @ycforge/reference-project test:ci` выполняет конвейер с пустыми credential-переменными и ассертит: check/build/materialize/validate OK, план в границе FR-019, golden-детерминизм.

**Acceptance Scenarios**:

1. **Given** CI без credential-переменных, **When** запущен smoke-тест, **Then** все стадии до плана зелёные (падение раньше provider-границы невозможно).
2. **Given** сломанная коллизия в конфигах или отсутствие builder-артефакта, **When** smoke-тест, **Then** падает ровно на той стадии, где диагностируется (fail-fast, не маскируется) (FR-013).
3. **Given** незначительная правка исходника одного приложения, **When** повторный smoke-прогон, **Then** инкрементальный кэш (§39, spec 022) переиспользует неизменённые артефакты и пересобирает только затронутые с корректной инвалидацией зависимых (US-6).
4. **Given** frontend `build_env` содержит потенциальный suspicious-ключ (`TOKEN`), **When** запущен `ycsf check`, **Then** диагностируется suspicious-ключ; эталонный reference-проект проходит чисто (FR-005, FR-015).
5. **Given** CI-скан каталога reference-проекта, **When** проверка на секреты (`.env*`, ключи, токены), **Then** 0 находок (FR-023).

---

### User Story 3 — Контрибьютор-документатор: единый канонический пример (Priority: P1)

Контрибьютор, пишущий документацию, использует reference-проект как единственный источник примеров: имена приложений (`user_service`, `analytics`, `frontend`, `openapi`), структуру конфигов и пайплайна. CI-lint запрещает неканонические варианты в docs/specs, поэтому рассинхронизация (как в прежнем roadmap: `orders`) не возвращается.

**Why this priority**: Каноническая консистентность — конституционное соглашение; дрейф примеров — прямая причина создания 024 (Problem Statement).

**Independent Test**: CI grep-lint по docs/specs на запрещённые неканонические имена; проверка, что roadmap 024 корректен.

**Acceptance Scenarios**:

1. **Given** roadmap/док вызывает пример `orders`, **When** community pull-request открывает ветку, **Then** docs-lint стадии CI падает с указанием канонического набора (FR-022).
2. **Given** желание добавить пример нового приложения, **When** вносится изменение, **Then** необходимо изменение spec 024 (канонический набор зафиксирован контрактом: ровно четыре приложения, FR-002, FR-021) — не тихая правка документации.
3. **Given** reference-проект меняет структуру/конфиг, **When** обновляются примеры в спецификациях 001–023, **Then** источником правки служит ровно reference-проект (сверка один-в-один).

---

### User Story 4 — Контрибьютор с облачным аккаунтом: реальный план показывает правильную связку (Priority: P2)

Контрибьютор с креденшалами Yandex Cloud запускает ту же команду (креденшалы приходят из runtime-окружения, не из репо). `terraform plan` отражает ожидаемый набор ресурсов и правильные связи: функции, контейнер, bucket и gateway, где gateway ссылается на логические ресурсы через Terraform-выражения.

**Why this priority**: Реальный план (не только структурная валидация) — главный сценарий полезности reference-проекта для человека, который собирается применять связку у себя.

**Independent Test**: Ручной сценарий с подготовленными креденшалами; либо интеграционный тест, помеченный skip-без-env, ассертит полный состав плана.

**Acceptance Scenarios**:

1. **Given** креденшалы в runtime-env контрибьютора, **When** выполнен конвейер, **Then** `terraform plan` завершается успешно и перечисляет 4 ресурса со стабильными addresses (FR-017) и корректными связками логических ссылок.
2. **Given** креденшалы отсутствуют, **When** выполнен конвейер, **Then** пайплайн останавливается ровно на provider-границе с actionable диагностикой, а не раньше (FR-019).
3. **Given** стадия контейнерной сборки analytics, **When** конвейер выполнен без registry-креденшалов, **Then** сборка завершается локальным image-reference (immutable digest) и план использует его без сети к registry (FR-024).
4. **Given** изменился один исходник API (user_service), **When** перезапущен план, **Then** diff плана затрагивает только затронутые части (специфика provider sync/refresh документируется; структурный diff ограничен).

---

### User Story 5 — Покрытие всего стека: каждая ветка §41 задействована (Priority: P2)

Reference-проект использует все четыре builder-ветки и четыре materializer-ветки IDEA §41: функциональный, контейнерный, статический сборщики и Project B composition. Ни одна core-возможность не остаётся без сквозной демонстрации.

**Why this priority**: SC-002 (полнота покрытия) — ценность reference-проекта как «экзамена» для стека; неполное покрытие оставило бы дыры, которые CI-канарейка не ловит.

**Independent Test**: Тест ассертит, что в плане присутствуют все четыре ресурса с четырьмя разными materializer-адресами и что все четыре builder-ссылки в маппинге реально запускались.

**Acceptance Scenarios**:

1. **Given** конвейер выполнен, **When** проверен состав плана, **Then** присутствуют ровно `yandex_function.*`, `yandex_serverless_container.*`, `yandex_storage_bucket.*`, `yandex_api_gateway.*` — четыре managed-ресурса, без external-сущностей (D-4, FR-007).
2. **Given** прогон с логом стадий, **When** просмотрены стадии build, **Then** npm-function, docker и vite builder'ы отработали и произвели артефакты всех приложений (FR-016), Project B (composer) собрал openapi в safe mode (FR-006, FR-008/FR-009).
3. **Given** открыт сгенерированный `infra/*.tf.json`, **When** проверены ссылки gateway, **Then** они используют результат materialization логических ссылок (не provider-specific выражений из Project B) (FR-010).

---

### User Story 6 — Инкрементальный цикл разработки (Priority: P3)

Контрибьютор правит один из исходников и перезапускает конвейер: неизменённые артефакты берутся из кэша, пересборка ограничивается затронутым приложением, зависимые (openapi over user_service/analytics/frontend) инвалидируются адекватно графу.

**Why this priority**: Baseline: скорость итераций — часть «выполнимо в одной команде»; spec 022 заложил кэш, reference-проект — его сквозной демонстратор.

**Independent Test**: Контрольные точки (mtime-стабильные/хэш-стабильные) до/после перестроения; тест ассертит переиспользование артефактов неизменённых apps.

**Acceptance Scenarios**:

1. **Given** два последовательных прогона без изменений, **When** второй прогон, **Then** все артефакты переиспользованы из кэша (пересборки нет) (FR-012 + spec 022).
2. **Given** изменено только user_service, **When** пересборка, **Then** пересобраны user_service и зависимые от него (openapi), остальные — из кэша.
3. **Given** изменён открытый API-контракт user_service, **When** пересборка, **Then** коллизии/неконсистентность composition (если есть) диагностируются fail-fast на стадии Project B (Constitution V).
4. **Given** тест детерминизма на чистом checkout, **When** выполнены два прогона, **Then** `infra/*.tf.json` побайтово совпадает с закоммиченным golden-эталоном (FR-020).

---

### User Story 7 — Локальная разработка приложений (Priority: P3)

Контрибьютор, работающий над user_service/analytics, запускает локальный dev-сервер (spec 023, `@ycforge/js-dev-tools/server`) для итераций «в один клик» в рамках reference-проекта. Это сокращает цикл между изменением приложения и его проверкой.

**Why this priority**: 023 существует ровно для рабочего цикла локальной разработки; reference-проект — место, где его использование документировано и проверяемо.

**Independent Test**: Скрипт/команда reference-проекта запускает dev-server на entry user_service; fetch к endpoint отвечает (payload 2.0 path).

**Acceptance Scenarios**:

1. **Given** установлена команда локального dev-сервера reference-проекта, **When** она запущена, **Then** `@ycforge/js-dev-tools/server` поднимается и отвечает на запросы приложения через handler Project A (user_service — NestJS-приложение на runtime A, FR-003; 023-контракт).
2. **Given** dev-сервер работает без IAM-токена, **When** запрос к приложению, **Then** сервер не падает (fail-open 023), ответ корректный.
3. **Given** документация reference-проекта, **When** изучена секция разработки, **Then** в ней нет секретов и облачных требований, кроме запуска команды.

---

### Edge Cases

- **Terraform CLI отсутствует / не в PATH**: диагностика reference-проекта до старта пайплайна — понятная инструкция по установке, а не cryptic-ошибка (FR-025).
- **Сеть недоступна для terraform provider**: `terraform init` падает fail-fast на стадии с явным stage-name; последующие стадии не запускаются (FR-013).
- **Docker daemon недоступен (analytics)**: стадия контейнера даёт однозначную стадии-диагностику; остальные стадии до неё завершены (FR-013; при этом конвейер не «тихо» пропускает container).
- **Креденшалы не переданы (реальный план)**: стоп ровно на provider-границе с actionable text (FR-019, US-4 AC2) — никогда раньше.
- **Неканоническое имя приложения** (`orders`) в конфигах/docs: fail-fast при `ycsf check` и/или docs-lint CI (FR-022).
- **Коллизия в конфигах** (два builder'а на app, дубликат path/operationId composition): существующий fail-fast-диагностический слой (Constitution V) обязан сработать; reference-проект — его сквозной демонстратор.
- **Нестабильный прогон** (provider добавляет volatile-поля): документируется в reference-README; golden-детерминизм гарантируется на `infra/*.tf.json` и составе ресурсов (D-8).
- **Случайный secret в `build_env`/конфиге**: `ycsf check` suspicious-ключ диагностирует (spec 020, §36); CI-скан репо — дополнительная защита (FR-023).
- **Сетевая недоступность registry при контейнерной сборке**: не требуется (локальный build без push), D-6.
- **Дрейф между reference-проектом и примерами в старых specs (001–023)**: docs-lint и сверка с reference-проектом при правках (US-3 AC3).
- **Аппаратные различия (macOS/Linux, path-чувствительность)**: документация фиксирует поддерживаемые платформы; CI на Linux + локальный macOS (US-1) — основные проверяемые комбинации.

---

## Requirements

### Functional Requirements

**Структура и приложения reference-проекта**

- **FR-001**: System MUST содержать reference-проект как workspace-пакет `examples/reference-project` (`@ycforge/reference-project`), автоматически подхватываемый глобом `examples/*`.
- **FR-002**: System MUST включать ровно канонический набор приложений: `user_service`, `analytics`, `frontend`, `openapi`; иные приложения допустимы только через изменение spec 024 (D-1, FR-021).
- **FR-003**: System MUST упаковывать `user_service` как NestJS-приложение, обслуживаемое через публичный API Project A (`@ycforge/nestjs-connector`) — слой runtime A.
- **FR-004**: System MUST упаковывать `analytics` как NestJS-приложение с container-target (IDEA §37) без публикации image в registry (D-6).
- **FR-005**: System MUST выполнять сборку `frontend` только из public build-time данных; build-env без секретов (§36, D-7).
- **FR-006**: System MUST собирать `openapi` через Project B (`@ycforge/composer`) в safe mode (`SERVERLESS_TOOLS_OPENAPI_BUILD=1`, явный `openapi_entry`); `openapi` — единственная точка входа API Gateway.
- **FR-007**: System MUST использовать для всех приложений ownership «apps = managed» без внешних `resources.yaml`-сущностей в v1 (Constitution VI, D-3). **Уточнение (amendment, решение владельца фичи от 2026-09-13)**: в C-конвейере logical-ссылки gateway направлены на **apps**, а не на `resources.yaml`-сущности: имя в `${resources.<type>.<app_id>.id}` — это `app_id` из `apps.yaml`; индекс резолвинга — C-модель проекта (map-form apps.yaml), `.ycsf/resources.yaml` в reference-проекте отсутствует. Проверка `PML_IDENTITY_COLLISION` остаётся правилом для сценариев параллельной декларации (B-dialect), в C-конвейере она не срабатывает, т.к. ничего не декларируется в resources.yaml.

**Registry и покрытие стека**

- **FR-008**: System MUST подключать builders только явным маппингом `.ycsf/builders.yaml` на `@ycforge/builders-core/*` (nestjs-function, docker, vite) и composer builder; без auto-discovery и локальных плагинов (Constitution V).
- **FR-009**: System MUST подключать materializers только явным маппингом на `@ycforge/materializers-core/*` (yandex-function, yandex-serverless-container, yandex-storage-bucket, yandex-api-gateway; «materializers-yandex», spec 019).
- **FR-010**: System MUST выражать связи gateway↔apps исключительно в logical-синтаксисе `${resources...}` (IDL/IDT, spec 009); в Project B-артефакте не допускается provider-specific выражений (IDEA §31). **Уточнение (amendment, решение владельца фичи от 2026-09-13)**: `<name>` в `${resources.<type>.<name>.id}` — это **app_id** из `apps.yaml` (топология «ссылки на apps, не на resources»); маппинг `${resources.functions.user_service.id}` → `${yandex_function.user_service.id}` выполняется materializer-ом по замороженной таблице D-4 из identity C-модели. Подтверждено эмпирически: composer builder собирает `resourceReferences` из финального артефакта без обращения к resources.yaml (`packages/composer/src/builder/index.ts:102` + `artifact.ts:collectResourceReferences`), контракт `ResourceReference` не различает managed/external (`packages/pilot/src/contracts/resource-reference.ts`).

**Конвейер и entrypoint**

- **FR-011**: System MUST предоставлять одну команду конвейера (pnpm-script `@ycforge/reference-project`), выполняющую `check → build → materialize → terraform init → terraform validate → terraform plan` в заданном порядке, неинтерактивно.
- **FR-012**: System MUST быть идемпотентной: повторный запуск на неизменённых исходниках производит структурно идентичный результат (побайтно одинаковый `infra/*.tf.json`, одинаковый состав ресурсов плана; D-8, SC-003).
- **FR-013**: System MUST fail-fast по стадиям: ошибка стадии останавливает конвейер с именем стадии и диагностикой; последующие стадии не выполняются; никакие ошибки не маскируются.
- **FR-014**: System MUST требовать ноль секретов: конвейер работает без cloud-креденшалов и без файлов `.env*` в репо; единственная сетевая активность — загрузка terraform provider plugins (S-5, S-6).

**Верификация и детерминизм**

- **FR-015**: System MUST проходить `ycsf check` (spec 020) и `ycsf-api check` (spec 010) без диагностик/коллизий; suspicious-ключи frontend build-env не встречаются (D-7).
- **FR-016**: System MUST производить на стадии build артефакты всех четырёх приложений (bundle/container/статика/composition) со валидной формой результата каждого builder-а.
- **FR-017**: System MUST материализовывать `infra/*.tf.json` со стабильными Terraform-addresses: `yandex_function.user_service`, `yandex_serverless_container.analytics`, `yandex_storage_bucket.frontend`, `yandex_api_gateway.openapi` (D-4).
- **FR-018**: System MUST проходить `terraform init` (паттерн: загрузка provider plugins) и `terraform validate`; `.terraform.lock.hcl` коммитится (AGENTS.md).
- **FR-019**: System MUST соблюдать ограниченную семантику plan без креденшалов: все стадии до плана проходят всегда; plan либо успешен, либо останавливается ровно на документированной provider-границе с actionable диагностикой (D-5).
- **FR-020**: System MUST коммитить golden-эталоны `infra/*.tf.json` и использовать их в тестах детерминизма (S-7, D-8).

**Каноническая консистентность и безопасность**

- **FR-021**: System MUST быть единственным источником истины для канонического примера: имен, структуры и конфигурации; расхождения с примерами в specs 001–023 и IDEA.md устраняются за счёт reference-проекта (specs первичны, constitution важнее).
- **FR-022**: System MUST включать docs-lint (CI-tests), падающий при использовании неканонических имён приложений (`orders` и др.) в документации/specs; roadmap строка 024 приведена к каноническому виду (D-1).
- **FR-023**: System MUST не содержать секретов: CI-скан репо/директории — `.env*`, ключи, токены отсутствуют; любые credentials появляются только из runtime-env контрибьютора (S-6, US-4).
- **FR-024**: System MUST выполнять container build локально без registry-push: image-reference детерминирован (immutable digest), креденшалы registry не требуются (D-6).

**Диагностика**

- **FR-025**: System MUST выводить для каждой стадии краткую прогресс/диагностику со стабильным именем стадии (`check`, `build`, `materialize`, `terraform init`, `terraform validate`, `terraform plan`) и понятным сообщением при сбое, включая actionable справку по отсутствию креденшалов/CLI.

### Key Entities

- **ReferenceProject (examples/reference-project, `@ycforge/reference-project`)** — пакет workspace, владелец канонического примера: исходники четырёх приложений, конфиги `.ycsf/*.yaml`, entrypoint-команда, golden-эталоны, тесты.
- **user_service** — приложение-функция NestJS через Project A (runtime); logical ID `functions.user_service`; builder nestjs-function, materializer yandex-function.
- **analytics** — приложение-контейнер NestJS; logical ID `containers.analytics`; builder docker, materializer yandex-serverless-container (image-reference не публикуется).
- **frontend** — статическое приложение (public-only окружение сборки); logical ID `buckets.frontend`; builder vite, materializer yandex-storage-bucket.
- **openapi** — композиция API Gateway Project B (safe mode); logical ID `api_gateway.openapi`; builder composer, materializer yandex-api-gateway; единственная точка входа, ссылается на user_service/analytics федерацией logical-ссылок.
- **`.ycsf/apps.yaml`** — проект-модель: четыре managed-app (source_path, builder); ownership apps=managed (Constitution VI), `version: 1`.
- **`.ycsf/builders.yaml`** — явный registry-маппинг builders и materializers на `@ycforge/builders-core/*`/`@ycforge/materializers-core/*` (specs 013/014).
- **`.ycsf/extensions.yaml`** — IDL-адресованные provider-патчи с deep merge (spec 015), демонстрация «Terraform остаётся Terraform» (IV).
- **`.ycsf/outputs.yaml`** — авто-генерируемые outputs (spec 016).
- **`<app>/build_config.yaml` + `build_env`** — per-app конфигурация сборки; `build_env` — только public данные (spec 012; D-7).
- **Artifacts** — выходы builder-ов (bundle/container image-reference/статика/composition), content-addressed кэш (spec 022, §39).
- **`infra/*.tf.json`** — материализованные Terraform-ресурсы (extensions-патчи применены); единственный источник для `terraform init/validate/plan`.
- **Pipeline entrypoint** — единая команда reference-проекта: последовательность `check → build → materialize → terraform init → validate → plan` (IDEA §30, без `apply`).

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Контрибьютор проходит путь «один абзац проблемы» за одну команду и **ноль установочных шагов сверх базовых** (pnpm install + terraform CLI): с чистого checkout команда достигает валидированного плана (или документированной provider-границы) за **менее 5 минут** на CI (без учёта загрузки provider plugins).
- **SC-002**: Полнота покрытия стека: в плане присутствуют ровно четыре ресурса с addresses `yandex_function.*`, `yandex_serverless_container.*`, `yandex_storage_bucket.*`, `yandex_api_gateway.*`; каждый из четырёх builders (`nestjs-function`, `docker`, `vite`, composer) и четырёх materializers (function, container, bucket, api-gateway) реально отработал в прогоне.
- **SC-003**: Детерминизм: два последовательных прогона на чистом checkout дают побайтово идентичный `infra/*.tf.json` и равный состав ресурсов плана (набор из SC-002).
- **SC-004**: Без-креденшальный CI-gate зелёный на 100%: check/build/materialize/init/validate всегда успешны; план — в границе FR-019; ни одна более ранняя стадия не падает из-за отсутствия аккаунта.
- **SC-005**: Traceability: каждый FR (FR-001..FR-025) имеет ≥1 тест (RED→GREEN) либо этот тест явно отнесён к characterization-локу тонкой оркестрации (Constitution II); `typecheck`/`lint` чисты.
- **SC-006**: Docs-консистентность: grep-lint по поводу неканонических имён (`orders`) в документации/specs даёт 0 нарушений в CI; roadmap строка 024 (app-набор, статус 🚧, dependencies) корректна.
- **SC-007**: Секьюрити: скан reference-директории на секреты и suspicious build-env ключей — 0 находок; credentials в репо отсутствуют.

---

## Assumptions

- **A-1 — Базовое окружение**: Node ≥22, pnpm (в соответствии с workspace), terraform CLI заданной версии (pinned в документации/CI); все зависимости зафиксированы lockfile'ом (детерминированный install).
- **A-2 — Сеть**: единственная сетевая активность пайплайна — загрузка terraform provider plugins в `terraform init`; npm/pnpm зависимости резолвятся при `pnpm install` (lockfile), фронтенд-сборка офлайн и детерминирована.
- **A-3 — Детерминизм сборки**: bundle (nestjs-function), статика (vite) и container-image-reference детерминированы на неизменённых исходниках; провайдер-специфичные volatile-поля плана документируются (D-8).
- **A-4 — Docker daemon**: стадия контейнера требует локального Docker daemon; в CI он предусмотрен; недоступность — понятный fail-fast (FR-013), но не «тихий» пропуск.
- **A-5 — Provider-семантика**: план без аккаунта остаётся provider-dependent; ограниченная формулировка FR-019/SC-004 под pinned provider документируется в reference-README.
- **A-6 — Канонический набор стабилен**: изменение приложений канонического набора — контрактное изменение spec 024 (FR-021); в этом цикле список не расширяется.
- **A-7 — Никаких секретов в репо**: `.env*`, ключи и токены запрещены .gitignore и S-6; credentials появляются только в runtime-env и только для реального плана (US-4).
- **A-8 — Provider pinned**: `yandex-cloud` provider и terraform зафиксированы `.terraform.lock.hcl`; версия не плавает («latest» не используется).
- **A-9 — Safe mode Project B**: openapi build выполняется в изолированном безопасном режиме (SERVERLESS_TOOLS_OPENAPI_BUILD=1) всегда (Constitution; §10).
- **A-10 — Локальная разработка**: user_service/analytics локально запускаются через `@ycforge/js-dev-tools` (spec 023) без IAM-токена (fail-open) — документируется в reference-проекте.

---

## Dependencies

| Dep | Что даёт | Статус |
|-----|----------|--------|
| 001 connector-reverse | Project A public API (`createYandexHandler`, типы payload), runtime-слой user_service/analytics | ✅ |
| 002 pilot-contracts | Builder/Artifact/Materializer/TerraformResource/ResourceReference/OutputBuilder контракты | ✅ |
| 003–005 connector-* | @RequireAuth, observability/trace, MQ semantics — рабочее поведение приложений | ✅ |
| 006–010 Project B | openapi_entry/safe mode, auth.yaml, api-composition, resource-references, `ycsf-api check` | ✅ |
| 011–012 project-model | `.ycsf/*.yaml` (version:1), ownership, build_env/`{{$ENV}}` | ✅ |
| 013–017 registry/dispatch/extensions/outputs/moved | явный маппинг builders/materializers, extensions deep merge, outputs | ✅ |
| 018 builders-core | nestjs-function, docker, vite builders | ✅ |
| 019 materializers-yandex (materializers-core) | yandex-function/container/api-gateway/bucket materializers | ✅ |
| 020 ycsf-check | контрактная валидация (`ycsf check`), suspicious-ключи | ✅ |
| 021 ycsf-cli | build/materialize/plan стадии CLI; entrypoint-композиция | ✅ |
| 022 incremental-builds | content-addressed кэш артефактов (US-2 AC3, US-6) | ✅ |
| 023 local-dev-server | `@ycforge/js-dev-tools/server` — локальная разработка user_service/analytics (US-7) | ✅ |
| Terraform CLI + yandex-cloud provider | единственный deployment engine; `init`/`validate`/`plan` | external |

Без 001–023 reference-проект не собирается: это **сквозной демонстратор законченного стека**, а не новая функциональность контрактов. Spec 024 не меняет ни один контракт пакетов (Constitution III); изменение поведения пакетов, выявленное при сборке reference-проекта, оформляется отдельными follow-up-спеками.

---

## Open Questions

- **Q-1 — Где живёт reference-проект?** → **Решение**: `examples/reference-project` (`@ycforge/reference-project`), workspace-пакет по образцу `examples/third-party-contracts-plugin` (D-2).
- **Q-2 — analytics: функция или контейнер?** → **Решение**: контейнер (IDEA §37; docker builder + yandex-serverless-container), чтобы покрыть container-ветку §41; функция уже покрыта user_service (D-3).
- **Q-3 — frontend: какой target?** → **Решение**: статический bucket (vite → yandex-storage-bucket); сетевое хостинг-поведение вне scope плана (D-3).
- **Q-4 — Push docker-image в registry?** → **Решение**: в v1 нет — локальный image-reference с immutable digest; push ассоциируется с apply-этапом, вне scope 024 (D-6, FR-024).
- **Q-5 — Как `terraform plan` без облачного аккаунта?** → **Решение**: ограниченная семантика границы (FR-019, D-5): всё до плана — всегда; план — либо успех, либо документированный стоп на provider-границе; варианты механизма — на `/speckit.plan`.
- **Q-6 — Нужны ли внешние resources.yaml-сущности?** → **Решение**: нет в v1 (все четыре — managed, Constitution VI); external-ветка демонстрируется отдельно при необходимости (D-3).

Все вопросы — **не блокируют** v1; ответы зафиксированы как решения/assumptions.

---

## References

- `constitution.md` — «Единый reference-проект: user_service, analytics, frontend, openapi»; principles I–VI (особенно II — test-first, V — явное вместо магии, VI — ownership); секрет-правила; frontend public-only.
- `IDEA.md §30` — B + C + Terraform pipeline (check → build → materialize → extensions → `infra/*.tf.json` → init → plan → apply; 024 останавливается до apply).
- `IDEA.md §31–33` — logical references `/ logical template syntax и их materialization (FR-010).
- `IDEA.md §34` — resource naming/stability → стабильные addresses (FR-017).
- `IDEA.md §36` — frontend: обычный app, vite builder, public build_env, suspicious-ключи (FR-005).
- `IDEA.md §37` — serverless containers flow (builder → image-reference → materializer) (FR-004, D-6).
- `IDEA.md §39` — incremental builds (US-6, spec 022).
- `IDEA.md §41` — общая architecture: ветки builder'ов и materializers, Project B → Artifact → API GW materializer, runtime A.
- `AGENTS.md` — правила монорепо (workspace, ветка `NNN-slug`, PR в `dev`), секреты, `.terraform.lock.hcl`.
- `specs/README.md` — roadmap; строка 024 (исправлена в этом коммите: `orders` → `analytics`, 🚧, deps 001–023).
- `packages/pilot/test/check/fixtures/canonical/.ycsf/*.yaml` — канонический fixture-конфиг (user_service + analytics; apps/builders/extensions/outputs) — отправная точка структуры конфигов reference-проекта.

---

## Next Steps

1. `/speckit.plan` — технический дизайн: точная топология `infra/*.tf.json` (какие extensions-поля, какие links), композиция entrypoint-команды, разрешение provider-границы безаккаунтного плана (FR-019), тест-структура reference-проекта (golden-файлы, characterization-локи Terraform CLI, docs-lint), pin provider/terraform.
2. `/speckit.tasks` — разбивка с test-first (RED → GREEN) по US-1..US-7, FR-001..FR-025.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — создание `examples/reference-project`, тесты, typecheck/lint; при расхождении IDEA.md с фактическим поведением конвейера — обновить IDEA.md (specs первичны).
5. `/speckit.converge` — аудит; roadmap 024 → ✅, каноническая сверка примеров в specs 001–023.

---

## Checklist (для `/speckit.analyze`)

- [ ] Каждый FR (FR-001..FR-025) имеет ≥1 acceptance scenario в User Stories (traceability)
- [ ] Канонический набор (user_service, analytics, frontend, openapi) закреплён и соответствует constitution/AGENTS; roadmap строка 024 исправлена
- [ ] Покрыт весь стек: 4 builder-ветки + 4 materializer-ветки §41 (SC-002)
- [ ] Один командный entrypoint (check → build → materialize → terraform init → validate → plan) определён и идемпотентен
- [ ] Без-креденшальный сценарий ограниченно (FR-019): всё до плана всегда; план либо успех, либо документированная provider-граница
- [ ] Контейнерная сборка без registry-push (локальный image-reference, immutable digest) зафиксирована
- [ ] Public-only frontend build_env + suspicious-ключи `ycsf check` проходят чисто
- [ ] Детерминизм: byte-for-byte `infra/*.tf.json`, structural-stable plan, golden-файлы коммитятся
- [ ] Секреты отсутствуют в репо (`.env*`, ключи, токены); только runtime-env для реального плана
- [ ] Логические references (`${resources...}`) — единственный механизм связки в Project B-артефакте
- [ ] Docs-lint против неканонических имён (`orders`) в CI; reference-проект — источник истины (FR-021/022)
- [ ] Constitution I–VI не нарушены: 024 использует контракты, не меняет их; никакого кода в packages/
- [ ] Out of scope явно отложен (apply, push в registry, новые фичи A/B/C, внешние resources в v1)
- [ ] Success criteria измеримы и не требуют сети/облака (кроме provider plugin download)
- [ ] Test-first: FR → тесты (RED→GREEN) или явные characterization-локи тонкой оркестрации (Constitution II)