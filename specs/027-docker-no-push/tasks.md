---
description: "Task list for docker-no-push — аддитивная опция image.no_push, локальная сборка ycforge:docker-image без push"
---

# Tasks: docker-no-push — `image.no_push`, локальная сборка `ycforge:docker-image` (digest из локального daemon)

**Input**: Design documents from `/specs/027-docker-no-push/`

**Prerequisites**: plan.md (required), spec.md (required), checklists/requirements.md (16/16 ✅)

**Tests**: Test-first per constitution (II). Каждый FR-001..FR-008 и US-1..US-5 → ≥1 тест (RED → GREEN). Docker CLI-инвокация — тонкий слой оркестрации CLI → characterization-тесты через fake-docker бинарник (Constitution II exception, тот же подход, что в 018/025). Все unit-тесты **hermetic** (на машине автора daemon выключен — `docker info` → connect error): ни один тест не обращается к реальному docker; «без push» доказывается журналом argv (FR-002). Интеграционный smoke на реальном daemon — опциональный, gated через `docker info` (в текущем окружении пропускается осознанно).

**Organization**: Задачи сгруппированы по фазам плана: (1) контракт/конфиг / (2) локальный build-путь / (3) fail-fast / (4) compat-интеграция-приёмка / (5) Verification / (6) Convergence. Фаза 1 блокирует 2–3; фаза 2 даёт логику, которую только проверяет фаза 3; фаза 4 — финальная регрессионная сетка + gated smoke. `packages/builders-core` — единственный пакет, где меняется код; `specs/018-builders-core/contracts/builders-core.json` — единственная правка контракта (additive). Правок materializers-core / pilot / composer `.ycsf` **не** производится (NG-3/4/5, D-6).

## Format: `[ID] [P?] [M?] [USn] Description` + **Ref** / **Depends**

- **[P]**: can run in parallel (different files, no incomplete deps)
- **[M]**: модификация существующего файла (не net-new). Без `[M]` — новое содержимое (обычно новые `it`-кейсы/блоки в существующем файле — тоже аддитивно).
- **[US1]–[US5]**: user story label (только в US-фазах; contract-фаза 1 помечена по обслуживаемой истории; Verification/Convergence — без label)
- **Ref**: привязка к FR/SC/решениям плана; **Depends**: блокирующие задачи.
- Line format: `- [ ] TXNN [P] [M] [USn] Описание с точными путями файлов … **Ref**: … **Depends**: …`

## Path Conventions

- **Src (только `packages/builders-core`)**: `src/types.ts` (`DockerBuildConfig` :65-68, `DockerArtifactValue` :47-49, root export `@ycforge/builders-core`), `src/docker/config.ts` (`ParsedDockerConfig` :12-16, `invalid()` :18-24, `parseDockerConfig` :26-46), `src/docker/cli.ts` (`BuildAndPushOptions` :15-20, `buildAndPush` :56-99, push @74, fallback inspect :87-93, `BLC_IMAGE_DIGEST_UNAVAILABLE` @95-98), `src/docker/index.ts` (:11-24, `buildAndPush` intent :16-21). Без изменений: `diagnostics.ts`, `preflight.ts`, `env.ts`, `catalog.ts`.
- **Контракт**: `specs/018-builders-core/contracts/builders-core.json` (`#/definitions/dockerBuildConfig` :70-89, `image.properties` :78-84, `image.additionalProperties: false` :83, `#/errorCodes` :141-165, `BLC_IMAGE_DIGEST_UNAVAILABLE` :152).
- **Тесты**: `packages/builders-core/test/helpers/fake-bins.ts` (`FakeDockerOptions` :13-24, `fakeDocker` :33-90, `withPath` :166-174), `test/unit/docker.spec.ts` (14 существующих `it` — НЕ трогаем; новый describe «docker builder no-push (spec 027)»), `test/unit/diagnostics.test.ts` (:54 — audit набора ключей `errorCodes`), `test/types/builders-core.test-d.ts` (5 существующих `it`, тип-тесты через vitest typecheck: `test/types/**/*.test-d.ts`).
- **Помощники**: `test/helpers/fixture-project.ts` — `dockerFixture()` (:73-80), `makeTempDir`, `writeExecutable`. Проверка типа: `pnpm --filter @ycforge/builders-core typecheck` (`tsc --noEmit`); unit: `pnpm --filter @ycforge/builders-core exec vitest run`; build: `pnpm --filter @ycforge/builders-core build` (tsup, entries `index`+`docker/index`+`vite/index`+`nestjs-function/index`, formats esm+cjs, dts).

---

## Phase 1: Контракт и конфигурация (FR-001, FR-006, FR-008, SC-007)

