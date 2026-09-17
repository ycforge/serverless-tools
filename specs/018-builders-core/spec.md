# Spec 018: builders-core — nestjs-function (bundling), docker, vite builders

## Metadata

- **Spec ID**: 018
- **Title**: builders-core — nestjs-function (bundling), docker, vite builders
- **Status**: 🚧 In Progress
- **Dependencies**: 002 (pilot-contracts ✅), 013 (builder-registry ✅)
- **IDEA.md sections**: §5 (`.ycsf/apps.yaml`), §6 (App-level `build_config.yaml`), §21 (Builder registry), §36 (Frontend), §37 (Serverless Containers)
- **Packages**: `packages/builders-core` (`@ycforge/builders-core`)

---

## Problem Statement

Spec 002 определил контракты `Builder`/`BuildContext`/`Artifact` в `@ycforge/pilot/contracts`. Spec 013 определил registry: explicit mapping в `.ycsf/builders.yaml` (identifier → npm package specifier) и загрузку модулей плагинов с shape detection (`build: Function` → `kind: 'builder'`). Ни один конкретный builder-пакет при этом не существует: `builders.yaml`-пример spec 013 ссылается на нереализованные пакеты, а приложение из канонического проекта (`user_service` → `nestjs-function`, `analytics` → `docker`, `frontend` → `vite`) не может быть собрано.

Spec 018 закрывает этот пробел: реализует **три core builder-плагина** — реализации контракта `Builder` (spec 002), регистрируемые через explicit mapping spec 013:

1. **`nestjs-function`** — бандлит NestJS-app в единый деплоябельный архив (зона builder-а: bundling, tree-shaking, размер бандла и холодный старт, IDEA §21); возвращает `Artifact` для функции.
2. **`docker`** — собирает и пушит Docker-образ (IDEA §37), возвращает `Artifact<{ image: string }>` с **иммутабельной** digest-ссылкой (`cr.yandex/...@sha256:...`).
3. **`vite`** — собирает frontend-app (IDEA §36), возвращает `Artifact` со статическим выводом для будущего bucket-materializer.

Дополнительно spec 018 фиксирует **каталог артефактных типов** (forward contract): точные строки `Artifact.type` (`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`) и формы `Artifact.value` — как домен материализации для будущего spec 019.

Стык со spec 014: dispatch materializer оперирует на артефактных **descriptor-типах**, где 014 временно использует `type = app builder id` (например `nestjs-function`) как placeholder до реального build-времени (spec 021). Spec 018 вводит фактические артефактные типы и фиксирует mapping «builder id → артефактный тип», который в 021 заменит placeholder-дескрипторы, а в 019 — станет ключом `supports()`.

---

## Scope (In Scope)

### Зафиксированные решения (spec decisions)

**D-1 — Packaging: один пакет `packages/builders-core` с subpath exports.** Все три builder-а живут в одном npm-пакете `@ycforge/builders-core` и экспортируются через subpath exports:

```text
@ycforge/builders-core/nestjs-function
@ycforge/builders-core/docker
@ycforge/builders-core/vite
```

`builders.yaml`-mapping (spec 013 контракт допускает подпуть в package specifier — edge case «Package name содержит подпуть (@scope/pkg/sub): допустимо»):

```yaml
version: 1
builders:
  nestjs-function: "@ycforge/builders-core/nestjs-function"
  docker: "@ycforge/builders-core/docker"
  vite: "@ycforge/builders-core/vite"
```

**Рациональность** (будет перепроверена на `/speckit.plan`):
- Название spec («builders-core») совпадает с единым пакетом; пакет — это «core builders», поставляемые и версионируемые вместе.
- Монорепа: один пакет = один `package.json`, один `tsup`-config, один набор dev-зависимостей (esbuild, typescript, vitest), общие внутренние хелперы (вызов `docker` CLI, упаковка в zip, ошибко-каталог `BLC_*`) без лишних публичных пакетов.
- Конвенция subpath exports уже принята в репо: `@ycforge/pilot/contracts`, `@ycforge/nestjs-connector/auth|queue|context`.
- Регистрация в registry (013) работает: `import('@ycforge/builders-core/nestjs-function')` резолвится через npm subpath exports Node 22.
- Отрицательная сторона: получатель только одного builder-а ставит весь пакет (три builder-а и esbuild). Для core-builders это приемлемо; разведение по отдельным пакетам (альтернатива `@ycforge/builder-nestjs-function` и т.п.) — если plan-фаза посчитает footer-размер критичным.

