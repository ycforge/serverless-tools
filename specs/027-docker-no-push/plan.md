# Implementation Plan: docker-no-push — локальная сборка `ycforge:docker-image` без публикации в registry

**Branch**: `027-docker-no-push` | **Date**: 2026-09-13 | **Spec**: [specs/027-docker-no-push/spec.md](./spec.md)

**Input**: spec 027 (FR-001..FR-008, US-1..US-5, D-1..D-6, A-1..A-8, NG-1..NG-8, SC-001..SC-007) + checklists/requirements.md (16/16 pass). Контекст BIG-5 («docker build+push неразделимы») — из spec 027 §1/§3, проверено по коду (2026-09-13). Примечание: `specs/024-e2e-reference/plan.md` ещё не существует (024 — ⬜ в roadmap, как и зафиксировано в 025 Conjoined Change); вся фактура BIG-5 уже инкапсулирована в spec 027, внешний план не требуется.

## Summary

Docker builder (`packages/builders-core`, subpath `./docker`) сегодня резолвит digest строго через registry-путь: `src/docker/index.ts:16-22` → `buildAndPush` (`src/docker/cli.ts:56-99`) = `docker build` → `docker push <repo>:<tag>` → digest из push-output → fallback `docker image inspect --format '{{index .RepoDigests 0}}'`. Опции «собрать без push» нет; локальную сборку (reference-проект 024, контейнер `analytics`) пройти невозможно без credentials/registry.

Spec 027 добавляет **аддитивную опцию `image.no_push: boolean`** (default `false`): при `true` — only-build режим:

1. `docker build` выполняется как обычно (`-f dockerfile -t <repository>:<tag> <sourcePath>`, tag-семантика неизменна, D-5) — **ни одного `docker push`**;
2. digest резолвится из локального daemon через `docker image inspect --format '{{.Id}}' <repository>:<tag>` — image ID (`sha256:<hex64>`) локально построенного образа, content-адресуемый и детерминированный для идентичных входов (SC-003). `RepoDigests` в no-push-ветке **НЕ используется** (у непушенного образа пуст — тихая поломка, митигируется по spec §12);
3. возвращается прежний `Artifact { type: 'ycforge:docker-image', value: { image: "<repository>@sha256:<hex64>" } }` — инвариант «never a mutable tag» (018/019) сохраняется, mutable-тег в `value.image` не попадает (FR-003, US-2).

Push-режим по умолчанию **не меняется**: без `no_push`/`false` — ровно текущий build→push→digest→artifact, включая fallback `image inspect`/`BLC_IMAGE_DIGEST_UNAVAILABLE` (FR-007, SC-005). Fail-fast — существующие коды `BLC_BUILD_FAILED` (CLI/daemon/build-провал, tail stderr) и `BLC_IMAGE_DIGEST_UNAVAILABLE` (build ok, локальный digest не получен, message с локальным scope); новые коды не вводятся (D-4).

**0 правок вне `packages/builders-core`** (D-6, NG-3/4/5): pilot передаёт `build_config` opaque (`packages/pilot/src/build/index.ts:277`), C не знает полей docker builder; материализатор `yandex_serverless_container` потребляет `value.image` as-is (`packages/materializers-core/src/yandex-serverless-container/index.ts:10-30`); composer/.ycsf-форматы не трогаются.

**Hermetic-тесты** — через существующий fake-docker (PATH-injection, characterization, Constitution II exception, как в 018): расширение `test/helpers/fake-bins.ts` режимом локального digest + журнал argv как доказательство «push не вызывался». На машине автора docker daemon выключен (проверено: `docker info` → connect error, `unix:///Users/mimbol/.docker/run/docker.sock` отсутствует) — ни один unit-тест не обращается к реальному docker (SC-001/SC-002 доказываются журналом argv, без сети).

## Technical Context

**Language/Version**: TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node 22+ ESM (`"type": "module"`), сборка tsup (entries `index` + `docker/index`), vitest. Меняется только `packages/builders-core`.

**Primary Dependencies**: runtime — без новых (существующая единственная runtime-зависимость `esbuild`; docker-инвокация — через `node:child_process` `spawn`, `@types/node` в devDeps). Никакого docker-мока/эмулятора в зависимости: hermetic-подход — fake **бинарник** `docker` в PATH (тестовый хост-хелпер, не npm-пакет).

**Storage**: только чтение build_config (opaque `unknown` из `BuildContext.buildConfig`) и вызов локального docker daemon. Запись — как и у docker builder сегодня: `docker build` пишет образ в локальный daemon (NG-2: ни собственного registry, ни оффлайн-дистрибуции).