**Purpose**: Аддитивное расширение контракта `DockerBuildConfig.image` += `no_push?: boolean` (root export) и JSON-schema `dockerBuildConfig` += `image.properties.no_push` (обязательное, т.к. `image.additionalProperties: false`), строго-булевая валидация в `parseDockerConfig` (FR-006), расширение description `BLC_IMAGE_DIGEST_UNAVAILABLE` (const frozen, D-4). Тип-тесты и audit-it легитимируют аддитивность (SC-007). Фаза BLOCKS локальный build-путь (2) и fail-fast (3).

### RED-тесты (пишутся ДО реализации; ожидаемые failure'и — optional-поле/валидация отсутствуют)

- [ ] T011 [P] [US5] RED type-test `packages/builders-core/test/types/builders-core.test-d.ts` EXT (describe «DockerBuildConfig additive no_push, frozen value.image (spec 027)») — (a) литералы `image: { repository: 'r', tag: 'v1', no_push: true }` и `image: { repository: 'r' }` (без `no_push`) ОБА присваиваются `DockerBuildConfig` (optional, exactOptionalPropertyTypes-совместимо); (b) негатив не компилируется: `no_push: 'true'` и `no_push: 1` НЕ присваиваемы (`{ no_push: string }`/`{ no_push: number }` НЕ матчится в image-секцию); (c) заморозка инварианта: `expectTypeOf<DockerArtifactValue>().toEqualTypeOf<{ readonly image: string }>()` и `value.image`-форма не расширяется (SC-007/NG-1). RED: `no_push` отсутствует в `DockerBuildConfig` → (a)/(b) падают. **Ref**: FR-001/FR-008, SC-007, plan §Phase 1 RED, D-2. **Depends**: —
- [ ] T012 [P] [US5] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (новый describe «docker builder no-push (spec 027)», секция invalid-config) — 3 `it`: `no_push: "true"`, `no_push: 1`, `no_push: null` (в `buildConfig.image`) → pending-reject `BLC_INVALID_CONFIG`, `err.field === 'image.no_push'`, журнал argv fake-docker **пуст** (CLI не вызван), `push` отсутствует; + 1 `it`: `no_push: true` без `image.repository` → `BLC_INVALID_CONFIG` (`repository` обязателен в обоих режимах, FR-006/edge §8). RED: parseDockerConfig игнорирует `no_push` → уходит в push-путь → `BLC_IMAGE_DIGEST_UNAVAILABLE`/argv непуст → FALL. **Ref**: FR-006, US-5-AC3, edge §8, plan §Phase 1 RED, P-3. **Depends**: —
- [ ] T013 [P] [US5] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (в том же describe) — coexistence: `buildConfig { image: { repository: 'test.local/app' }, exec_timeout: 30 }` + `image.no_push: true` → build успешен, известные top-level-ключи C по-прежнему игнорируются (тест «защищает» GREEN-сторону: после реализации фазы 2 `noPush` не должен мешать coexistence; на RED до валидации опции проходит тривиально — финальная проверка в фазе 1 Verification). **Ref**: FR-007, edge §8 «unknown top-level», plan §Phase 1 RED. **Depends**: —
- [ ] T014 [P] [US5] RED audit-it `packages/builders-core/test/unit/diagnostics.test.ts` EXT (1 `it`, добавить после :55) — чтение `specs/018-builders-core/contracts/builders-core.json` (тот же `CONTRACT_PATH`, что :14): (a) `definitions.dockerBuildConfig.properties.image.properties.no_push` существует как `{ type: 'boolean', default: false }`; (b) `image.properties.repository`/`tag` присутствуют и **неизменны** (deep-equal с ожидаемым snapshot'ом), `image.additionalProperties === false`, `dockerfile`/`required` без изменений (аддитивность, SC-007); (c) `errorCodes.properties.BLC_IMAGE_DIGEST_UNAVAILABLE.const === 'BLC_IMAGE_DIGEST_UNAVAILABLE'` (const frozen), description теперь покрывает локальный+push scope; (d) набор ключей `errorCodes.properties` по-прежнему равен экспортированному набору констант (существующая проверка :54 не меняется — новый `it` её не трогает). RED: `no_push` отсутствует в JSON → FALL. **Ref**: FR-001/FR-008, SC-007, plan §Phase 1 RED (audit). **Depends**: —

### GREEN (реализация)

- [ ] T015 [M] [US5] `packages/builders-core/src/types.ts:65-68` — `DockerBuildConfig.image` → `readonly image?: { readonly repository: string; readonly tag?: string; readonly no_push?: boolean }` (комментарий: «default false; only-build режим (spec 027)»); `DockerArtifactValue` (:47-49) НЕ трогается (NG-1). **Depends**: T011.
- [ ] T016 [M] [US1] `packages/builders-core/src/docker/config.ts` — (a) `ParsedDockerConfig` (:12-16) += `readonly noPush: boolean`; (b) в `parseDockerConfig` (:26-46): `const raw = imageRecord.no_push; const noPush = raw === undefined ? false : raw; if (typeof noPush !== 'boolean') invalid('image.no_push')` (FR-006, P-3; `invalid()` уже проставляет `field`); (c) `return { repository, tag, dockerfile, noPush }`; порядок префлайтов (sourcePath → residual-env → config) — в index.ts, без изменений (P-3: `no_push: "{{$X}}"` падёт `BLC_ENV_NOT_RESOLVED` раньше конфиг-валидации — поведение не новое). **Depends**: T012, T013.
- [ ] T017 [M] [US5] `specs/018-builders-core/contracts/builders-core.json` — (a) `image.properties` += `"no_push": { "type": "boolean", "default": false, "description": "true → only-build, digest из локального daemon (.Id), push не выполняется (spec 027)." }` (обязательно: `image.additionalProperties === false`); существующие `repository`/`tag` не изменяются; (b) `errorCodes.properties.BLC_IMAGE_DIGEST_UNAVAILABLE.description` += «; also thrown in no-push mode when the local digest cannot be resolved from `docker image inspect --format '{{.Id}}'` (build succeeded)» — const не меняется (D-4). **Depends**: T014.

**Фаза-1 Verification**: `pnpm --filter @ycforge/builders-core exec vitest run test/unit/docker.spec.ts test/types/builders-core.test-d.ts test/unit/diagnostics.test.ts` — ДО GREEN RED-прогон даёт ожидаемые failure'и (invalid-config ×3, test-d optionality, audit-it); ПОСЛЕ GREEN — все зелёные. `pnpm --filter @ycforge/builders-core typecheck` — 0 ошибок. **Deliverables**: проверить, что `const noPush = raw === undefined ? false : raw;` — не «угадывание» (Constitution V), а единственная валидная ветка default-false; существующие литералы `{ image: { repository } }` в `docker.spec.ts ctx` и фикстурах компилируются без правок.

**Checkpoint**: тип+JSON-контракт аддитивны; `BLC_INVALID_CONFIG` с `field: 'image.no_push'` детерминирован; префлайты не сломаны.

---

## Phase 2: Локальный build-путь без push (FR-002, FR-003, US-1, US-2, SC-001/002/003)

**Purpose**: При `no_push: true` — `docker build` в локальный daemon (без единого `docker push`), digest из `docker image inspect --format '{{.Id}}'` (deterministic first-match `/sha256:[0-9a-f]{64}/`; P-1 — локальный источник, `RepoDigests` в no-push-ветке НЕ читается), артефакт в прежней immutable-форме `"<repository>@sha256:<hex64>"` (US-2, tag в `value.image` не попадает). Расширение fake-docker режимом `localId` (dispatch по format-аргу `{{.Id}}`).

### RED-инфраструктура + RED-тесты (сначала харнесс, затем кейсы)

- [ ] T020 [US1] `packages/builders-core/test/helpers/fake-bins.ts` — `FakeDockerOptions` (:13-24) += `readonly localId?: string` (64-hex БЕЗ префикса `sha256:`); в `fakeDocker`-bash (:33-90) image-ветка (:77-82): после `cmd="$1"; shift` формат-арг = `$3`; `if [ "$3" = "{{.Id}}" ]; then` → печать `sha256:${localId}` при непустом `localId` (иначе ничего), `else` → прежнее поведение `inspectSha` (`echo "[test.local/app@${inspectSha}]"`). Существующие mode-ветки `build`/`push` и fallback-ветка `RepoDigests` НЕ меняются (риск «fake-docker regression», риск-таблица плана). Запечь `localId`/`buildStderr`/`buildExit` как сейчас (`options.* ?? default`). **Ref**: spec §13, plan P-5, risk #3. **Depends**: —
- [ ] T021 [US1] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (describe «docker builder no-push», happy-секция) — 3 `it`: **(1) SC-001/AC1**: `ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true }, dockerfile: 'Dockerfile' } })`, fake `{ localId: hexA }` → `artifact.type === 'ycforge:docker-image'`, `(artifact.value).image === 'test.local/app@sha256:'+hexA`, матч `/@sha256:[a-f0-9]{64}$/`. **(2) SC-002/AC2 «no push»**: тот же прогон, via `readLogLines(bins.logFile)`: журнал содержит `ARG build`, `ARG -f`, `ARG Dockerfile`, `ARG test.local/app:v1`, `ARG image`, `ARG {{.Id}}`, `ARG test.local/app:v1` (inspect-ref) и **не содержит** ни одной строки `ARG push` и `ARG {{index .RepoDigests 0}}`. **(3) SC-003/AC3 determinism**: два последовательных build идентичных входов → `value.image` совпадает посегментно (image ID, не случайный tag). RED: no-push-ветки в `cli.ts` нет → до GREEN уходит в push-путь → `BLC_IMAGE_DIGEST_UNAVAILABLE`/`ARG push` в журнале → FALL. **Ref**: FR-002/FR-003, US-1-AC1..3, SC-001/002/003, plan §Phase 2 RED (кейсы 1-3). **Depends**: T020, T016.
- [ ] T022 [US2] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (та же секция, US-2) — 2 `it`: **(4) US-2/AC2 tag-default**: config без `tag` + `no_push: true` → argv build содержит `test.local/app:latest` (локальная адресность сохранена, D-5), но `value.image` строго `test.local/app@sha256:<hex>` БЕЗ `:latest`/`:v1`. **(5) US-2/AC1 таблица форм**: набор конфигураций (tag `v1`; tag absent → default latest; repository со слэшами, напр. `cr.yandex/crp/analytics/extra`) → для каждой `value.image` матчит `/^<repository>@sha256:[a-f0-9]{64}$/` и НЕ содержит `:` перед `@` (нет `:v1@…`, `:latest@…`). RED: как в T021. **Ref**: FR-003, US-2-AC1/AC2, plan §Phase 2 RED (кейсы 4-5). **Depends**: T020, T016.
- [ ] T023 [US5] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (та же секция, push-рулетка) — 1 `it`: config БЕЗ `no_push`, fake `{ digest: hexA, localId: hexB }` → режим прежний: `ARG push` **присутствует** в журнале, digest взят из push-пути (`value.image === 'test.local/app@sha256:'+hexA`), `ARG {{.Id}}` в журнале **отсутствует** (SC-005: опция не активирует локальный путь при отсутствии; существующий FR-011 fallback-тест :89-101 не трогается). На RED проходит уже сейчас — guard на GREان-сторону. **Ref**: FR-007, SC-005, plan §Phase 2 RED (кейс 6). **Depends**: T016.

### GREEN (реализация)

- [ ] T024 [US1] [M] `packages/builders-core/src/docker/cli.ts` — (a) `BuildAndPushOptions` (:15-20) += `readonly noPush?: boolean` (internal, не экспорт; single consumer — index.ts); (b) в `buildAndPush` (:56-99) после успешного `docker build` (:62-72): `if (options.noPush)` → `runDocker(['image', 'inspect', '--format', '{{.Id}}', ref], sourcePath)`; code 0 → первый match `/sha256:[0-9a-f]{64}/` на stdout (детерминизм, edge §8 «inspect multi-line») → вернуть; иначе (или нет match) → `builderError(BLC_IMAGE_DIGEST_UNAVAILABLE, "local daemon digest could not be resolved for '<ref>' (build succeeded, no-push mode)")` (P-4, local-scope message; финальная формулировка — при implement, open-question 1). Push-ветка (:74-98) НЕ редактируется (бит-в-бит, FR-007). `tailStderr`/`digestFromPushOutput` без изменений. **Depends**: T020, T021, T022.
- [ ] T025 [US1] [M] `packages/builders-core/src/docker/index.ts` (:16-21) — передать `noPush: config.noPush` в `buildAndPush` (после T016 `ParsedDockerConfig.noPush`). Остальной build-поток (:11-24) без изменений; возврат `{ type: 'ycforge:docker-image', value: { image: \`${config.repository}@${digest}\` } }` тот же в обоих режимах (FR-003, US-2). **Depends**: T016, T024.

**Фаза-2 Verification**: RED-прогон новых кейсов до GREEN (падают: локальный путь не реализован, fake уже расширен) → GREEN после T024/T025. Журнал argv доказывает «нет push» (ни одного `ARG push`); tag в `value.image` отсутствует во всех табличных кейсах (US-2). **Deliverables**: no-push build-путь; 6 новых it; расширенный fake (0 регрессий режимов).

**Checkpoint**: `pnpm --filter @ycforge/builders-core exec vitest run test/unit/docker.spec.ts` — вся секция no-push зелёная, все прежние 14 `it` зелёные.

---

## Phase 3: Fail-fast диагностика (FR-004, FR-005, US-3, SC-004)

**Purpose**: Когда `no_push: true`, но локальная сборка невозможна — честный fail-fast существующими кодами (D-4): CLI отсутствует / build ненулевой exit (в т.ч. daemon down) → `BLC_BUILD_FAILED` с хвостом stderr; build ok, но локальный digest отсутствует → `BLC_IMAGE_DIGEST_UNAVAILABLE` (local-scope message). Ни одного частичного артефакта, ни одного тихого пропуска (Constitution V). Логика уже реализована в T024 (единый GREEN focus) — фаза подтверждается RED-тестами на реализованном коде; при расхождении формулировок правится ТОЛЬКО message.

### RED-тесты (пишутся ДО, прогоняются на реализованном коде)

- [ ] T030 [US3] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (секция fail-fast) — AC1 CLI-unavailable: `process.env.PATH = <имя пустого tempdir>` (обход `withPath` :166-174 — иначе настоящий docker 29.5.2 в PATH перехватит), build config `no_push: true` → reject `BLC_BUILD_FAILED`, message содержит «docker CLI unavailable»; PATH восстановить в `finally` (после завершения заменить обратно, не полагаться на afterEach). Журнал argv: `push` отсутствует (AC4-assert). RED: до T024 ENOENT-ветка не покрыта в no-push-контексте → не полагаться на прежний тест (проверяется именно no-push-режим). **Ref**: FR-005, US-3-AC1, plan §Phase 3 RED (AC1). **Depends**: T024.
- [ ] T031 [P] [US3] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (fail-fast) — AC2 daemon-down: fake `{ buildExit: 1, buildStderr: 'Cannot connect to the Docker daemon. Is the docker daemon running?\n' }`, config `no_push: true` → reject `BLC_BUILD_FAILED`, message содержит хвост stderr («…the Docker daemon…» виден), журнал argv НЕ содержит `push` (провал не маскируется push-попыткой, FR-005/AC4). **Ref**: FR-005, US-3-AC2, edge §8 «Daemon недоступен», plan §Phase 3 RED (AC2). **Depends**: T024.
- [ ] T032 [P] [US3] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (fail-fast) — AC3 digest absent: fake `{}` (build ok, `localId` не задан), config `no_push: true` → reject `BLC_IMAGE_DIGEST_UNAVAILABLE`, message упоминает локальный daemon/local scope (P-4 форма: «local daemon digest…»), `Artifact` НЕ возвращён; argv — без `push` (AC4). AC4 (полностью: во всех трёх провалах проверка журнала) — атомарно в каждый из T030/T031/T032 (assert `not.toContain('ARG push')`). **Ref**: FR-004, US-3-AC3/AC4, risk «ambiguity digest-источника», plan §Phase 3 RED (AC3/AC4). **Depends**: T024.
- [ ] T033 [US3] verify-only (RED-фиксация) — единый прогон секции fail-fast + контраст: существующий it `docker.spec.ts:103-111` (push-путь BLC_IMAGE_DIGEST_UNAVAILABLE) остаётся зелёным, его message-строка прежняя (verify-only, не редактируется; open-question 1 — grep по прежнему message в тестах/README, расхождений быть не должно). **Depends**: T030, T031, T032.

**Фаза-3 Verification**: 4 fail-fast кейса зелёные; полный прогон `docker.spec.ts` — все 14 прежних + no-push + fail-fast `it` зелёные. **Deliverables**: диагностика US-3; 3 новых it + verify-pass.

**Checkpoint**: на текущей машине (daemon выключен) диагностика честная: любой no-push build fail-fast'ится кодом, никогда не «тихий успех».

---

## Phase 4: Compat, интеграция (gated) и приёмка (FR-007, FR-008, SC-005/006, US-4/5)

**Purpose**: Неhermetic противоположности: (1) push-режим бит-в-бит без опции (SC-005); (2) US-4 CI build-only — credentials не читаются; (3) SC-006 — материализатор yandex-serverless-container потребляет `value.image` as-is (0 правок, NG-3); (4) gated smoke на реальном daemon (опционально, не unit-CI). GREEN без изменений src — прогон RED-тестов фаз 1-3 на реализованном коде до полного зелёного (plan §Phase 4 GREEN).

### Тесты (RED → финальная зелёная сетка) + документирование

- [ ] T040 [US4] RED unit `packages/builders-core/test/unit/docker.spec.ts` EXT (секция US-4) — credentials-путь в no-push: config `no_push: true`, `buildEnv` с `DOCKER_REGISTRY_URL: 'registry.example.com'` и `DOCKER_AUTH_TOKEN: 'sekrit'` (FR-012 018 сохраняется) → build успешен; `args`/`env` журнала не содержат ни `DOCKER_AUTH_TOKEN`, ни `registry.example.com` (проверки как в прежнем FR-012 it :210-227, но в no-push-режиме); `ARG push` отсутствует. RED: до T025 no-push-реестр не покрыт credentials-утверждением — кейс фиксирует поведение после GREEN. **Ref**: FR-002, US-4-AC1, plan §Phase 4 RED (US-4 hermetic). **Depends**: T025.
- [ ] T041 [US5] SC-005 регрессионный gate — полный `pnpm --filter @ycforge/builders-core exec vitest run test/unit/docker.spec.ts`: все **14 прежних `it` зелёные без единой правки** (git diff тестовых файлов показывает только добавления; SC-005); отдельно фиксируется: `git diff dev...HEAD -- packages/builders-core/test/unit/docker.spec.ts` → чисто аддитивная diff-специфика (новая секция + новые блоки, прежние строки 1..241 нетронуты). **Ref**: FR-007, SC-005, plan §Phase 4 Verification. **Depends**: T033.
- [ ] T042 [US4] SC-006 verify-only materializer-compat — контрактная проверка: no-push `value.image` структурно идентичен push-форме (покрыто табличным тестом форм T022 — повторной проверки не требуется); дополнительно verify: `packages/materializers-core/src/yandex-serverless-container/index.ts:10-30` читает `value.image` as-is (статическое чтение, 0 правок — NG-3; правок не вносить). Если существует e2e-smoke materializers-core на реальном value — прогнать как подтверждение; в противном случае ограничиться статической проверкой формы. **Ref**: US-4-AC2, FR-003/FR-008, SC-006, A-6. **Depends**: T022, T041.
- [ ] T043 [US4] gated integration smoke (опционально, НЕ unit-CI) — новый `describe.skipIf(!probeDockerDaemon())`-блок в `packages/builders-core/test/unit/docker.spec.ts` (или `test/integration/docker-daemon.nopush.spec.ts`), `probeDockerDaemon()` = `docker info` exit 0 (в текущей среде false → skip осознанно, spec §13); сценарий: real `dockerFixture()` (Dockerfile `node:22-alpine` → потенциальный network-pull → обернуть в `try/catch`-skip при сетевой недоступности), config `no_push: true` → артефакт digest-формы `/@sha256:[a-f0-9]{64}$/`, отсутствие push доказать через `docker history` (или явный комментарий о границе). **Ref**: US-1, SC-001, spec §13, plan §Phase 4 RED (gated). **Depends**: T025.
- [ ] T044 Conjoined-примечание + приёмка — (a) документировать ограничение A-2/NG-8 в README `packages/builders-core` (docker-секция): no-push digest — локальный image ID `{{.Id}}`, НЕ обязан совпадать с будущим registry manifest-digest; no-push артефакт не обязан быть pullable до реального push; публикация — отдельный осознанный шаг с default-false (реальный README-текст пишется при /speckit.implement); (b) NOTICE для 024 (вне правок файлов): 027 предоставляет возможность локальной сборки `analytics` (`image.no_push`), оформление reference-проекта — зона 024 (A-7); (c) зафиксировать в commit-сообщении: `ycsf check` suspicious-keys denylist 025 не включает `no_push` (проверка не требуется — вне EXACT/SUFFIX списков). **Ref**: plan §Conjoined Change, spec NG-8/A-5/A-7, risk #1. **Depends**: T053.

**Фаза-4 Verification**: полный набор пакета зелёный (Phase 1-3 RED-тесты на реализованном коде); SC-005 доказан (прежний docker.spec.ts без правок); SC-007 — test-d + audit-it; gated smoke пропущен на текущей машине. **Deliverables**: регрессионная сетка, зафиксированные SC-001..SC-007, приёмка FR-001..FR-008.

**Checkpoint**: 0 регрессий push-режима; US-4/5 приёмка без pilot/composer/materializers-правок.

---

## Phase 5: Verification (typecheck, lint, build, full regression, границы диффа)

**Purpose**: Сквозная проверка перед converge: типы, scoped eslint, tsup build, полный unit-цикл с подсчётом net test delta, git-diff границы.

- [ ] T050 Typecheck clean — `pnpm --filter @ycforge/builders-core typecheck` (`tsc --noEmit`, strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes) → 0 ошибок: новые `DockerBuildConfig.image.no_push?`, `ParsedDockerConfig.noPush`, `BuildAndPushOptions.noPush?`, тест-d-блоки компилируются. **Depends**: T025, T044.
- [ ] T051 Scoped lint clean — `pnpm exec eslint packages/builders-core/src packages/builders-core/test` → 0 NEW errors (паттерн 023 T144/026 T062: legacy-baseline корня за границами пакета не трогается). **Depends**: T050.
- [ ] T052 Build — `pnpm --filter @ycforge/builders-core build` (tsup) → `dist/index.{js,cjs,d.ts}` + `dist/docker/index.{js,cjs,d.ts}` present; subpath `./docker` (exports :21-25 package.json) резолвится; новых external-зависимостей нет. **Depends**: T051.
- [ ] T053 Full regression + net test delta — `pnpm exec vitest run` в `packages/builders-core` (включая typecheck test-d, все unit-spec) → ALL GREEN; 0 правок существующих тестов; записать net test delta: baseline **19** (`docker.spec.ts` 14 it + `builders-core.test-d.ts` 5 it, pre-027, зафиксирован в плане) → итог (× новых it: 4 invalid/coexistence + 2 test-d + 6 happy/forms + 3 fail-fast + 1 credentials + audit-it + gated skip — точный подсчёт после GREEN); зафиксировать skipped (gated smoke) count для отчёта converge. **Depends**: T052, T041, T042, T043, T044.
- [ ] T054 Git-diff audit — `git diff dev...HEAD` покрывает ТОЛЬКО `packages/builders-core/**`, `specs/018-builders-core/contracts/builders-core.json`, `specs/027-docker-no-push/**` (+ `specs/README.md` roadmap не менять пока 🚧); `packages/pilot`, `packages/composer`, `packages/materializers-core`, `packages/nest-bridge` — 0 диффов; `git status` чистый. **Ref**: plan §Conjoined Change, NG-3/4/5. **Depends**: T053, T041.

**Checkpoint**: typecheck/lint/build/regression чистые; границы диффа соблюдены; net delta зафиксирован.

---

## Phase 6: Convergence

**Purpose**: Placeholder для `/speckit.converge` (T150-style) — read-only аудит, вердикт заполняется после implementation.

- [ ] T060 Convergence verdict — read-only аудит `/speckit.converge`: полный `pnpm exec vitest run` в packages/builders-core ALL GREEN (с net test delta из T053), `typecheck` и scoped eslint 0 errors, tsup build → dist-подпути; прежний `docker.spec.ts` зелёный без единой правки (SC-005); test-d + audit-it подтверждают SC-007; контракт аддитивен (только `image.no_push` + description у `BLC_IMAGE_DIGEST_UNAVAILABLE`, const frozen); `git diff dev...HEAD` — только packages/builders-core/** + contracts/builders-core.json + specs/027/**; gated smoke пропущен (daemon down, документировано); README-примечание A-2/NG-8 на месте (T044); FR-001..FR-008 → ≥1 задача [x]; Constitution I (только A-слой сборки), II (test-first; fake-docker characterization exception), III (аддитивность), V (fail-fast, строгий boolean, без warn-and-continue) соблюдены. **Depends**: T054. **Итоговый вердикт заполняется здесь.** Задачу ЧЕКНУТЬ только после фактического converge.

---

## Дополнительный baseline-факт (фиксируется до реализации)

- Прежний набор `packages/builders-core/test/unit/docker.spec.ts` содержит **14 `it`** (не 12), `test/types/builders-core.test-d.ts` — **5 `it`**; суммарный baseline плана **19/19** подтверждён регэксп-проверкой `rg -c "^\s*it\("` (2026-09-13). «Существующий docker.spec.ts (12 it)» в исходных формулировках — неточность; фактический счёт 14 и зафиксирован в T041/T053. Тип-тесты включены в vitest через `vitest.config.ts` (`test.typecheck.include: ['test/types/**/*.test-d.ts']`), поэтому `vitest run` гоняет и test-d.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (контракт/конфиг)**: Без внешних. T011–T014 [P] (RED) → T015 → T016 → T017 (GREEN). BLOCKS фазы 2–3.
- **Phase 2 (локальный путь)**: После Phase 1 (тип+config готовы). T020 (fake) → T021/T022 (RED) + T023 (guard) → T024 (cli) → T025 (index). GREEN-механика даёт всю no-push логику (включая fail-fast-сообщения фазы 3).
- **Phase 3 (fail-fast)**: После T024 (логика фаз 2-3 — единый проход). T030 – [T031 [P], T032 [P]] → T033 (verify).
- **Phase 4 (compat/приёмка)**: После T025 (no-push путь) + T022 (форма). T040 (US-4) → T041 (SC-005 gate) → T042 (SC-006) + T043 [P] (gated, вне CI) → T044 (документация после T053).
- **Phase 5 (Verification)**: После фазы 4. T050 → T051 → T052 → T053 → T054 (последовательные).
- **Phase 6 (Convergence)**: После Phase 5. T060 placeholder.

### Dependency Graph

```
Phase 1:  T011,T012,T013,T014 [P] ─► T015 ─► T016 ─► T017   (контракт + config)
                                                              │
Phase 2:  T020 ─► T021,T022 (RED) ─► T024 ─► T025            │  (локальный путь)
                      └► T023 (guard)                         │
                                                              ▼
Phase 3:  T030 ─ T031,T032 [P] ─► T033  ◄─── логика уже в T024
Phase 4:  T040 ─► T041 ─► T042 ─ T043[P] ─► T044
Phase 5:  T050 ─► T051 ─► T052 ─► T053 ─► T054
Phase 6:  T060
```

### Parallel Opportunities

- **Phase 1**: T011/T012/T013/T014 [P] — разные тест-файлы/секции; T016 (config.ts) и T017 (JSON) независимы после соответствующих RED. 
- **Phase 2**: {T020 (fake), T021, T022} — T021/T022 зависят только от T020; T023 guard параллелен.
- **Phase 3**: T031 и T032 [P] — разные fail-fast-кейсы в одном файле (разные секции), параллельно после T030.
- **Phase 4**: T040 параллелен T041/T042 (разные утверждения); T043 (gated, отдельный файл/блок) параллелен T040.

### Parallel Example: после Phase 1

```bash
# Phase 2:
Task: "T020 fake-bins localId → T021/T022 RED → T024/T025"
# Phase 3 pre-work (только после T024):
Task: "T030 → T031, T032 → T033"
# После T025: Phase 4 T040 → T041 → T042; T043 gated отдельно.
```

---

## Implementation Strategy

### MVP First (US-1 only)

1. Phase 1: контракт + config (T011–T017) — аддитивная база.
2. Phase 2: no-push локальный путь (T020–T025).
3. **STOP and VALIDATE**: happy-кейсы + argv-no-push + determinism зелёные (`docker.spec.ts` no-push describe); прежние 14 `it` зелёные.
4. Phase 3: fail-fast (T030–T033) — диагностика US-3.
5. Phase 4: compat-сетка (T040–T044) — SC-005/006 + приёмка US-4/5.

### Incremental Delivery

1. Контракт+конфиг → типы/schema аддитивны, invalid-config заfail-fast'ен (SC-007).
2. Локальный путь → only-build работает hermetic (US-1, SC-001/002/003).
3. Fail-fast → никакого partial-артефакта (US-3, SC-004).
4. Compat+regression → push-режим и весь тест-набор нетронуты (US-4/5, SC-005/006).
5. Verification+Convergence → net delta зафиксирован, T060 вердикт.

### Parallel Team Strategy (опционально)

Один исполнитель ведёт фазы последовательно; при двух исполнителях второй после Phase 1 готовит паралелльно T020 (fake-bins) и gated-блок T043 (не требует src). Фазы 2 и 3 выполняются в одном потоке (единый GREEN-focus cli.ts).

---

## Notes

- [P] = different files / независимые секции — параллелить безопасно.
- [M] = модификация существующего файла; всё остальное новое (аддитивные блоки в существующих тест-файлах).
- **Никаких правок существующих тестов** (SC-005): `git diff` по тестам должен показывать только добавления. Существующие 14 `it` docker.spec.ts и 5 `it` test-d — regression-база.
- **Const frozen**: `BLC_IMAGE_DIGEST_UNAVAILABLE` / `BLC_BUILD_FAILED` не переименовываются/не удаляются; расширяется только description в JSON-schema (D-4). Push-ветка `cli.ts:74-98` — бит-в-бит.
- **Локальный digest — только `{{.Id}}`** (P-1): `RepoDigests` в no-push-ветке не читается (у локального образа пуст — тихая поломка). Multi-arch/buildx/platform — вне (NG-7, risk #2): локальный build single-arch (A-3).
- **Never warn-and-continue** (Constitution V, §10): digest недоступен → `BLC_IMAGE_DIGEST_UNAVAILABLE`, никогда «предупреждение-но-продолжить».
- **gated smoke** (T043) — только там, где `docker info` exit 0; на текущей машине и в unit-CI пропускается осознанно; `skipIf`-гейт.
- **0 правок вне packages/builders-core** (D-6): materializers-core (NG-3), pilot/composer (NG-5), vite/nestjs-function (NG-4), `.ycsf`-форматы (NG-5). Секреты: no-push-путь не читает credentials (FR-012).
- Commit после каждой фазы или логической группы; последний коммит цикла — только `specs/027-docker-no-push/tasks.md` с `docs(specs): tasks spec 027 docker-no-push`.
- Spec 024 — NOTICE (без правок): 027 даёт возможность локальной сборки контейнера `analytics`, оформление reference-проекта — зона 024 (A-7).