**D-2 — Артефактные типы фиксируются здесь (forward contract), materializers — spec 019.** Spec 018 определяет три строки `Artifact.type` и формы `Artifact.value` как домен для `supports()` будущих materializers (019). Конкретные materializers (`yandex_function`, `yandex_serverless_container`, `yandex_storage_object`/bucket) — **вне scope** 018, их реализация — spec 019.

**D-3 — Интерполяция `{{$ENV}}` — зона pilot, не builder-а.** Спецификация 012 гарантирует: pilot передаёт builder-у `BuildContext` с **уже интерполированным** `buildConfig` (без остаточных `{{$...}}`) и resolved `buildEnv: Record<string,string>`. Поэтому:
- builder-ы **не реализуют** собственную интерполяцию `{{$ENV}}` (Constitution V: валидация и подстановка выполняются в C до вызова builder-а);
- builder-ы работают от одного только `BuildContext` (projectRoot/sourcePath/buildConfig/buildEnv/outputDir);
- если builder-у нужны значения окружения вне его `build_config`-схемы — он читает их из `buildContext.buildEnv`;
- встреченный остаточный `{{$...}}` в `buildConfig`/`buildEnv` — нарушение контракта апстрима (pilot 012): builder fail-fast с диагностическим кодом `BLC_ENV_NOT_RESOLVED`, без сильной попытки интерполировать.

### Каталог артефактных типов (forward contract)

| Builder id (`builders.yaml`) | `Artifact.type` | `Artifact.value` | Будущий materializer (019) |
|------------------------------|-----------------|------------------|----------------------------|
| `nestjs-function`            | `ycforge:function` | `{ archivePath: string; entryPoint: string }` | `yandex_function` |
| `docker`                     | `ycforge:docker-image` | `{ image: string }` — digest-form `cr.yandex/...@sha256:...` | `yandex_serverless_container` |
| `vite`                       | `ycforge:frontend` | `{ directory: string }` — абсолютный путь к собранному статическому выводу | `yandex_storage_object` (bucket) |

Связка: mapping builder id → артефактный тип становится машиночитаемым каталогом в пакете `@ycforge/builders-core`, чтобы C/021/019 диспатчил по `Artifact.type`, а не по builder id. Все три типа соответствуют грамматике `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*` (spec 002, `artifact-type.ts`).

### Builder `nestjs-function` (bundling)

Вход — `BuildContext` (spec 002); схема `build_config` (app-level, `user_service/build_config.yaml`):

```yaml
build_config:
  entry: src/main.ts        # optional; default "src/main.ts" — NestJS bootstrap entry
  runtime: nodejs20         # optional; runtime target для Yandex Function
  external: [ "sharp" ]     # optional; modules НЕ бандлятся (native/external)
  out_filename: function.zip  # optional; default "function.zip"
```

- Бандлит приложение в **единый self-contained вывод** (esbuild, tree-shaking — зона builder-а, IDEA §21); размер бандла и холодный старт — ответственность этого builder-а, энд-юзер не конфигурирует оптимизации.
- `external` — локальное исключение для модулей, которые нельзя бандлить (native addons). Остальное бандлится; внешние зависимости не переезжают в runtime.
- Упаковывает вывод в zip-архив внутри `BuildContext.outputDir`.
- Возвращает `Artifact { type: 'ycforge:function', value: { archivePath: <abs path к .zip>, entryPoint: <экспорт хендлера> } }` (IDEA §8: Function → `{ archivePath, entryPoint }`).
- Boundary: поле `openapi_entry` в `build_config` function-приложения — **consumed Project B** (composer) при composition; nestjs-function builder его **не интерпретирует**. Builder валидирует только свои известные поля и **игнорирует неизвестные top-level ключи** (коэкзистенция с B-shared полями в одном `build_config`).

### Builder `docker`