**Testing**: Vitest, test-first (Constitution II). RED→GREEN на каждый FR-001..008 / US-1..5. Docker CLI-оркестрация — characterization через fake (exception II, тот же подход, что в 018). Тип-тесты: vitest `typecheck` (`test/types/**/*.test-d.ts`, включён в `vitest.config.ts`). Команды: `pnpm --filter @ycforge/builders-core exec vitest run` (без сборки) и `pnpm --filter @ycforge/builders-core typecheck` (`tsc --noEmit`). Базлайн на старте: `docker.spec.ts` + `builders-core.test-d.ts` — 19/19 зелёных (проверено прогоном перед фиксацией проджекта).

**Target Platform**: `@ycforge/builders-core/docker` (subpath default-export Builder, зарегистрирован в реестре 013 по `modulePath`) — вызывается и напрямую (API builder'а), и через `ycsf build` (pilot, `build_config` прокидывается opaque). Никакого нового пакета/CLI.

**Project Type**: library (builder-плагин). Rule Constitution I: A owns runtime, B — composition, C — orchestration, Terraform — provisioning — docker builder остаётся внутри builders-core (A-уровень build-артефакта? нет: builder — build-инструмент, не рантайм A; spec 018 фиксирует builders-core как передний слой сборки). Смежники не затронуты.

**Performance Goals**: SC-003 — детерминизм digest для идентичных входов (image ID); SC-001 — артефакт без сети/registry; нулевых лишних CLI-вызовов в no-push: ровно `build` + `image inspect` (2 subprocess'а, как в push-пути с fallback — структурно симметрично).

**Constraints**: Constitution III — только аддитивные изменения (`DockerBuildConfig.image` += `no_push?: boolean`, JSON-schema `dockerBuildConfig` += свойство `no_push`, `BuildAndPushOptions` += `noPush?: boolean`); `DockerArtifactValue` и `value.image`-формат не меняются (NG-1); константы `BLC_*` не переименовываются/не удаляются (D-4); Constitution V — fail-fast (ни одного partial-артефакта, ни одного тихого пропуска), строго-булевый `no_push` без угадывания (FR-006, edge §8); NG-1..NG-8 соблюдены (формат image-string, registry, материализаторы, vite/nestjs-function, pilot/composer, daemon-менеджмент, push-семантика, деплой — вне).

**Scale/Scope**: `packages/builders-core` только: 3 src-файла docker (config.ts, cli.ts, index.ts) + 1 тип (`types.ts`) + 1 JSON-контракт (in repo spec 018). Тесты: +1 describe-блок в `docker.spec.ts`, +опции `fake-bins.ts`, +тип-тесты test-d, +1 audit-тест контракт-JSON, опционально gated интеграция. 0 правок существующих тестов.

## Constitution Check

*GATE: Passed до Phase 0 (по фактуре spec); re-checked после Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Работает только `packages/builders-core` (builder — build-инструмент; A/B/C/Terraform-границы не пересекаются). Pilot не знает про `no_push` — `build_config` opaque (`pilot/src/build/index.ts:277`), C-schema не трогается (D-6). Материализаторы/composer/`.ycsf` не редактируются (NG-3/5). Terraform/registries не затронуты. |
| II. Spec-First, Test-First | ✅ PASS | Каждый FR-001..008 → ≥1 тест RED→GREEN (§ «Traceability»). Docker CLI-оркестрация — тонкий слой инвокации CLI → characterization через fake-docker (exception II, «как в 018», spec §13). |
| III. Contracts Versioned | ✅ PASS | `DockerBuildConfig`/`dockerBuildConfig` расширены только optional-полем `image.no_push`; `DockerArtifactValue`, artifact-формат, `.ycsf` `version: 1`, `@ycforge/pilot/contracts` — без изменений. `BLC_IMAGE_DIGEST_UNAVAILABLE` — только расширение description в JSON-schema (const frozen) (SC-007). |
| IV. Terraform Stays Terraform | ✅ PASS | Неприменимо: build-стадия, provisioning/`.tf`/state не затрагиваются. |
| V. Explicit Over Magic | ✅ PASS | Fail-fast: `no_push` строго boolean (иначе `BLC_INVALID_CONFIG` поле `image.no_push`, edge §8, FR-006); локальный digest — строго локальный источник `{{.Id}}`, `RepoDigests` в no-push-ветке не читается (риск «ambiguity digest-источника», митигейт); нет «предупреждение-но-продолжить»; константы кодов не меняются. |
| VI. Ownership: apps=managed | ✅ PASS | Не меняется: app-level `build_config` валидируется только docker builder'ом; C-ownership/реестры не затрагиваются. |
| Monorepo Tooling | ✅ PASS | Один пакет; тесты рядом с существующими (`test/unit`, `test/helpers`, `test/types`); vitest + tsc; новых зависимостей нет; докер-фейк — тестовый bash-бинарник, не пакет. |

**Deviations**: нет. Ничего из сделанного не требует правки spec; все развилки закрыты системными решениями плана (P-1..P-5 ниже), согласованными с D-1..D-6/A-1..A-8.

**Gate Decision**: All gates PASS. Phase 1 re-check: аддитивность подтверждена фактурой кода — `BuildAndPushOptions` (internal), `DockerBuildConfig` (public type, optional-поле), `dockerBuildConfig` JSON (свойство добавляется; `additionalProperties: false` у `image` требует именно аддитивного добавления свойства в `properties`, без изменения существующих). Пишеться контракт-агрегат (test-d) и JSON-audit для SC-007.

## Проект — контрактные решения плана (модульный уровень, в дополнение к D-1..D-6)

> D-1..D-6 — решения spec (расположение/имя опции, additive contract, локальный digest, fail-fast, tag-семантика, 0 правок C/B/materializers). Ниже — конкретизация механизмов под код.

- **P-1 (способ разрешения локального digest: `image inspect --format '{{.Id}}'`)**. После успешного `docker build` выполняется ровно один `docker image inspect --format '{{.Id}}' <repository>:<tag>`; из вывода детерминированно извлекается первый match `/sha256:[0-9a-f]{64}/` (edge §8 «inspect возвращает несколько строк/digest»). `.Id` (image ID = content-digest конфига+слоёв) есть всегда у существующего локального образа, в отличие от `RepoDigests` (пустого до push). Намеренно **не** `{{index .RepoDigests 0}}`: требование D-3 «локальный источник, не registry». Эквивалентные источники по spec (build-output / `--iidfile`) отклонены в пользу `.Id`: минимальный CLI-набор, структурная симметрия с существующим fallback-инспектом (тот же subcommand `image inspect`, другая format-строка), простейший детерминированный парсинг. Ограничение фиксируется: локальный image-ID не обязан равняться будущему registry manifest-digest (A-2/D-3/NG-8) — артефакт остаётся честным (immutable content-ссылка локального содержимого), pullability не декларируется.
- **P-2 (механика опции в CLI-слое)**. `BuildAndPushOptions` += `readonly noPush?: boolean` (internal; default false). В `buildAndPush` при `noPush` — ветка «build → `image inspect .Id` → digest либо `BLC_IMAGE_DIGEST_UNAVAILABLE`(local-scope message)»; `push` не инвоцируется. Push-ветка не переписывается (тела бит-в-бит сохраняются: FR-007). `digestFromPushOutput`, fallback-инспект `RepoDigests`, `tailStderr` — без изменений.
- **P-3 (валидация)**. `parseDockerConfig` возвращает `{ repository, tag, dockerfile, noPush: boolean }`; `noPush = imageRecord.no_push === undefined ? false : imageRecord.no_push`; `typeof noPush !== 'boolean'` → `BLC_INVALID_CONFIG` поле `image.no_push` (FR-006, edge: `"true"`/`1`/`null` — invalid). Порядок префлайтов сохраняется: `requireSourcePath` → `assertNoResidualEnv` (читает поля build_config, в т.ч. `no_push: "{{$X}}"` падёт `BLC_ENV_NOT_RESOLVED` раньше config-валидации — детерминированно, поведение не новое) → `parseDockerConfig` → CLI.
- **P-4 (fail-fast сообщения, D-4)**. CLI/daemon/build-провалы — существующий `BLC_BUILD_FAILED` + `tailStderr` (DQ-6, без правок); digest-недоступность после успешного no-push build — существующий `BLC_IMAGE_DIGEST_UNAVAILABLE` с message вида `local daemon digest could not be resolved for '<repo>:<tag>' (build succeeded, no-push mode)` (в push-ветке message прежний). Константа не меняется; в `builders-core.json` расширяется только `description` у `BLC_IMAGE_DIGEST_UNAVAILABLE` до обоих scope (audit-тест сверяет ключи — `diagnostics.test.ts:54`).
- **P-5 (hermetic-seam: без правок src)**. Существующий канал `spawn('docker', …)` уходит в PATH; hermetic-подход 018 (`withPath` + fake **bash-бинарник** docker) уже даёт требуемый шов без инъекции executor'а в src. Расширяется только тестовый хелпер `fakeDocker` (аддитивная опция `localId`), механизм реального daemon не требуется.

## Project Structure

### Documentation (this feature)

```text
specs/027-docker-no-push/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Авторитетный input
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (создаётся /speckit.tasks — НЕ здесь)
```

> Конвенция 025-цикла: research/data-model/quickstart/contracts как отдельные файлы не создаются — весь контент фаз 0/1 сведён в настоящий plan.md.

### Source Code (repository root) — только `packages/builders-core`

```text
packages/builders-core/src/
├── types.ts                  # ADD: DockerBuildConfig.image += readonly no_push?: boolean (комментарий-дефолт)
├── docker/
│   ├── config.ts             # ADD: noPush в ParsedDockerConfig + валидация boolean (image.no_push)
│   ├── cli.ts                # ADD: BuildAndPushOptions.noPush?; ветка noPush (build → inspect .Id); push-ветка неизменна
│   └── index.ts              # ADD: проброс noPush: config.noPush в buildAndPush
├── (diagnostics.ts, preflight.ts, env.ts, catalog.ts)  # БЕЗ изменений

packages/builders-core/test/
├── helpers/
│   └── fake-bins.ts          # ADD: FakeDockerOptions.localId?: string; image-ветка различает {{.Id}} / {{index .RepoDigests 0}}
├── unit/
│   └── docker.spec.ts        # ADD: describe «docker builder no-push (spec 027)» (существующие it не трогаются)
│   └── diagnostics.test.ts   # ADD: один audit-it «контракт-JSON аддитивен (no_push, const BLC unchanged)» (SC-007)
└── types/
    └── builders-core.test-d.ts  # ADD: no_push optional в DockerBuildConfig; заморозка DockerArtifactValue

specs/018-builders-core/contracts/builders-core.json   # ADD: image.properties.no_push; description у BLC_IMAGE_DIGEST_UNAVAILABLE
```

**Structure Decision**: in-place расширение трёх src-модулей docker + типа + контракт-JSON; новые тесты — аддитивные блоки в существующих файлах (заново импортируя локальные хелперы `ctx`/`expectBLC`/`readLogLines` из текущего `docker.spec.ts`, без рефакторинга существующих it). Никаких новых пакетов, плагинов, сервисов.

## Implementation Phases (RED → GREEN)

> Порядок фаз: контракт/конфиг (1) → локальный build-путь (2) → fail-fast (3) → compat/приёмка (4). Внутри каждой фазы сначала тесты (RED), затем реализация (GREEN). Thin CLI-оркестрация — characterization через fake (exception II).

### Phase 1 — Контракт и конфигурация (FR-001, FR-006, FR-008, SC-007)

**RED** (`test/types/builders-core.test-d.ts` + `test/unit/docker.spec.ts` + `test/unit/diagnostics.test.ts`, аддитивные блоки):
- test-d: `DockerBuildConfig` — литерал с `image: { repository, tag, no_push: true }` и `image: { repository }` без `no_push` — оба принимаются (optional); `no_push` негатив не компилируется (`"true"`/`1` неприсваиваем); заморозка `DockerArtifactValue`: `expectTypeOf<DockerArtifactValue>().toEqualTypeOf<{ readonly image: string }>()`.
- unit `docker.spec.ts` (+cases в new describe):
  - `BLC_INVALID_CONFIG`: `no_push: "true"`, `no_push: 1`, `no_push: null` → code `BLC_INVALID_CONFIG`, `err.field === 'image.no_push'`, argv журнала пуст (CLI не вызван), push отсутствует.
  - `BLC_INVALID_CONFIG`: `no_push: true` без `image.repository` → `BLC_INVALID_CONFIG` (repository обязателен в обоих режимах, FR-006).
  - coexistence: известные top-level-ключи (напр. `exec_timeout: 30`) продолжают игнорироваться и при `no_push: true`.
- audit (`diagnostics.test.ts`, add it): чтение `specs/018-builders-core/contracts/builders-core.json` → `image.properties.no_push` существует `{ type: 'boolean', default: false }`; `image.properties.repository`/`tag` присутствуют и неизменны (аддитивность); `image.additionalProperties === false`; `errorCodes.properties.BLC_IMAGE_DIGEST_UNAVAILABLE.const` совпадает с константой модуля; ключи `errorCodes.properties` — набор равен EXPORTED (без правки существующего теста).

**GREEN**:
- `types.ts:65-68`: `image?: { readonly repository: string; readonly tag?: string; readonly no_push?: boolean }` (комментарий «default false; only-build режим, spec 027»).
- `docker/config.ts`: `ParsedDockerConfig` += `readonly noPush: boolean`; `const raw = imageRecord.no_push; const noPush = raw === undefined ? false : raw; if (typeof noPush !== 'boolean') invalid('image.no_push')`.
- `specs/018-builders-core/contracts/builders-core.json`: `image.properties` += `no_push: { type: 'boolean', default: false }`; `errorCodes.properties.BLC_IMAGE_DIGEST_UNAVAILABLE.description` += локальный scope (const не меняется).

**Verification**: `pnpm --filter @ycforge/builders-core exec vitest run test/unit/docker.spec.ts test/types/builders-core.test-d.ts test/unit/diagnostics.test.ts` — RED подтверждён до GREEN (ожидаемые failure'и), после — зелёный; `typecheck` — `tsc --noEmit` на packages/builders-core.

**Deliverables**: тип+JSON-контракт аддитивны; 4 новых теста-кейса (invalid-config ×3, coexistence) + test-d + audit-it.

### Phase 2 — Локальный build-путь без push (FR-002, FR-003, US-1, US-2, SC-001/002/003)

**RED** (`test/helpers/fake-bins.ts` сначала, затем новые case в `docker.spec.ts`):
- fake-bins: `FakeDockerOptions` += `readonly localId?: string` (64-hex без префикса `sha256:`); в `image`-ветке: если формат-арг (после `shift`: `$3`) содержит `.Id` → печать `sha256:${localId}` (пусто при отсутствии `localId`); иначе — прежнее поведение `inspectSha` (`[repo@sha:hex]`). Существующие mode-ветки (`build`/`push`/`image` при `RepoDigests`) не меняются.
- `docker.spec.ts`, describe «docker builder no-push (spec 027)»:
  1. **SC-001/AC1**: config `{ image: { repository: 'test.local/app', tag: 'v1', no_push: true }, dockerfile: 'Dockerfile' }`, fake `{ localId: hexA }` → `artifact.type === 'ycforge:docker-image'`, `image === 'test.local/app@sha256:<hexA>'`, матч `/@sha256:[a-f0-9]{64}$/`.
  2. **SC-002/AC2 «no push»**: журнал argv содержит `ARG build`, `ARG -f`, `ARG Dockerfile`, `ARG test.local/app:v1`, `ARG image`, `ARG {{.Id}}`, `ARG test.local/app:v1` (inspect-реф) — и **не содержит ни одной строки `ARG push`** и `ARG {{index .RepoDigests 0}}`.
  3. **SC-003/AC3**: дважды build идентичных входов → `image` совпадает посегментно (детерминизм).
  4. **US-2/AC2 tag-default**: config без `tag` + `no_push: true` → argv build содержит `test.local/app:latest` (локальная адресность сохранена, D-5), но `value.image` строго `test.local/app@sha256:<hex>` без `:latest`/`:v1`.
  5. **US-2/AC1 таблица форм**: набор конфигураций (tag `v1`; tag absent; repository-слэши) → `value.image` матчит `/^<repository>@sha256:[a-f0-9]{64}$/` и не содержит `:` перед `@`.
  6. **push-рулетки нет**: config **без** `no_push`, fake `{ localId: hexA }` → режим прежний: `ARG push` **присутствует**, digest из push-пути (`digest` опция), `{{.Id}}` в журнале **отсутствует** (SC-005: опция не активирует локальный путь при отсутствии).

**GREEN**:
- `cli.ts`: `BuildAndPushOptions` += `readonly noPush?: boolean`; в `buildAndPush` после успешного `build`: `if (options.noPush)` → `runDocker(['image','inspect','--format','{{.Id}}', ref])`; код 0 → первый match `/sha256:[0-9a-f]{64}/`; иначе (или нет match) → `BLC_IMAGE_DIGEST_UNAVAILABLE` с локальным message (P-4); push-ветка не вызывается. Push-ветка (строки 74-98) не редактируется.
- `index.ts:16-21`: передать `noPush: config.noPush` в `buildAndPush`.

**Verification**: RED-прогон фазы (новые case падают: локальный путь ещё не реализован, fake уже расширен) → GREEN после реализации; журнал argv доказывает «нет push»; tag-в-`value.image` отсутствует во всех табличных кейсах.

**Deliverables**: no-push build-путь; 6 новых тест-кейсов; расширенный fake.

### Phase 3 — Fail-fast диагностика (FR-004, FR-005, US-3, SC-004)

**RED** (`docker.spec.ts`, add cases в no-push describe):
- **AC1 CLI unavailable**: `process.env.PATH = <пустой tempdir>` (обход `withPath`: иначе настоящий docker в PATH перехватит) → build config `no_push: true` → `BLC_BUILD_FAILED`, message содержит «docker CLI unavailable»; `PATH` восстановить в `finally`.
- **AC2 daemon down**: fake `{ buildExit: 1, buildStderr: 'Cannot connect to the Docker daemon… Is the docker daemon running?\\n' }` → `BLC_BUILD_FAILED`, message содержит хвост stderr (daemon-диагностика видна), журнал argv не содержит `push`.
- **AC3 digest absent**: fake `{}` (build ok, `localId` не задан) → `BLC_IMAGE_DIGEST_UNAVAILABLE`, message упоминает локальный daemon/local scope; `Artifact` не возвращён (reject); argv — без `push`.
- **AC4**: во всех трёх провалах проверка журнала argv: `push` отсутствует (провал не маскируется push-попыткой).

**GREEN**:
- Сообщения и ветки уже реализованы в Phase 2 GREEN (единый проход): достаточно прогона RED-тестов на реализованном коде; при расхождении формулировок — правится только message (константы и логика не меняются).
- Дополнительно: unit-проверка, что в push-ветке `BLC_IMAGE_DIGEST_UNAVAILABLE`-message остался прежним (существующий it `:103-111` уже покрывает — verify-only).

**Verification**: 4 fail-fast кейса зелёные; ни одного частичного артефакта (все reject); полный прогон docker.spec.ts.

**Deliverables**: диагностика US-3; 4 тест-кейса.

### Phase 4 — Compat, интеграция (gated) и приёмка (FR-007, FR-008, SC-005/006, US-4/5)

**RED**:
- gated интеграция (опционально, не unit-CI): новый блок `test/unit/docker.spec.ts` (или отдельный `test/integration/docker-daemon.nopush.spec.ts`) под `describe.skipIf(!probeDockerDaemon())`, где `probeDockerDaemon()` = `docker info` exit 0 (на машине автора daemon выключен → пропускается осознанно, spec §13 «в текущем окружении пропускается осознанно»). Сценарий smoke: только-build реального `dockerFixture()` (Dockerfile на `node:22-alpine` требует network-pull → обернуть в `try/catch`-skip при сетевой недоступности), проверка артефакта digest-формы и отсутствия push в `docker history`. В unit-CI не выполняется.
- US-4/SC-006/FR-008 (hermetic, обязательные): 
  - credentials-путь в no-push: config `no_push: true`, `buildEnv` без секретов (и даже с `DOCKER_AUTH_TOKEN` — FR-012) → build успешен, argv/env журнала не содержат секретов; `push` отсутствует.
  - материализатор-совместимость: сгенерированный `value.image` в no-push — та же форма, что в push; verify-only: существующий тест инварианта (материализатор ест as-is) остаётся зелёным (materializers-core не менялись — проверка сборкой/прогоном e2e pilot не требуется; инвариант формы покрыт табличным тестом Phase 2).

**GREEN**: без изменений src в Phase 4 — прогон всех RED-тестов фаз 1-3 на реализованном коде до полного зелёного; полный набор пакета (`pnpm --filter @ycforge/builders-core exec vitest run` + `typecheck`); фиксация SC-001..SC-007.

**Verification**: SC-005 — весь прежний `docker.spec.ts` зелёный **без единой правки** (git diff тестовых файлов показывает только добавления); SC-007 — test-d + audit-it; gated smoke пропущен на текущей машине.

**Deliverables**: регрессионная сетка, документированные SC-001..SC-007, приёмка FR-001..008.

## Traceability (FR → тесты)

| FR | Тест (docker.spec.ts, no-push describe, кроме оговоренных) |
|---|---|
| FR-001 (опция `image.no_push`) | P1: test-d `DockerBuildConfig`; audit-it контракт-JSON |
| FR-002 (build без push, ни одного push) | P2: кейс 2 (argv без `ARG push`); P3: кейс 4 (провалы без push) |
| FR-003 (локальный digest, image-string инвариант) | P2: кейсы 1, 4, 5 (таблица форм: нет `:<tag>` перед `@`) |
| FR-004 (digest недоступен → BLC_IMAGE_DIGEST_UNAVAILABLE) | P3: кейс 3 |
| FR-005 (сборка невозможна → BLC_BUILD_FAILED, tail, без push) | P3: кейсы 1, 2, 4 |
| FR-006 (валидация: repository обязателен, no_push строго boolean) | P1: invalid-config ×3 (image.no_push), репозиторий absent |
| FR-007 (push-режим неизменен) | P2: кейс 6 (push присутствует при отсутствии no_push); verify-only: все прежние it |
| FR-008 (additive contract, заморозка value.image) | P1: test-d frozen `DockerArtifactValue`; audit-it JSON |
| SC-003 (детерминизм) | P2: кейс 3 |
| US-4 (CI build-only, без кредов) | P4: hermetic кейс (argv/env без секретов, без push) |
| SC-006 (материализатор as-is) | P2: кейс 5 (форма равна push-форме); verify-only materializers-compat |
| SC-005 | P4 gate: прежний docker.spec.ts без правок |

## Modified Tests

| Файл:строка | Тип правки | Причина |
|---|---|---|
| — (существующих тестов НЕ модифицируем) | none | SC-005/FR-007: весь прежний `docker.spec.ts` остаётся нетронутым (базлайн 19/19 подтверждён); ни один существующий `it` не переписывается |
| `test/helpers/fake-bins.ts` (`FakeDockerOptions`, image-ветка) | ADD (аддитивные опция + ветка) | hermetика no-push: локальный digest; существующие режимы/бейк-опции не меняются |
| `test/unit/docker.spec.ts` | ADD (новый describe «docker builder no-push (spec 027)», ~14 it) | FR-001..008/US-1..5 |
| `test/types/builders-core.test-d.ts` | ADD (docker-типы: no_push optional + frozen `DockerArtifactValue`) | SC-007 |
| `test/unit/diagnostics.test.ts` | ADD (один audit-it по контракт-JSON) | SC-007 (аддитивность схемы, const код) |
| `specs/018-builders-core/contracts/builders-core.json` | ADD (`image.properties.no_push`; description у BLC_IMAGE_DIGEST_UNAVAILABLE) | FR-001/SC-007 (без правки существующих свойств) |

## Additive-proofs

| Контракт / поверхность | Изменение | Аддитивность (чьё существующее использование не задето) |
|---|---|---|
| `DockerBuildConfig` (types.ts, экспорт `@ycforge/builders-core` root) | `image` += `readonly no_push?: boolean` | Optional-поле: существующие литералы `{ image: { repository } }`/`{ image: { repository, tag } }` (docker.spec.ts `ctx`, реестровые фикстуры) компилируются без правок |
| JSON-schema `dockerBuildConfig` (builders-core.json) | `image.properties` += `no_push: { type: 'boolean', default: false }` | Свойство добавляется в `properties` (требуется, т.к. `image.additionalProperties: false`); существующие свойства `repository`/`tag` не изменены; `dockerfile`, `required`, `additionalProperties` — без изменений; ранее валидные конфигурации остаются валидными |
| `BLC_IMAGE_DIGEST_UNAVAILABLE` (const + JSON description) | description расширен до локального scope | const frozen; `diagnostics.test.ts:54` сверяет ключи-набор и значения констант — только добавление description в JSON не ломает; message-строка push-ветки не меняется |
| `BuildAndPushOptions`/`ParsedDockerConfig` (cli.ts/config.ts, internal) | `noPush?: boolean` / `noPush: boolean` | internal (не экспорт публичного subpath); вызовы внутри `index.ts` — единственный consumer; push-ветка бит-в-бит |
| `DockerArtifactValue` / `value.image`-формат / `Artifact` | НЕ изменены | `@ycforge/builders-core/docker` возвращает ту же форму; `@ycforge/pilot/contracts`, `@ycforge/materializers-core` (типы + yandex-serverless-container), composer — 0 правок (NG-3/5/1) |
| `.ycsf/*.yaml` (version: 1), pilot `BuildContext.buildConfig`, registry/catalog, diagnostics `BLC_*` (прочие) | НЕ изменены | C-схема build_config opaque (D-6, `pilot/src/build/index.ts:277`); catalog/реестр 013 не трогаются |

**Гарантии**: не редактируются `BuildContext`, `Builder`, `Artifact`, `DockerArtifactValue`, `parseDockerConfig`-сигнатура для push (добавляется поле в результат, чтение старых полей сохраняется), `cli.ts` push-строки (74-98), диагностические константы, каталонический набор `ArtifactType`, materializers-core, pilot, composer.

## Conjoined Change

Ожидаемые изменения вне `packages/builders-core`: **НЕТ**. Сопутствующие обязательные заметки (без правок файлов):
- **NOTICE для 024 (вне 027)**: `specs/024-e2e-reference/plan.md` не существует (024 — ⬜); после 027 контейнер `analytics` reference-проекта получит возможность локальной сборки (`image.no_push: true`) — 027 предоставляет возможность, не правит 024 (A-7).
- **Потребители опции**: форматы `build_config` app-уровня (per-app `build_config.yaml`, versionless, spec 011) — аддитивное поле доезжает до builder'а без правок C; никаких предупреждений в `ycsf check` (suspicious-keys 025 denylist не включает `no_push` — проверка не требуется; имя не входит в EXACT/SUFFIX списки).
- **README пакета / документация**: ограничение A-2 («локальный digest ≠ будущий registry manifest-digest; no-push артефакт не обязан быть pullable до реального push»; NG-8) фиксируется в README `packages/builders-core` (docker-секция) — контент документируется в этом цикле в quickstart-style примечании плана (реальный README-текст — при /speckit.implement).

## Risks

| Риск (spec §12) | Оценка | Митигация в плане |
|---|---|---|
| **Локальный digest ≠ registry digest** (A-2/D-3): `.Id` локального образа не обязан совпадать с manifest-digest после реального push; пользователь может задеплоить no-push артефакт в облако, получив «другой» образ | Принят, обязательно документируется | P-1 закрепляет локальный источник; A-2/NG-8 в спецификации; README-примечание (Conjoined Change); имя опции `no_push` и default false противостоят «бесплатному push»; ни один тест не утверждает pullability |
| **Multi-arch / BuildKit**: builder не принимает `--platform`; при multi-arch-сборке (buildx) локальный `.Id` — единый content-id, не обязан соответствовать per-platform registry manifest; форматное поведение BuildKit может эволюционировать | Низкий для объёма 027 | NG-7: push/platform-семантика вне; 027 не добавляет platform-флагов; локальный build изначально single-arch (A-3); fail-fast при непредвиденном выводе (нет `sha256:` → `BLC_IMAGE_DIGEST_UNAVAILABLE`) |
| **`docker image inspect` на CI / стабильность вывода**: daemon обязан быть (build всё равно его требует, NG-6); формат `.Id` стабилен (docker 20.10+, включая присутствующий 29.5.2), но читается регэкспом. Родственный риск — «фантом-бесплатный push»/«фантом без push»: `no_push: true` случайно оставлен в проде → артефакт без registry-образа | Средний | Детерминированное извлечение первого match (P-1, edge §8); отказ → fail-fast `BLC_IMAGE_DIGEST_UNAVAILABLE`, не тихий успех; default false + документированные последствия (NG-8/A-5); митигейт решительно не вводит warns-and-continues |
| Fake-docker regression: расширение `image`-ветки может задеть fallback-инспект push-пути | Низкий | Диспатч по format-аргу (`{{.Id}}` vs RepoDigests) — старые ветки бит-в-бит; существующий FR-011 fallback-тест остаётся зелёным (P2 кейс 6 не трогает его) |

## Open Questions

1. **Формулировка message `BLC_IMAGE_DIGEST_UNAVAILABLE` (локальный scope)**: конкретный текст («local daemon digest could not be resolved…», без указания потенциальной причины) финализируется в /speckit.implement; константа и код не меняются (P-4). Единственная точка пересечения с прежним текстом — tests/README упоминания; проверяется grep'ом по прежнему message и подтверждается, что const-семантика сохранена.
2. **`{{.Id}}` vs `--iidfile`**: выбран `{{.Id}}` (P-1) — симметрия с существующим fallback и один CLI-вызов после build. Если интеграционный smoke на реальном daemon (Phase 4, gated) выявит неожиданности (например, желание читать `--iidfile` без отдельного inspect-вызова) — решение пересматривается аддитивно (добавлением `--iidfile` в build+read), это внутренняя деталь CLI-слоя, не контракт.
3. **Окружение git-branch/CI**: интеграционный smoke gated по `docker info`; в текущей среде и на unit-CI не выполняется (spec §13). Вопрос решается только тем, кто имеет право на daemon-раннер — вне данного цикла.

## Tasks Readiness

Готово к `/speckit.tasks`. Спецификация и план не содержат [NEEDS CLARIFICATION]; FR-001..FR-008 имеют test-first связки (Phases 1-4). Предварительный список задач:
- T1: аддитивность контракта — `DockerBuildConfig.no_push?` (types.ts) + JSON `image.properties.no_push` + description extension; test-d RED/GREEN + audit-it диагностики (Phase 1).
- T2: `parseDockerConfig` → `noPush` + строго-булевая валидация `image.no_push` (BLC_INVALID_CONFIG, field `image.no_push`) (Phase 1).
- T3: fake-bins — `localId` режим (format-диспатч `{{.Id}}`) (Phase 2 RED-инфра).
- T4: `cli.ts` no-push ветка (build → inspect `{{.Id}}` → BLC_IMAGE_DIGEST_UNAVAILABLE local) + `index.ts` проброс (Phases 2-3 GREEN).
- T5: docker.spec.ts no-push describe — happy/determinism/argv-no-push/table-форм (Phase 2) + fail-fast ×4 (Phase 3).
- T6: compat/US-4/SC-006 hermetic кейсы (credentials-путь, materializer-форма, push-рулетка) (Phases 2/4).
- T7: gated интеграционный smoke (`docker info`-skip) (Phase 4, опционально).
- T8: регрессия — полный `vitest run` + `typecheck` пакета; git-diff проверка «только добавления»; README-примечание A-2/NG-8 (Conjoined Change) (Phase 4).

**Notifications** (без правок файлов): 024 — notice: 027 предоставляет возможность локальной сборки (`image.no_push`), оформление reference-проекта остаётся зоной 024 (A-7). Требования checklist 16/16 pass; спецификация без [NEEDS CLARIFICATION].