Вход — `BuildContext`; схема `build_config` (app-level, `analytics/build_config.yaml`, IDEA §6 — после интерполяции pilot'ом значения literal):

```yaml
build_config:
  image:
    repository: "cr.yandex/ya_mob_ya_lublu_yandex"
    tag: "v1.2.3"
  dockerfile: "Dockerfile"          # relative к sourcePath; default "Dockerfile"
```

- Flow (IDEA §37): `docker build <sourcePath>` (dockerfile path из конфига) → `docker push <repository>:<tag>` → резолв digest → `Artifact`.
- Артефакт всегда содержит **иммутабельную** ссылку `cr.yandex/...@sha256:...`; mutable-тег (`latest`) — только промежуточный для push, в `Artifact.value.image` **не попадает** (IDEA §37: «желательно immutable reference» — здесь усилено до MUST как forward contract для 019). Если digest не резолвится после push → fail-fast `BLC_IMAGE_DIGEST_UNAVAILABLE`.
- Credentials: строго из CI/build-окружения через Docker CLI (credential helper / `docker login` / `DOCKER_*` env), **никогда** не в `build_config` и не в `buildEnv` (IDEA §6: «Credentials не должны попадать в build config»; §37: «Credentials остаются в CI/build environment»). A не меняется.
- Builder вызывает `docker` CLI как внешний executable (аналогия с тонким оркестрационным слоем Constitution II: обвязка CLI покрывается characterization-тестами постфактум).
- `Artifact { type: 'ycforge:docker-image', value: { image: "cr.yandex/...@sha256:..." } }`.

### Builder `vite`

Вход — `BuildContext` (sourcePath = каталог frontend-app); схема `build_config` (app-level, `frontend/build_config.yaml`; описывает frontend build, IDEA §36):

```yaml
build_config:
  out_dir: dist             # optional; default "dist" (относительно sourcePath)
  root: "."                 # optional; vite root (default ".")
  command: "vite build"     # optional; default "vite build"
```

- Выполняет сборку frontend в `sourcePath` с `buildEnv`, инжектированным в окружение build-процесса (build-time/public data, IDEA §36: `YANDEX_ID_APP_ID` и т.п.). Внешние неявные источники окружения не подключаются (Constitution V).
- Копирует/размещает собранный статический вывод в `BuildContext.outputDir`.
- Возвращает `Artifact { type: 'ycforge:frontend', value: { directory: <abs путь к собранному статическому выводу> } }` (IDEA §8: Frontend → `{ directory }`).
- Secrets: в frontend `build_config`/`buildEnv` — запрещены (Constitution: «не в frontend bundle»); suspicious-key детекция (`SECRET`/`PASSWORD`/`TOKEN`) — зона `ycsf check` (spec 020), не этого builder-а. Механизма `fromDeployment` нет (IDEA §36).

### Scope boundaries (Out of Scope)

| What | Why out of scope | Owner |
|------|------------------|-------|
| Materializers для артефактных типов (`yandex_function`, `yandex_serverless_container`, `yandex_storage_object`) | Forward contract определён здесь; реализация — spec 019 | materializers-yandex |
| Packaging `@ycforge/ycsf-api` как builder-плагин (Project B) | Намеренно отложено (spec 013 boundary; spec 018/future) | builders-core/future |
| Builder execution / orchestration в C (`ycsf build`) | Spec 021 (потребляет `Artifact` реального build-времени) | ycsf-cli |
| Dispatch materializers / `.tf.json` serialization | Spec 014 (уже реализован) | materializer-dispatch |
| `ycsf check` suspicious-key warnings для frontend env | Spec 020 | ycsf-check |
| Инкрементальная сборка / content-addressable кэш артефактов | Spec 022; builder-ы детерминированы, кэш — C | incremental-builds |
| Local dev server / payload 2.0 эмуляция | Spec 023 | local-dev-server |
| Union исторических builder-ов (`go-function`, `python-function`) | Не в волне 3; registry допускает, но пакетов нет | future |
| Интерполяция `{{$ENV}}` на стороне builder-а | D-3: зона pilot (spec 012); builder-ы получают разрешённые значения | build-env |
| Default values для `{{$ENV}}` | Constitution V: все обязательны | — |

---

## User Scenarios & Testing

### User Story 1 — DevOps собирает NestJS-функцию (Priority: P1)

DevOps с app `user_service` (builder: `nestjs-function`) вызывает builder с `BuildContext` (sourcePath = `user_service`, buildConfig = схема из §Scope, outputDir задан). Builder бандлит приложение в self-contained архив и возвращает `Artifact` типа `ycforge:function`: `{ archivePath, entryPoint }`, на который сможет опираться materializer spec 019.

**Why this priority**: функция — базовый деплой-таргет serverless-tools; без работающего nestjs-function builder-а не собирается основной канонический app.

**Independent Test**: Вызвать `build()` на fixture NestJS-проекта; проверить, что вернулся `Artifact { type: 'ycforge:function', value: { archivePath: <существующий .zip в outputDir>, entryPoint: <string> } }`.

**Acceptance Scenarios**:

1. **Given** NestJS-проект с `build_config: { entry: "src/main.ts" }` и пустым `external`, **When** вызывается `build()`, **Then** результат — `Artifact.type === 'ycforge:function'`; `value.archivePath` — существующий файл `.zip` внутри `outputDir`; `value.entryPoint` — непустая строка.
2. **Given** проект с `external: ["sharp"]`, **When** выполняется build, **Then** `sharp`-импорт остаётся external (не бандлится), остальное бандлится; сборка успешна.
3. **Given** `build_config` с неизвестным top-level ключом (например `openapi_entry`), **When** выполняется build, **Then** builder игнорирует неизвестный ключ и собирает приложение без ошибок (коэкзистенция с B-shared полями).
4. **Given** `build_config: { entry: "src/nonexistent.ts" }`, **When** выполняется build, **Then** fail-fast: `BLC_ENTRY_NOT_FOUND`; Артифакт не создан.

---

### User Story 2 — DevOps публикует Docker-образ с иммутабельной ссылкой (Priority: P1)

DevOps с app `analytics` (builder: `docker`, buildConfig после pilot-интерполяции: `image.repository`, `image.tag`, `dockerfile`) вызывает builder. Builder выполняет `docker build` и `docker push`, резолвит digest и возвращает `Artifact { type: 'ycforge:docker-image', value: { image: "cr.yandex/...@sha256:..." } }`.

**Why this priority**: serverless container — полноценный деплой-таргет (IDEA §37); digest-ссылка — требование воспроизводимости и forward contract для 019.

**Independent Test**: Вызвать `build()` на fixture Docker-проекта с docker (CLI) в окружении; проверить, что `Artifact.value.image` — digest-form ссылка (`@sha256:`), а не `latest`-тег.

**Acceptance Scenarios**:

1. **Given** `build_config: { image: { repository: "test.local/app", tag: "v1" }, dockerfile: "Dockerfile" }` и доступный docker, **When** выполняется build, **Then** `Artifact.type === 'ycforge:docker-image'`; `value.image` матчит `/@sha256:[a-f0-9]{64}$/`.
2. **Given** push успешен, но digest не резолвится из реестра, **When** выполняется build, **Then** fail-fast `BLC_IMAGE_DIGEST_UNAVAILABLE`; `Artifact` не возвращается.
3. **Given** в `buildEnv/build_config` присутствуют потенциальные credential-значения, **When** выполняется build, **Then** builder не использует их для аутентификации (credentials берутся из Docker CLI/CI env); сам факт их наличия в config не является ошибкой.
4. **Given** `dockerfile` указывает на несуществующий файл, **When** выполняется build, **Then** fail-fast `BLC_BUILD_FAILED` с кодом docker CLI; частичного артефакта нет.

---

### User Story 3 — DevOps собирает frontend (Priority: P1)

DevOps с app `frontend` (builder: `vite`) вызывает builder. Builder выполняет сборку (с `YANDEX_ID_APP_ID` из `buildEnv`, как build-time/public data), размещает статический вывод в `outputDir` и возвращает `Artifact { type: 'ycforge:frontend', value: { directory } }` — вход для будущего bucket-materializer.

**Why this priority**: frontend — обычный app (IDEA §36); без vite builder-а канонический проект не собирается полностью.

**Independent Test**: Вызвать `build()` на fixture vite-проекта; проверить, что вернулся `Artifact` типа `ycforge:frontend`, а `value.directory` — существующий каталог со статическими файлами.

**Acceptance Scenarios**:

1. **Given** vite-проект с `build_config: { out_dir: "dist" }` и `buildEnv: { YANDEX_ID_APP_ID: "abc" }`, **When** выполняется build, **Then** `Artifact.type === 'ycforge:frontend'`; `value.directory` — существующий каталог; сборка использует `YANDEX_ID_APP_ID=abc` (observable в выведенном bundle).
2. **Given** пустой `build_config` (только defaults), **When** выполняется build, **Then** builder применяет defaults (`out_dir: dist`) и возвращает корректный артефакт.
3. **Given** `build_config: { out_dir: "dist" }` без сборки (фиктивный vite без конфигурации), **When** выполняется build, **Then** fail-fast `BLC_BUILD_FAILED`; артефакт не создан.
4. **Given** `value.directory` после сборки, **When** каталог читается, **Then** не содержит никаких файлов исходников/секретов (только собранные статические ассеты).

---

### User Story 4 — Core builders загружаются registry по subpath (Priority: P2)

DevOps указывает в `.ycsf/builders.yaml` три builder-а на подпути `@ycforge/builders-core/*`. Registry (spec 013) загружает три модуля через dynamic `import()` и распознаёт каждый по shape (`build: Function`) как `kind: 'builder'`.

**Why this priority**: D-1 (единый пакет) обязан быть совместим с механизмом загрузки 013; подпуть — официальный edge case 013.

**Independent Test**: В репо, где установлен `@ycforge/builders-core`, выполнить загрузку registry с тремя subpath-спецификаторами; проверить, что `records.get(id).kind === 'builder'` и нет `BRG_*` ошибок.

**Acceptance Scenarios**:

1. **Given** `builders.yaml` с `nestjs-function: "@ycforge/builders-core/nestjs-function"`, `docker: "@ycforge/builders-core/docker"`, `vite: "@ycforge/builders-core/vite"`, **When** registry загружается, **Then** три записи с `kind: 'builder'`; ошибок загрузки нет.
2. **Given** тот же registry и проект с apps `user_service/analytics/frontend` (соответствующие builders), **When** выполняется `validateBuilders` (013), **Then** ошибок нет (все builder-ы известны).
3. **Given** импорт любого subpath-модуля пакета, **When** модуль инспектируется, **Then** default export — объект с методом `build` (spec-002 Builder shape).

---

### User Story 5 — Fail-fast на неразрешённом `{{$ENV}}` (Priority: P2)

Из-за регрессии апстрима (spec 012) builder получил `buildConfig`/`buildEnv` с остаточным `{{$...}}`. Builder обязан не интерполировать самостоятельно, а fail-fast с `BLC_ENV_NOT_RESOLVED` (Constitution V: явное вместо магии).

**Why this priority**: D-3 — граница интерполяции; builder не должен молча подменять значения или собирать с raw-ссылками.

**Independent Test**: Вызвать `build()` каждого builder-а с `buildConfig`, содержащим строку `{{$SOMETHING}}`; убедиться, что builder завершился ошибкой `BLC_ENV_NOT_RESOLVED` без создания артефакта.

**Acceptance Scenarios**:

1. **Given** nestjs-function build с `build_config: { entry: "{{$ENTRY}}" }`, **When** выполняется build, **Then** fail-fast `BLC_ENV_NOT_RESOLVED`; `.zip` не создан.
2. **Given** docker build с `build_config: { image: { tag: "{{$TAG}}" } }`, **When** выполняется build, **Then** fail-fast `BLC_ENV_NOT_RESOLVED`; push/image не выполняются.
3. **Given** vite build с `buildEnv: { GREETING: "{{$GREETING}}" }`, **When** выполняется build, **Then** fail-fast `BLC_ENV_NOT_RESOLVED`; статический вывод не создан (или контрактно не используется).

---

### Edge Cases

- **`sourcePath` отсутствует**: builder-ы должны работать без `sourcePath`, читая конфигурацию из `projectRoot` (spec 002: `sourcePath?:` optional). Для реализуемых builder-ов отсутствие `sourcePath` → error `BLC_MISSING_SOURCE` (вывод/context/push неоднозначны).
- **Пустой `build_config`**: nestjs-function и vite применяют defaults (`entry: src/main.ts`, `out_dir: dist`); docker требует `image.repository` → `BLC_INVALID_CONFIG` (нет разумного дефолта для реестра).
- **Неизвестные top-level ключи в `build_config`**: игнорируются всеми builder-ами (коэкзистенция с B-shared полями, например `openapi_entry` у function-app).
- **Некорректный тип поля в известном ключе** (например `external: "string"` вместо массива): `BLC_INVALID_CONFIG`.
- **Остаточный `{{$...}}` в `buildConfig`/`buildEnv`**: `BLC_ENV_NOT_RESOLVED` (D-3), без самостоятельной интерполяции.
- **Дублирующийся артефакт в outputDir**: builder детерминирован; перезапись уже существующего артефакта допустима (версии/кэш — spec 022, C-side).
- **Директory `outputDir` не существует**: builder создаёт его (рекурсивно) перед записью; иначе — `BLC_BUILD_FAILED`.
- **Docker CLI недоступен / не в PATH**: `BLC_BUILD_FAILED` (или код CLI wrapper) с диагностикой.
- **Digest недоступен после push**: `BLC_IMAGE_DIGEST_UNAVAILABLE` (Artifact не возвращается; mutable-тег в value не допускается).
- **Frontend env с suspicious-ключами (`SECRET`/`TOKEN`/`PASSWORD`)**: builder не блокирует (детекция — spec 020, `ycsf check`); builder передаёт buildEnv в процесс сборки как есть.
- **Один builder для нескольких apps**: отдельная инвокация на каждый app; builder-ы stateless между инвокациями (одна — один Artifact, spec 002).

---

## Requirements

### Functional Requirements

**Пакет и регистрация**

- **FR-001**: Пакет `@ycforge/builders-core` MUST экспортировать три Builder-модуля через subpath exports `/nestjs-function`, `/docker`, `/vite`; каждый модуль default-экспортирует объект spec-002 `Builder` shape (`build: Function`), так что registry (013) распознаёт его как `kind: 'builder'`.
- **FR-002**: Каждый builder MUST работать от одного только `BuildContext` (spec 002: `projectRoot`, `sourcePath?`, `buildConfig`, `buildEnv`, `outputDir`) без знания внутренностей pilot (Constitution I); статистически или через типы проверяется отсутствие импортов pilot-runtime.
- **FR-003**: Пакет MUST экспортировать machine-readable mapping «builder id → `Artifact.type`» (каталог: `nestjs-function → ycforge:function`, `docker → ycforge:docker-image`, `vite → ycforge:frontend`) как часть публичного контракта пакета для C/021/019.

**nestjs-function**

- **FR-004**: Builder MUST валидировать свою `build_config`-схему (`entry?`, `runtime?`, `external?`, `out_filename?`): некорректный тип значения известного поля → error `BLC_INVALID_CONFIG`; неизвестные top-level ключи игнорируются; пустой конфиг → defaults (`entry: src/main.ts`, `out_filename: function.zip`).
- **FR-005**: Builder MUST бандлить app из `sourcePath` (или `projectRoot`) в единый self-contained вывод без сборки «по месту» (tree-shaking, никаких внешних runtime-зависимостей кроме объявленных в `external`); `external` НЕ бандлится.
- **FR-006**: Builder MUST упаковать вывод в `.zip` в `BuildContext.outputDir` (создавая outputDir рекурсивно) и вернуть `Artifact { type: 'ycforge:function', value: { archivePath, entryPoint } }`, где `archivePath` — абсолютный путь к созданному архиву, `entryPoint` — непустой идентификатор хендлера.
- **FR-007**: Builder MUST fail-fast (`BLC_ENTRY_NOT_FOUND`, `BLC_BUILD_FAILED`) при отсутствии entry/bundle-ошибке; частичный артефакт не создаётся, `Artifact` не возвращается.
- **FR-008**: Builder MUST NOT интерпретировать поля, принадлежащие другим builder-ам/B (например `openapi_entry`): неизвестные top-level ключи игнорируются (FR-004).

**docker**

- **FR-009**: Builder MUST валидировать `build_config` (`image.repository` обязателен, `image.tag?`, `dockerfile?`): отсутствие `image.repository` → `BLC_INVALID_CONFIG`; `dockerfile`/`tag` имеют дефолты (`Dockerfile`, значение из конфига или валидный тег).
- **FR-010**: Builder MUST выполнить `docker build` из `sourcePath` с указанным `dockerfile` и `docker push <repository>:<tag>` через Docker CLI (внешний executable; обвязка — характеристические тесты, Constitution II exception).
- **FR-011**: Builder MUST вернуть `Artifact { type: 'ycforge:docker-image', value: { image } }`, где `image` — **иммутабельная** ссылка `cr.yandex/...@sha256:<digest>`; mutable-тег в `value.image` недопустим; если digest не резолвится после push → fail-fast `BLC_IMAGE_DIGEST_UNAVAILABLE`.
- **FR-012**: Builder MUST NOT использовать значения из `build_config`/`buildEnv` для аутентификации в реестре; credentials — только Docker CLI/CI окружение (credential helper, `docker login`, `DOCKER_*`); никакие secrets не пишутся в артефакт/конфиг.
- **FR-013**: Builder MUST fail-fast (`BLC_BUILD_FAILED`) при ошибке `docker build`/`docker push` или недоступности CLI; частичный/невалидный Artifact не возвращается.

**vite**

- **FR-014**: Builder MUST валидировать `build_config` (`out_dir?`, `root?`, `command?`): дефолты `dist`, `.`, `vite build`; некорректный тип → `BLC_INVALID_CONFIG`.
- **FR-015**: Builder MUST выполнить сборку в `sourcePath`, инжектируя `buildContext.buildEnv` в окружение build-процесса (и только его; никаких неявных внешних источников окружения — Constitution V).
- **FR-016**: Builder MUST разместить собранный статический вывод в `BuildContext.outputDir` и вернуть `Artifact { type: 'ycforge:frontend', value: { directory: <abs path> } }`, где `directory` — каталог со статическими ассетами (без исходников/секретов).
- **FR-017**: Builder MUST fail-fast (`BLC_BUILD_FAILED`) при ошибке сборки; неполный вывод не возвращается как артефакт.

**Граница интерполяции (D-3)**

- **FR-018**: Builder-ы MUST предполагать, что `buildConfig` и `buildEnv` **уже интерполированы** pilot-ом (spec 012); собственная интерполяция `{{$ENV}}` в builder-ах запрещена.
- **FR-019**: Builder-ы MUST fail-fast `BLC_ENV_NOT_RESOLVED` при любом остаточном `{{$...}}` во входных `buildConfig`/`buildEnv` (нарушение контракта апстрима), не выполняя сборку с raw-ссылками.
- **FR-020**: Нужные builder-у values окружения MUST читаться из `buildContext.buildEnv` (resolved `Record<string,string>`), а не из `process.env` напрямую, если переменная декларирована через `build_env`/`{{$ENV}}`.

### Key Entities

- **NestjsFunctionBuildConfig**: app-level `build_config` для `nestjs-function`. Поля: `entry: string` (default `src/main.ts`), `runtime: string` (default `nodejs20`), `external: string[]` (default `[]`), `out_filename: string` (default `function.zip`). Неизвестные top-level ключи разрешены (игнорируются).

- **DockerBuildConfig**: app-level `build_config` для `docker`. Поля: `image: { repository: string (обязателен), tag: string }`, `dockerfile: string` (default `Dockerfile`, relative к `sourcePath`). Credentials не являются частью конфига.

- **ViteBuildConfig**: app-level `build_config` для `vite`. Поля: `out_dir: string` (default `dist`), `root: string` (default `.`), `command: string` (default `vite build`).

- **Artifact-каталог (forward contract)**: таблица из §Scope: `<builder id> → <Artifact.type> → <Artifact.value shape>`. Машиночитаемый каталог как контракт пакета (FR-003).

- **Форма value артефакта функции** (`ycforge:function`): `{ archivePath: string; entryPoint: string }` — абсолютный путь к `.zip` в `outputDir` и идентификатор экспортированного хендлера (IDEA §8, 019 будет читать оба поля).

- **Форма value артефакта docker-образа** (`ycforge:docker-image`): `{ image: string }` — digest-form ссылка `cr.yandex/…@sha256:…` (IDEA §8/§37; immutable).

- **Форма value артефакта frontend** (`ycforge:frontend`): `{ directory: string }` — абсолютный путь к каталогу собранных статических ассетов (IDEA §8/§36).

- **Диагностики builder-а**: каталог `BLC_*`: `BLC_INVALID_CONFIG`, `BLC_MISSING_SOURCE`, `BLC_ENTRY_NOT_FOUND`, `BLC_BUILD_FAILED`, `BLC_ENV_NOT_RESOLVED`, `BLC_IMAGE_DIGEST_UNAVAILABLE`, `BLC_ARCHIVE_FAILED` — мachine-readable, согласованы с форматом `ProjectModelDiagnostic` (spec 011) в части app/field/variable применительно к builder-контексту.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Для канонического reference-проекта каждый из трёх builder-ов возвращает `Artifact` объявленного типа без участия C: `ycforge:function` (.zip + entryPoint), `ycforge:docker-image` (digest-ссылка), `ycforge:frontend` (каталог статики) — проверяется структурными тестами.
- **SC-002**: Registry (spec 013) загружает все три модуля `@ycforge/builders-core/*` по subpath-спецификаторам без `BRG_*` ошибок и классифицирует как builders; `validateBuilders` (013) для `user_service`/`analytics`/`frontend` — без ошибок.
- **SC-003**: Каждый builder работает только от `BuildContext` (standalone-вызов вне pilot подтверждён тестом); детерминизм: идентичные входы → бинарно идентичный артефакт (кроме нестабильных digest, зависящих от registry).
- **SC-004**: Docker builder в 100% инвокаций возвращает иммутабельный digest-образ `…@sha256:…`; ни один артефакт не содержит mutable-тега `latest` в `value.image`.
- **SC-005**: Ноль остаточных `{{$ENV}}`-строк достигают или проходят через builder-ы: если остаточная ссылка появляется во входе — fail-fast `BLC_ENV_NOT_RESOLVED`, сборка не выполняется.
- **SC-006**: nestjs-function архив — self-contained: распакованный вход бандла не ссылается на unbundled runtime-модули вне списка `external` (проверяется структурным тестом).
- **SC-007**: 100% acceptance criteria spec 018 покрыты тестами (Constitution II: каждый AC → ≥1 тест, RED → GREEN); `typecheck`/`lint` пакета `@ycforge/builders-core` — чисто.

---

## Assumptions

- **D-1 (packaging)**: единый пакет `@ycforge/builders-core` с subpath exports. Отклонение от illustrative-спецификаторов в примере spec 013 (`@ycforge/builder-nestjs-function` и т.п.) — контракт 013 допускает подпуть в package specifier; сам spec 013 не меняется. **Плановая фаза перепроверит выбор**.
- **D-2 (forward contract)**: `ycforge:function`/`ycforge:docker-image`/`ycforge:frontend` и их value-shapes фиксируются здесь как договор с spec 019; materializers — вне 018.
- **D-3 (env interpolation)**: buildConfig/buildEnv приходят интерполированными (spec 012); builder-ы не интерполируют; остаточный `{{$…}}` → `BLC_ENV_NOT_RESOLVED`.
- **BuildConfig opaque для C, но валидируется builder-ом по известным полям**; неизвестные top-level ключи игнорируются (коэкзистенция `openapi_entry` у function-app — поле consumed B, не nestjs-function builder-ом).
- **`docker` CLI доступен в build-окружении**; builder оборачивает его как внешний executable (характеризация обвязки — allowed Constitution II exception).
- **Digest-требование усилено до MUST** (IDEA §37 «желательно») как forward contract для 019 (immutable image reference) — планировщик может смягчить до SHOULD, если будут кейсы неподдерживающих digest реестров.
- **vite builder НЕ детектирует секреты в buildEnv** (это `ycsf check`, spec 020), но не кладёт buildEnv в метаданные/артефакты вне собранного bundle.
- **Артефакты не кэшируются между инвокациями** (детерминизм — contract; кэш — spec 022, C-side).
- **Каталог артефактных типов** реализуется как часть контракта пакета (константы/конфиг данных), не требует изменения контрактов pilot.
- **Стык с 014**: временный placeholder «`type` = builder id» в descriptor-логике 014 остаётся, но в 021 реальные артефакты будут иметь `Artifact.type` из каталога 018; mapping документирован.

---

## References

- Spec 002: pilot-contracts — `Builder`, `BuildContext` (projectRoot/sourcePath/buildConfig/buildEnv/outputDir), `Artifact`, `isArtifactType` (`artifact-type.ts`), грамматика `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*`
- Spec 011: project-model — `<app>/build_config.yaml`, `build_env`, канонический проект (`user_service`, `analytics`, `frontend`, `openapi`)
- Spec 012: build-env — интерполяция `{{$ENV}}` до builder-а, `buildEnv: Record<string,string>`, определяет D-3
- Spec 013: builder-registry — `.ycsf/builders.yaml`, subpath-допущение, shape detection, `BRG_*`, scope-boundary на создание builder-пакетов (→ 018)
- Spec 014: materializer-dispatch — placeholder-дескрипторы (`type` = builder id), `supports()/materialize()`, collision policy
- IDEA.md §5 (`.ycsf/apps.yaml`), §6 (build_config/build_env, `{{$ENV}}`, credentials), §8 (Artifact shapes: Function `archivePath/entryPoint`, Container `image`, Frontend `directory`), §21 (Builder registry; bundling/cold-start — зона builder-а), §36 (Frontend: vite, build-time env, запрет secrets), §37 (Serverless Containers: docker builder, immutable `@sha256:`)
- Constitution I (разделение A/B/C/Terraform), II (test-first; exception для тонкой обвязки CLI), III (версионирование контрактов), V (explicit over magic, fail-fast)

---

## Next Steps

1. `/speckit.plan` — технический дизайн: структура `packages/builders-core` (subpath exports, тsup), каталог `BLC_*`, схемы валидации build_config, обвязка `docker` CLI, zip-упаковка, каталог артефактных типов; повторная валидация D-1 (пакaging), D-2, D-3.
2. `/speckit.tasks` — разбивка на задачи с test-first (RED → GREEN) по acceptance criteria US1–US5.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — код, тесты, typecheck/lint.
5. Согласование с spec 019 (materializer-ы потребляют артефактные типы 018) и spec 021 (реальные артефакты).