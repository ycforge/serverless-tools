# Implementation Plan: e2e-final-enablement — сквозная включённость reference-проекта (5 фиксов)

**Branch**: `028-e2e-final-enablement` | **Date**: 2026-09-13 | **Spec**: [specs/028-e2e-final-enablement/spec.md](./spec.md)

**Input**: spec 028 (FR-001..FR-020, US-1..US-6, D-1..D-8, A-1..A-8, SC-001..SC-008) + checklists/requirements.md (16/16 pass). Вся эмпирика — из evidence-таблиц spec §3 (T001..T006 с file:line), проверено по коду двух циклов (025-027) 2026-09-13.

> Примечание о 024: директория `specs/024-e2e-reference/` на этой ветке ОТСУТСТВУЕТ (024 — ⬜ в roadmap, как зафиксировано в 027 plan). Golden-эталоны fixture 024 (spec §11/§13) на бранче только по имени. Базлайном служат инлайн-таблицы T001..T006 спеки 028 и существующие goldens тестов pilot/materializers-core. Имённые anchor'ы 024 переносятся в zone 024 (conjoined notice), не разблокируют 028.

## Summary

Блокеры reference-проекта закрываются пятью аддитивными фиксами (по фиксу — свой пакет-слой, Constitution I):

1. **Fix-1 — composer refs против app-модели** (`packages/composer` + additive-контракт `@ycforge/pilot/contracts`, OQ-2 → D-1): ресурсный индекс композиции объединяет external-entries (`.ycsf/resources.yaml`) и app-identities C-модели; `${resources.<domain>.<app_id>.<property>}` валиден без деклараций apps; domain выводится из `app.builder` (artifact type), транспорт — аддитивное поле `BuildContext.appIdentities?`.
2. **Fix-2 — standalone `ycsf materialize`** (`packages/pilot`; OQ-4 → D-4): `ycsf build` пишет store-дескрипторы `.ycsf/artifacts/<appId>/artifact.json`; `ycsf materialize` читает их (или `--artifacts <dir>`) → byte-идентичный pipeline-output; missing-store → документированный fail-fast без TypeError (страж — в materializers-core).
3. **Fix-3 — required YC attrs + companion path** (`packages/materializers-core` + `MaterializationContext.projectRoot?`, OQ-3 → D-2): `yandex_function` получает детерминированные `name`+`memory`, `yandex_api_gateway` — `name`; companion-api-gateway пишется в `<rootDir>/infra/generated/` (cwd-независимо).
4. **Fix-4 — docker dev-modes** (`packages/builders-core/docker`, OQ-1 → D-3): режимы `registry-ref`/`remote`/default поверх `image`-блока через аддитивные `mode`/`ref`/`host`; недостижимый daemon → новый `BLC_DOCKER_UNREACHABLE` с actionable-текстом; без сети/кредов в registry-ref.
5. **Fix-5 — pilot registry** (D-5): `packageName` резолвится из consumer-graph корня проекта (subpath exports, pnpm-aware); секции `builders`/`materializers` — раздельные key namespaces (cross-section дубликат допустим; `BRG_KEY_COLLISION` frozen+superseded).

**0 правок вне указанных пакетов и контракт-аддитива**: `cli/terraform.ts`, авто-outputs 025, IDT-таблица 026, `.ycsf/*.yaml` форматы (`.ycsf/artifacts/` — JSON-код-файл, не `.ycsf/*.yaml`, NG-2) — не трогаются.

## Technical Context

**Language/Version**: TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node 22+ ESM (`"type": "module"`), четыре пакета в pnpm-workspace, сборка tsup, vitest. Задето все четыре пакета (по фиксу — один src-слой).

**Primary Dependencies**: runtime-новых нет. `@ycforge/pilot/contracts` добавляет один новый модуль (`resource-domain.ts`) без новых npm-зависимостей. Hermetics для docker — существующий fake **бинарник** `docker` (`packages/builders-core/test/helpers/fake-bins.ts`, PATH-инъекция), не мок-пакет. Consumer-graph резолюция — `node:module` `createRequire` + `node:url` `pathToFileURL` (std-lib).

**Storage**: `.ycsf/artifacts/<appId>/artifact.json` — JSON-дескриптор store (не `.ycsf/*.yaml`; `.gitignore:44` уже игнорирует `.ycsf/artifacts/`); companion `<rootDir>/infra/generated/<name>-openapi.yaml` рядом с `.tf.json`; кэш 022 не затрагивается (stores не входят в filesHash, FR-009).

**Testing**: Vitest; test-first (Constitution II): каждый FR-001..020 → RED→GREEN до реализации. Тонкие CLI/daemon-оркестрации — characterization через fake (exception II, как в 018/027). Type-тесты (`test/types/**/*.test-d.ts`, `toEqualTypeOf`/`toMatchTypeOf`) — gates аддитивности контрактов (A-8, SC-006). Команды: per-package `pnpm --filter @ycforge/<pkg> exec vitest run` и `pnpm --filter @ycforge/<pkg> typecheck`; pilot typecheck требует сборки builders-core/materializers-core (pretest). Фикстура reference-проекта для Fix-1/Fix-2/Fix-5 — новый тестовый consumer-project (`node_modules` + declare deps), не silver-bullet.

**Target Platform**: workspace-монорепо + опубликованные пакеты. Реальный docker daemon на машине автора недоступен (A-4) — Fix-4 hermetic через fake; smoke gated — вне unit-CI.

**Project Type**: library-пакеты (builder/materializer/registry/composer) + CLI (`ycsf`). Constitution I: A=builders-core (build), B=composer (composition), C=pilot (orchestration), Terraform=provisioning — ни один фикс не пересекает границу.

**Performance Goals**: SC-001..SC-008 — детерминизм (см. Fix-3 determinism: `name`/`memory` из стабильных входов, никаких UUID/timestamps), hermetic без сети/кредов, reiterable byte-идентичность `infra/*.tf.json`.

**Constraints**: Constitution III — только аддитивные изменения (optional-поля контрактов, новые JSON-дескрипторы, `BLC_DOCKER_UNREACHABLE` — new const); frozen-коды (`BRG_KEY_COLLISION`, `RESOURCE_REF_*`, `BLC_*` существующие) не переименовываются/не удаляются; relaxation по паттерну 025 D-3/D-8 (superseded-комментарии); Constitution V — fail-fast (никаких тихих merge/пропусков; коллизии — ошибки); Constitution VI — apps=managed single source (объявление app-identity в resources.yaml остаётся запрещённым; composer НЕ читает apps.yaml, D-6/026 FR-005).

**Scale/Scope**: composer — resource-index merge + compile-core; pilot — build store, CLI materialize, registry loader, contracts; materializers-core — 2 materializers + context; builders-core — docker config/cli/index. Регресс-поверхность перечислена в «Modified Tests» (9 групп).

## Constitution Check

*GATE: Proшёл до Phase 0 (по фактуре spec); re-checked после Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Каждый фикс в своём пакете: Fix-1 (B + contract C), Fix-2 (C), Fix-3 (B-слой materializers + contract C), Fix-4 (A-builders), Fix-5 (C). Terraform/`.tf`-сериализация/`cli/terraform.ts` не трогаются (FR-013-Only: validate-эффект — через golden/characterization). |
| II. Spec-First, Test-First | ✅ PASS | FR-001..020 → ≥1 тест RED→GREEN (§ «План реализации по фиксам»). Thin-оркестрация docker/terraform — characterization (exception II, как 018/027). Фикстура акцепшена строится из FR/US-sдарбный списков spec §5. |
| III. Contracts Versioned | ✅ PASS | Всё новое аддитивно: `BuildContext.appIdentities?`, `MaterializationContext.projectRoot?` (+структурная replica materializers-core), `DockerBuildConfig.image.{mode,ref,host}?`, store-дескриптор `{version:1,type,value}` (код-файл, контракт-версия как cache manifest 022), new const `BLC_DOCKER_UNREACHABLE`. `.ycsf/*.yaml` version: 1 не меняется (NG-2). Frozen-коды не редактируются (superseded-комментарии по D-8). |
| IV. Terraform Stays Terraform | ✅ PASS | `.tf.json`-эмиссия и оркестрация не меняются; Fix-3 меняет только configuration продуцируемых ресурсов (детерминированно) и локацию companion; авто-outputs 025 структурно не затронуты (FR-012). |
| V. Explicit Over Magic | ✅ PASS | Fail-fast везде: коллизия app↔external в merged-индексе — `RESOURCE_REF_IDENTITY_COLLISION` (never merge); cross-namespace-дубликат — НЕ ошибка (явная декларация D-8, не тихая) ; внутрисекционный дубликат остаётся fail-fast; `image.mode` строгое enum; registry-ref форма проверяется регэкспом (mutable tag → `BLC_INVALID_CONFIG`); недостижимый daemon → явный код+направление, никакого partial-артефакта. |
| VI. Ownership: apps=managed | ✅ PASS | Apps — single source identities; composer получает их аддитивно (D-6), не парсит apps.yaml (026 FR-005); объявление app в resources.yaml запрещено. |
| Monorepo Tooling | ✅ PASS | Сборка + typecheck + тесты всех четырёх пакетов; новые тесты рядом с существующими; новых npm-зависимостей нет; consumer-graph фикстура использует `workspace:*`-symlink (pnpm). |

**Deviations**: нет; все OQ-* закрыты решениями D-1..D-5 плана (согласованы с D-1..D-8 спеки), открыты только текстовые детали реализационного уровня (см. «Open Questions»).

**Gate Decision**: All gates PASS.

## Решения плана (D-1..D-5; закрывают OQ-1..OQ-4 и Fix-5 механизм)

> D-1..D-8 спеки фиксируют **семантику** (что делать); D-1..D-5 плана фиксируют **механизм/форму** (как в коде) и разрешают OQ-*. Нумерация плана независима от номерации спеки.

### D-1 (OQ-2, Fix-1) — канонический home маппинга artifact→domain + транспорт identity

**Решение**: маппинг живёт единственным аддитивным модулем `@ycforge/pilot/contracts` → `contracts/resource-domain.ts`; транспорт — аддитивное optional-поле `BuildContext.appIdentities?: readonly AppIdentity[]`. Маппинг переиспользуется C (checkIdentityCollision, build) и B (composer merged-index) — единый source of truth, без дублирования и без особых констант composer.

- **Rationale**: маппинг нужен обоим слоям (C для доменного collision-check и составления identities, B для авторизованных `${resources.*}`-ссылок) → договорная точка — правильное место; adsorption в composer-константу создала бы второй источник (spec OQ-2 «дублирование» отклонён). Транспорт через контракт-тип (а не `unknown`-пакет в `compileComposition-параметр`) переиспользует существующий канал pilot→builder (`BuildContext`; 026 FR-005 соблюдён — composer apps.yaml не читает). `toMatchTypeOf`-направление test-d: добавление optional-поля к `BuildContext` не ломает ни одной из сторон (проверено по `builders-core-contract.test-d.ts`).
- **Форма**:
  - `contracts/resource-domain.ts` (additive, экспорт из barrel): `export type ResourceDomain = 'functions' | 'queues' | 'buckets' | 'containers' | 'gateways'` (словарь align с `RESOURCE_DOMAINS` composer, сверяется тестом); `export interface AppIdentity { readonly appId: string; readonly artifactType: string }`; `export const ARTIFACT_TYPE_DOMAIN_MAP: Readonly<Record<string, ResourceDomain>>` frozen (ровно 4 пары FR-002); `export function artifactTypeToResourceDomain(type: string): ResourceDomain | undefined`.
  - `contracts/builder.ts`: `BuildContext` += `readonly appIdentities?: readonly AppIdentity[]` (optional, additive).
  - **C-side** (`packages/pilot`): `build/index.ts` — перед сборкой вычислить `const appIdentities = [...projectModel.apps.entries()].filter(([,a]) => artifactTypeToResourceDomain(a.builder)).map(([appId, a]) => ({ appId, artifactType: a.builder }))` и включить в `context` (build/index.ts:274-280). `model/resources.ts` `checkIdentityCollision` — домен пер-приложения выводится через `artifactTypeToResourceDomain(app.builder)` (не только functions); коллизия `resources.yaml[domain][app_id]` → `PML_IDENTITY_COLLISION`. Следствие D-8: app с legacy-builder (не artifact type) identity не имеет → прежние PML-флаги на legacy-фикстурах снимаются (superseded; см. «Modified Tests»).
  - **B-side** (`packages/composer`): `CompileSource.appIdentities?: readonly AppIdentity[]` (additive); `builder/index.ts` `deriveCompileSource` копирует `context.appIdentities`; новый pure-модуль `resource/app-identities.ts`: `mergeResourceIndex(index, appIdentities)` — external-entries первыми, app-identities после (фиксированный порядок входного списка; determinism), свойства из `DOMAIN_PROPERTIES` домена; коллизия с external → throw `RESOURCE_REF_IDENTITY_COLLISION` (defensive, никогда merge); domain не из `RESOURCE_DOMAINS` → `RESOURCE_REF_DOMAIN_UNKNOWN` (не угадывание); `compile-core.ts:64` после `buildResourceIndex`, до вывода `functions` (compile-core.ts:65) и `loadAuthConfig` (compile-core.ts:76) → FR-005 (auth-ссылка `functions.<app_id>` на app-identity проходит). CLI-путь `ycsf-api compile` без identities — индекс resources.yaml-only (legacy NG-10, 0 регрессий CLI-фикстур).
- **Тесты**: composer unit — merged-индекс (external+apps, порядок), домен-вывод, fail-fast (коллизия/домен), auth-ref на app-identity; vocabulary-тест (values ⊆ composer `RESOURCE_DOMAINS`); integration — build app `openapi` (map-form fixture, artifact-type builders) со ссылками на три других app + golden `specPath`/`resourceReferences`; pilot unit — `resources.spec.ts` новые кейсы на containers/gateways/buckets + обновление legacy-кейсов (D-8). CLI-регресс composer (array-form) зелёный без правок.

### D-2 (OQ-3, Fix-3) — минимальный required attr set + companion path

**Решение**: `yandex_function` += `name` + `memory: 128` (константа), `yandex_api_gateway` += `name`; companion — `<rootDir>/infra/generated/<name>-openapi.yaml` через новое additive-поле `MaterializationContext.projectRoot?: string` (контракт pilot + структурная replica materializers-core, пересинхронизация test-d).

- **Rationale**: provider у `yandex_function` требует `name`/`memory` и они отсутствуют в текущей эмиссии (`yandex-function/index.ts:30-42`) — «Missing required argument» (T005). `memory: 128` — детерминированная константа (совпадает с дефолтом провайдера; визуально auth-безопасна), не volatile → byte-determinism (edge §8). `yandex_api_gateway` требует `name` (сейчас только `spec`, `yandex-api-gateway/index.ts:33-40`). Companion сейчас `resolve(process.cwd(),'generated')` (index:28) — cwd-зависимо (NG-3); `projectRoot` приходит от C (pilot всегда передаёт из `rootDir`), поэтому location root-relative и cwd-независима; Д-4 таблица addresses 024 frozen (resource label = app identity; `name` производно от него же).
- **Форма**:
  - `packages/pilot/src/contracts/materializer.ts` (additive) и `packages/materializers-core/src/types.ts` (replica): `MaterializationContext` += `readonly projectRoot?: string`; `packages/pilot/src/materialize/context.ts:53` `createContext(builder, projectRoot?)` → `{ output, ...(projectRoot ? { projectRoot } : {}) }`; dispatch threads `options.projectRoot?` (`DispatchOptions` additive) из `runMaterializeGeneration(rootDir, …)` (pipeline.ts).
  - `yandex-function`: config order фиксируется как `{ runtime, name, memory, entrypoint, user_hash, content }`; `name` = `artifact.name`, `memory` = `128` (const, комментарий). Auto-output `<name>_function_id` не меняется (FR-012).
  - `yandex-api-gateway`: config `{ name, spec }`; companion: `baseDir = context.projectRoot !== undefined ? resolve(context.projectRoot,'infra','generated') : resolve(process.cwd(),'generated')` (fallback legacy задокументирован, оба пути детерминированы); tf.json-ссылка `${path.module}/generated/<name>-openapi.yaml` **не меняется** — terraform запускается из `infra`, `path.module` = `infra`, companion теперь физически в `infra/generated` (адресация сходится).
- **Тесты**: materializers-core unit/golden — `yandex-function.spec.ts:38` (toEqual-конфиг → новая форма), `yandex-api-gateway.spec.ts:51/54/74/128` (companion root-relative при `projectRoot`, legacy fallback при его отсутствии, spec-строка неизменна), determinism (имя/память из стабильных входов, никаких volatile); characterization (опц., gated): `terraform validate -no-color` на materialized function/gateway — 0 «Missing required argument» (T005); pilot `e2e-real-cores.spec.ts` — добавочные asserts на `name`/`memory`/`name`.

### D-3 (OQ-1, Fix-4) — форма dev-поверхности docker

**Решение**: per-app `build_config.yaml` `image`-блок (C-opaque, versionless — правок C не требует) + аддитивные поля `image.mode?: 'registry-ref' | 'remote'`, `image.ref?: string`, `image.host?: string`; `no_push` (027) совместим во всех режимах; новый код `BLC_DOCKER_UNREACHABLE`.

- **Rationale**: project-level `.ycsf/project-config.yaml` потребовал бы НОВОГО versioned формата (contract change, NG-2) — отклонён. Per-app `image`-блок уже доезжает до builder'а opaque (`pilot/src/build/index.ts:277`) — 0 правок C. Один новый код вместо расщепления `BLC_BUILD_FAILED` константой, т.к. FR-017 требует стабильно различимый «daemon down» от «build failure» с actionable-направлением.
- **Форма/матрица** (`packages/builders-core/src/docker/config.ts` → `ParsedDockerConfig` += `mode`, `ref`, `host`):
  - `mode` absent → default (локальный daemon, текущий путь; только-new диагностика при недостижимости). `mode` present: только `'registry-ref'|'remote'`; любая другая строка (вкл. `'build'`) → `BLC_INVALID_CONFIG` поле `image.mode` (два способа сказать «default» запрещены — V).
  - `registry-ref`: `image.ref` обязателен, строго `/^[^@]+@sha256:[0-9a-f]{64}$/` (FR-015; mutable tag в части до `@` или после — не проходит). `image.repository`/`image.tag`/`image.dockerfile` в этом режиме отсутствуют (mutual exclusion → `BLC_INVALID_CONFIG`); `no_push: true` — валидный no-op (edge §8); **ни одного docker-вызова**; artifact `value.image` = `ref` as-is (проверен verbatim).
  - `remote`: `image.host` обязателен; build и (при `no_push: false`) push/legacy-digest исполняются с `DOCKER_HOST=<host>` в env подпроцесса; digest — content-digest удалённого daemon (`image inspect '{{.Id}}'` с тем же `DOCKER_HOST`); локальный daemon не обязателен. Connect/auth-провал → `BLC_DOCKER_UNREACHABLE` с remote-scope message (host указан); build-провал после коннекта → `BLC_BUILD_FAILED` (tail, DQ-6). `no_push` + remote = only-build на удалённом daemon.
  - default: недостижимый daemon (stderr-маркеры `Cannot connect to the Docker daemon at …`, `error during connect`, `failed to connect to the docker API`) → `BLC_DOCKER_UNREACHABLE`, message указывает stairway: запустить daemon / `image.mode: registry-ref` / `image.mode: remote`. Прочие CLI/build-провалы — прежний `BLC_BUILD_FAILED`. Никакого тихого пропуска/partial.
- **Контракты**: `packages/builders-core/src/types.ts` `DockerBuildConfig.image` += `mode?/ref?/host?` (optional); `specs/018-builders-core/contracts/builders-core.json` — `image.properties` += три optional-свойства (`additionalProperties: false` требует именно аддитивного добавления в `properties`), `errorCodes.properties` += `BLC_DOCKER_UNREACHABLE`; `diagnostics.ts` += const.
- **Тесты**: фейк `test/helpers/fake-bins.ts` (envLog уже пишет env → remote-assert на `DOCKER_HOST`; argv-журнал → 0 вызовов в registry-ref); `docker.spec.ts` +describe (registry-ref: empty argv, форма ref, mutable-tag → `BLC_INVALID_CONFIG`, no_push no-op; remote: argv+env, digest, connect-fail → `BLC_DOCKER_UNREACHABLE`; default-unreachable: stderr-маркеры → код+guidance); существующий docker.spec.ts (19 it + 027 no-push describe) без единой правки; audit-тест JSON (keys-набор: += 1 новая const).

### D-4 (OQ-4, Fix-2) — контракт artifact-store

**Решение**: store = per-app JSON-дескриптор `.ycsf/artifacts/<appId>/artifact.json` `{ "version": 1, "type": …, "value": … }`, записываемый каждым `ycsf build` (miss: после builder; hit: после `restoreBlob`); `ycsf materialize` читает `.ycsf/artifacts/` по умолчанию либо явный `--artifacts <dir>`; отсутствие store → документированный fail-fast для value-needing materializers (страж в materializers-core), legacy-value-less материализаторы работают как раньше (025 US-5).

- **Rationale**: per-app дескриптор рядом с уже существующим outputDir полагается на детерминированный канал 025 `AppIdArtifactMap` (без новой фазы); cache-blob-чтение как основа (вариант OQ-4) отклонён — cache dir внутренний, версия/manifest не обязана существовать при `--no-cache`, и blob неустойчив к проказам кэша; project-level manifest отклонён — лишняя глобальная зависимость для точечных операций. `version: 1` в дескрипторе — контракт-версия по образцу cache manifest 022 (CACHE_VERSION_MISMATCH-анология → actionable). Опция `--artifacts <dir>` — явный эскап-хэтч для non-standard root (та же структура `<dir>/<appId>/artifact.json`), единая семантика обоих путей → byte-идентичность (FR-007/SC-002).
- **Форма**:
  - `packages/pilot/src/build/store.ts` (NEW): `export const ARTIFACT_STORE_VERSION = 1`; `writeStoreDescriptor(outputDir, artifact)` (canonical `JSON.stringify`, детерминированно); `readStoreDescriptors(rootDir)` → `Promise<AppIdArtifactMap>` (skip+ошибка per-app с дескриптором: wrong version → actionable throw; отсутствующий dir → пустой map, НЕ ошибка загрузки); `readStoreDescriptorsFrom(dir)` для `--artifacts`.
  - `build/index.ts`: в loop после miss-GREEN (после `artifacts.push`) и после restore-hit — `writeStoreDescriptor(outputDir, resolvedArtifact)`; ровно один вызов на app независимо от hit/miss/noCache. Fingerprint-логика не трогается (FR-009).
  - `cli/materialize.ts`: parse `--artifacts <dir>` (commander, additive); `materializeAction` → `store = opts.artifacts ? readStoreDescriptorsFrom(opts.artifacts) : readStoreDescriptors(rootDir)` → передача в `runMaterializeGeneration(rootDir, model, registry, genOpts, store)` (существующий optional-параметр pipeline.ts).
  - Стражи в **materializers-core** (FR-008): `yandex-function/index.ts:13` и `yandex-api-gateway/index.ts:13` — до деконструкции `value`: `if (artifact.value === undefined) throw materializerError(YMT_INVALID_ARTIFACT_VALUE, 'artifact value missing: run \`ycsf build\` first or pass \`--artifacts <dir>\` (… YMT_INVALID_ARTIFACT_VALUE)')` — никакого TypeError-destructure (сейчас `const { specPath } = value` при `undefined` бросило бы TypeError) и тихого каскада; замыкается `MTL_MATERIALIZE_FAILED` на C-слое при провале (существующий materializeAll-путь).
- **Тесты**: pilot unit `artifacts-store.spec.ts` (write→read round-trip, version-mismatch, missing-dir→empty, `--artifacts` root); CLI интеграция: `buildApps` (miss/hit/noCache) → store contains 1/1/1 дескриптор; standalone `runMaterializeGeneration(rootDir, model, registry, {target}, store)` vs integrated (build→materialize в один проход) — **byte-compare** `infra/*.tf.json` включая `99-ycsf-outputs.tf.json` (SC-002) на реальных cores (расширение `e2e-real-cores.spec.ts`); missing-store → materialize бытовых fixture-materializers ok + function/gateway → `YMT_INVALID_ARTIFACT_VALUE` с actionable-текстом и `MTL_MATERIALIZE_FAILED`, без TypeError.

### D-5 (Fix-5) — механизм registry-резолюции + раздельные namespaces

**Решение**: резолюция `packageName` из consumer-graph через `createRequire(join(rootDir,'package.json')).resolve(packageName)` + `import(pathToFileURL(resolved).href)`, применяется **только к bare-specifier'ам** (не `./`, `../`, `/`); относительные/абсолютные пути резолвятся как сегодня (module-relative — legacy/фикстурный convenience). Секции — раздельные namespaces: `records`-ключ = `<kind>:<key>`, `PluginEntry.id` остаётся raw-ключом (builders.yaml-грамматикa 025 не меняется, ER-009).

- **Rationale**: сегодня `await import(entry.packageName)` (load.ts:18) разрешает из графа pilot-модуля — `@ycforge/composer/builder` недостижим (BBC-блокер №5). `createRequire(rootDir)` ходит в `node_modules` потребителя (включая pnpm `.pnpm`-структуру и workspace-симлинки) и понимает subpath exports — самый честный механизм (std-lib, без new deps). Ограничение bare-only снимает regression-риск для существующих относительных путей фикстур (FR-020/0 регрессий) — для таких specifier'ов контекст без изменений. Namespace: оба `ycforge:api-gateway`-модуля должны сосуществовать в `records` под одним raw-ключом — single Map требует kind-квалификации ключа; raw `id` сохраняется для диагностики (`select.ts:122`) и потребительской стабильности.
- **Форма**:
  - `registry/load.ts`: `const requireFromConsumer = createRequire(join(rootDirAbs, 'package.json'))` — но вхождения нужно: `loadPlugins(entries, resolveFrom?)` — новый аддитивный параметр-резолвер, `registry/index.ts` создаёт его из `rootDir`; bare-specifier → `requireFromConsumer.resolve` (екзception → `BRG_PACKAGE_NOT_FOUND`, message «not reachable from the project node_modules — declare as a dependency of the consumer project»); subpath-запись в exports не покрыта резолюцией → тот же actionable; success → `import(pathToFileURL(resolved).href)`; ошибки импорта → `BRG_LOAD_ERROR` как сегодня; относительный/абсолютный — прежний `import`.
  - **records-ключ**: `loaded.set(\`${entry.kind}:${entry.id}\`, …)` (id raw). Обновляются lookups: `validate.ts:14` `records.has(\`builder:${app.builder}\`)`; `build/index.ts:256` `records.get(\`builder:${app.builder}\`)`; `build/index.ts:172` `resolveBuilderVersion`-lookup (каст Map) — тот же префикс; `select.ts` итерирует values с filter `kind==='materializer'` — без изменений; `materializerIds` диагностики — raw ids (без изменений текста).
  - `registry/builders-yaml.ts`: удалить ручной cross-section-цикл (строки-цикл `BRG_KEY_COLLISION`); `uniqueKeys: true` (YAML) остаётся → внутрiseкционный дубликат по-прежнему `BRG_DUPLICATE_KEY` (FR-019); const `BRG_KEY_COLLISION` frozen с `@deprecated/superseded`-комментарием (паттерн 025 D-3/D-8; **вызов больше не производится**).
  - Consumer-graph интеграционный тест: fixture «consumer project» (tmp) с `package.json` + deps `{ "@ycforge/builders-core": "workspace:*" }` (pretest пилотной сборки уже собирает builders-core) и `node_modules/@ycforge/builders-core` → symlink на `packages/builders-core`; `builders.yaml` с `builders: {ycforge:docker-image: "@ycforge/builders-core/docker"}` и `materializers: {ycforge:docker-image: …}` (оба) → `loadRegistry(rootDir)` → 0 `BRG_PACKAGE_NOT_FOUND`/`BRG_KEY_COLLISION`, оба записи в records, kind-квалификация корректна (всё hermetic, без сети — модуль уже собран dist).
  - **BRG_PACKAGE_NOT_FOUND** сообщение расширяется actionable-частью (additive, константа-код frozen).
- **Тесты**: pilot `registry/quickstart.spec.ts` (Fixtures-корректность: существующие относительные packageName-записи зелёные; +new: bare-subpath via consumer-graph; both-section оба present; внутрисекционный дубликат → `BRG_DUPLICATE_KEY` нетто), `builders-yaml.spec.ts` T013 flip (cross-section теперь valid) + superseded-комментарий, `load.ts`-unit (bare vs relative dispatch), validate.ts unit (qualified-key lookup).

## Project Structure

### Documentation (this feature)

```text
specs/028-e2e-final-enablement/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Авторитетный input
├── checklists/requirements.md
└── tasks.md             # Phase 3 output (создаётся /speckit.tasks — НЕ здесь)
```

> Конвенция 025-цикла: research/data-model/quickstart/contracts отдельными файлами не создаются — весь контент фаз 0/1 сведён в настоящий plan.md.

### Source Code — Fix-1 (composer B + contracts C)

```text
packages/pilot/src/contracts/
├── resource-domain.ts       # NEW: ResourceDomain, AppIdentity, ARTIFACT_TYPE_DOMAIN_MAP, artifactTypeToResourceDomain
├── builder.ts               # ADD: BuildContext.appIdentities?: readonly AppIdentity[]
└── index.ts                 # ADD: re-export resource-domain

packages/pilot/src/
├── build/index.ts           # ADD: вычисление appIdentities и проброс в context
└── model/resources.ts       # EDIT: checkIdentityCollision — домен из artifactTypeToResourceDomain (не only-functions)

packages/composer/src/
├── resource/app-identities.ts   # NEW: mergeResourceIndex(index, appIdentities) + fail-fast коллизий
├── resource/index.ts            # ADD: barrel-export
├── compile-core.ts              # EDIT: compileCompositionInner — merge + functions/auth из merged-index
└── builder/index.ts             # EDIT: deriveCompileSource копирует context.appIdentities в CompileSource
```

### Source Code — Fix-2 / Fix-5 (pilot C) и Fix-3 (materializers-core B-слой)

```text
packages/pilot/src/
├── build/store.ts               # NEW: ARTIFACT_STORE_VERSION, writeStoreDescriptor, readStoreDescriptors(From)
├── build/index.ts               # EDIT: writeStoreDescriptor на miss/hit/noCache
├── cli/materialize.ts           # EDIT: --artifacts <dir>; загрузка store; проброс в runMaterializeGeneration
├── registry/load.ts             # EDIT: bare-specifier → createRequire(rootDir).resolve + import(fileURL)
├── registry/index.ts            # EDIT: loadPlugins(entries, {resolveFrom}) + qualified records-ключ
├── registry/builders-yaml.ts    # EDIT: убрать cross-section collision; BRG_KEY_COLLISION -> superseded-комментарий
├── registry/validate.ts         # EDIT: records.has(`builder:${app.builder}`)
├── materialize/context.ts       # ADD: createContext(outputBuilder, projectRoot?) -> { output, projectRoot? }
├── materialize/dispatch.ts      # ADD: DispatchOptions.projectRoot? + thread
└── contracts/materializer.ts    # ADD: MaterializationContext.projectRoot?: string

packages/materializers-core/src/
├── types.ts                     # ADD: MaterializationContext.projectRoot?: string (structural replica)
├── yandex-function/index.ts     # EDIT: name+memory (детерминированные); value-undefined guard (FR-008)
└── yandex-api-gateway/index.ts  # EDIT: name; companion -> <rootDir>/infra/generated (fallback legacy); value-undefined guard
```

### Source Code — Fix-4 (builders-core A-build)

```text
packages/builders-core/src/
├── types.ts                       # ADD: DockerBuildConfig.image.{mode?,ref?,host?}
├── docker/config.ts               # EDIT: ParsedDockerConfig+{mode,ref,host}; матрица валидации (D-3)
├── docker/cli.ts                  # EDIT: registry-ref early-return; remote DOCKER_HOST env; BLC_DOCKER_UNREACHABLE-classifier
├── docker/index.ts                # EDIT: проброс mode/ref/host
└── diagnostics.ts                 # ADD: BLC_DOCKER_UNREACHABLE

specs/018-builders-core/contracts/builders-core.json   # ADD: image.properties.{mode,ref,host}; errorCodes.BLC_DOCKER_UNREACHABLE

packages/builders-core/test/helpers/fake-bins.ts       # ADD: envLog (remote DOCKER_HOST); реестр argv уже есть
```

**Structure Decision**: in-place-аддитивность в каждом пакете; новые модули только там, где нет естественного места (store.ts, resource-domain.ts, app-identities.ts). Ноль новых пакетов/плагинов/сервисов.

## План реализации по фиксам (RED → GREEN)

> Порядок: контракты/конфиг (Fix-5, D-1-contracts, D-4, D-2) → механизмы (Fix-1, Fix-2, Fix-3, Fix-4) → compat/приёмка. Внутри каждого фикса сначала тесты (RED), затем реализация (GREEN). Thin-оркестрация — characterization через fake (exception II). Каждый FR закрыт test-first связкой.

### Phase 1 — Контрактная аддитивность (D-1/contracts, D-4, D-2/context, D-5-contracts)

**RED**:
- test-d (`packages/pilot/test/types/`): `builders-core-contract.test-d.ts` — `BuildContext` с `appIdentities?: readonly AppIdentity[]` принимается обеими сторонами (loose `toMatchTypeOf`, обе направления); `materializers-core-contract.test-d.ts` — `projectRoot?: string` добавлен в replica и контракт **одновременно** (`toEqualTypeOf` обе направления — иначе RED); `resource-domain.test-d.ts` — frozen `ARTIFACT_TYPE_DOMAIN_MAP`, 4 записи типа `Record<'ycforge:function'|…, ResourceDomain>`, `artifactTypeToResourceDomain` возвращает.
- audit (`packages/composer/test/...`): vocabulary-тест — `Object.values(ARTIFACT_TYPE_DOMAIN_MAP)` ⊆ composer `RESOURCE_DOMAINS`.
- `registry/builders-yaml.spec.ts`: T013-флип (cross-section оба present → valid; `BRG_KEY_COLLISION` больше не эмитируется) RED до правки yaml-парсера.
- store-контракт test-d/unit (`artifacts-store.spec.ts`): дескриптор `{version:1, type, value}` round-trip; красный до `build/store.ts`.

**GREEN**:
- `resource-domain.ts` + barrel + `BuildContext.appIdentities?` (C-side), replica+`MaterializationContext.projectRoot?`, store.ts write/read + `ARTIFACT_STORE_VERSION`, yaml-парсер (удаление цикла + superseded-комментарий), docker `image.{mode?,ref?,host?}` типы+JSON (+`BLC_DOCKER_UNREACHABLE`).

**Verification**: `pnpm --filter @ycforge/pilot exec vitest run test/types … ` + typecheck pilot (pretest соберёт core'ы); composer typecheck untouched (важно: `BuildContext`/`MaterializationContext`-тесты — gate контракт-аддитива).

**Deliverables**: контракт-слой аддитиве; RED подтверждён для всех contract-фич.

### Phase 2 — Fix-1 (composer merged-index, FR-001..005)

**RED** (`packages/composer/test/unit/resources.spec.ts` + `test/unit/compile.spec.ts`-интеграция):
- merged-index: идентич входы external+apps (+order), domain-вывод (`artifactTypeToResourceDomain`), `DOMAIN_PROPERTIES`-свойства per app;
- fail-fast: app_id==external в том же домене → `RESOURCE_REF_IDENTITY_COLLISION`; домен-не известен → `RESOURCE_REF_DOMAIN_UNKNOWN`;
- auth-ref: `functions.<app_id>` в auth.yaml на функцию-c-app-identity проходит (FR-005); на несуществующее имя — прежний `RESOURCE_REF_NOT_DECLARED`;
- integration: append `openapi` build (map-form fixture `ycforge:*`-builder keys) ссылки на 3 других app → `specPath`-golden + `resourceReferences` (детерминизм, 008/009);
- pilot `resources.spec.ts`: новые кейсы identifiers (containers/gateways/buckets) artifact-type; legacy-кейсы 83/101 — flip (D-8, superseded-комментарий) — RED до правки `checkIdentityCollision`.

**GREEN**:
- `resource/app-identities.ts` `mergeResourceIndex`; `compile-core.ts:64-76` — merge до `functions`/`loadAuthConfig`; `builder/index.ts` `deriveCompileSource`; pilot `build/index.ts` `appIdentities`; `model/resources.ts` домен-вывод.

**Verification**: композер-суйты зеленее (заново + legacy CLI регресс без правок NG-10); pilot resources.spec.ts полный; `pnpm --filter @ycforge/composer exec vitest run` + typecheck.

**Deliverables**: Fix-1 механизм; FR-001..005 связки.

### Phase 3 — Fix-2 (store CLI, FR-006..009) + FR-008-стражи

**RED**:
- `artifacts-store.spec.ts`: reader `--artifacts` root; version-mismatch → actionable; missing-dir → empty.
- `e2e-real-cores.spec.ts` (или new integration): `buildApps` on `ycforge:*`-fixture → `.ycsf/artifacts/<appId>/artifact.json` существует (miss/hit/noCache — ровно 1 дескриптор/app); standalone-прогон runMaterializeGeneration(..., .readStoreDescriptors(rootDir)) **byte-compare** против integrated (вкл. `99-ycsf-outputs.tf.json`).
- materializers-core: value-undefined guard → `YMT_INVALID_ARTIFACT_VALUE` (не TypeError) — RED до guard.
- pilot CLI: `ycsf materialize` без store на function/gateway → fail-fast `MTL_MATERIALIZE_FAILED` + actionable текст (FR-008); legacy value-less fixture-materializers — работают (025 US-5).

**GREEN**: `build/store.ts` вызовы в build loop; `cli/materialize.ts` `--artifacts` + загрузка + проброс; guards в двух materializers-core; (при необходимости) pipeline-проброс `rootDir` в `MaterializationContext.projectRoot` (см. Phase 4-смежность).

**Verification**: byte-identity прогон (SC-002), CLI-кейсы, «без TypeError» assert'ы; pilot typecheck.

**Deliverables**: упорядоченный по store standalone-materialize; FR-006..009.

### Phase 4 — Fix-3 (required attrs + companion, FR-010..013) + D-2-context

**RED**:
- `yandex-function.spec.ts:38` — новая ожидаемая форма конфига (name/memory) RED до materializers-core эмиссии; determinism-кейс (два вызова → идентичные config), отсутствие volatile.
- `yandex-api-gateway.spec.ts:51/54/74/128` — companion root-relative при `context.projectRoot` (передан), legacy fallback без него; spec-строка `${path.module}/generated/...` неизменна; `name` в конфиге.
- pilot `e2e-real-cores.spec.ts` — добавочные asserts (function name/memory; gateway name).
- (опц., gated) `terraform validate -no-color` на materialized function/gateway goldens — 0 «Missing required argument».

**GREEN**: materializers-core изменения + `materialize/context.ts` projectRoot-проброс (DispatchOptions.projectRoot из pipeline rootDir).

**Verification**: полный materializers-core suite + pilot e2e green; `terraform validate`-characterization (gated) green.

**Deliverables**: FR-010..013; cwd-независимость; авто-outputs 025 без изменений (verify-only).

### Phase 5 — Fix-4 (docker dev-modes, FR-014..017)

**RED** (`docker.spec.ts`, +describes; fake-bins расширен env-захватом):
- registry-ref: `image.ref` valid → artifact `image===ref`, **argv-журнал пуст** (0 docker-вызовов), форма `/^[^@]+@sha256:[0-9a-f]{64}$/`; mutable-tag ref (`repo:latest@sha256:…` / `repo:latest`) → `BLC_INVALID_CONFIG` поле `image.ref`; `repository`/`tag` вместе с registry-ref → `BLC_INVALID_CONFIG`; `no_push: true` — no-op валиден.
- remote: `image.host` обязателен (иначе `BLC_INVALID_CONFIG`); build+push-argv и **env содержит `DOCKER_HOST=<host>`** (env-журнал фейка); digest из `{{.Id}}` (та же ветка, `DOCKER_HOST` тот же); connect/auth-fail stderr-маркер → `BLC_DOCKER_UNREACHABLE` + host в message.
- default: daemon-down stderr (`Cannot connect to the Docker daemon at …`) → `BLC_DOCKER_UNREACHABLE`, message со stairway (daemon/registry-ref/remote); прочий build-fail → прежний `BLC_BUILD_FAILED`+tail; no partial (reject); argv без push в провалах.
- 027-compat: no_push+registry-ref/remote, таблица форм `value.image` (не mutable tag) во всех режимах.

**GREEN**: config.ts матрица; cli.ts ветки + classifier; index.ts проброс; `diagnostics.ts` const; JSON-схема (+audit-тест keys-sets).

**Verification**: полный docker.spec.ts — существующие it без правок (SC-005); hermetic (A-4); audit JSON.

**Deliverables**: FR-014..017; SC-001/SC-004/SC-006 доказательства.

### Phase 6 — Fix-5 (registry consumer-graph + namespaces, FR-018..020)

**RED**:
- `registry/quickstart.spec.ts` (или нового файла): consumer-fixture (node_modules symlink `@ycforge/builders-core/docker` subpath) → loadRegistry ok (0 `BRG_PACKAGE_NOT_FOUND`); both-section `ycforge:docker-image` → ok (0 `BRG_KEY_COLLISION`), обе записи в records (key `builder:…`/`materializer:…`, id raw); nonexistent package → actionable `BRG_PACKAGE_NOT_FOUND`; внутрисекционный дубликат → `BRG_DUPLICATE_KEY`; relative-path packageName (legacy фикстуры) — зелёные без правок.
- unit validate.ts: `records.has('builder:'+app.builder)`; build/index lookup (172,256) — qualified.
- 025-тест «BIG-key collision» flip (поиск по registry suite) — RED до реализации.

**GREEN**: load.ts bare-dispatch + `createRequire(rootDir)` + import(fileURL); index.ts `{resolveFrom}` + qualified records-ключ; validate.ts/build.ts lookups; builders-yaml.ts без-circa.

**Verification**: полный registry + materialize suite; существующие фикстуры относительных путей зелёные (FR-020/0 регрессий); pilot typecheck.

**Deliverables**: FR-018..020; суперсед-комментарий 025 D-3 паттерна.

### Phase 7 — Приёмка полного набора (US-1..US-6, SC-001..008)

- Полный прогон всех четырёх пакетов (`vitest run` + `typecheck` + audit-тесты JSON); фикстуры reference-final (`ycforge:*`-builder keys, cross-domain refs, function/gateway attrs) через все стадии, byte-детерминизм; golden-обновления финально зафиксированы.
- Regression surface — список «Modified Tests» выше; `git diff` показывает только запланированные правки (все обновления anchors перечислены).

## Traceability (FR → тесты)

| FR | Тест (по фиксу; файлы в «Project Structure») |
|---|---|
| FR-001/002 (app-identities в индексе; маппинг доменов) | P2: composer merged-index + domain-вывод; vocabulary-тест; D-1-контракты |
| FR-003 (объединение, порядок, коллизия) | P2: composer fail-fast `RESOURCE_REF_IDENTITY_COLLISION`; pilot resources.spec (PML domains) |
| FR-004 (fail-fast синтаксис/домен/свойство сохранены) | verify-only: composer CLI legacy suite; `RESOURCE_REF_*` gens |
| FR-005 (auth-ref на app-identity) | P2: auth-config unit + integration golden |
| FR-006 (store / --artifacts) | P3: artifacts-store.spec, CLI materialize |
| FR-007 (byte-идентичность, идемпотентность) | P3: byte-compare integrated vs standalone; повторный прогон |
| FR-008 (missing-store fail-fast, без TypeError) | P3: guards materializers-core + `MTL_MATERIALIZE_FAILED` |
| FR-009 (аддитивность store, version, fingerprint untouched) | P1: store-контракт test-d; verify-only cache-кейсы |
| FR-010/011 (required attrs; companion root-relative) | P4: materializers-core spec (function/gateway конфиги, companion path) |
| FR-012 (авто-outputs без изменений) | verify-only: e2e-real-cores output-asserts (225-231) |
| FR-013 (terraform validate 0 «Missing required») | P4: characterization (gated); golden-форма |
| FR-014..017 (docker modes) | P5: docker.spec +describes (registry-ref/remote/default/но-даун) |
| FR-018..020 (consumer-graph, namespaces, legacy) | P6: registry quickstart + builders-yaml flip + relative-path regression |

## Modified Tests (regression anchors, обязательные правки)

| Файл:место | Тип правки | Причина (спека §13) |
|---|---|---|
| `packages/materializers-core/test/unit/yandex-function.spec.ts:38` | EDIT (toEquаl-ожидание → name/memory) | required attrs (Fix-3) |
| `packages/materializers-core/test/unit/yandex-api-gateway.spec.ts:51/54/74/128` | EDIT (companion root-relative при `projectRoot`; legacy fallback case) | companion relocation (Fix-3) |
| `packages/pilot/test/materialize/e2e-real-cores.spec.ts:90-99` | ADD (name/memory/name asserts) | required attrs (Fix-3) |
| `packages/pilot/test/unit/builders-yaml.spec.ts:53` | EDIT (T013 → «valid, оба present»), superseded-комментарий | cross-section namespaces (Fix-5/D-8) |
| `packages/pilot/test/unit/resources.spec.ts:83/101` | EDIT (flip: legacy-builder app больше не деривирует identity → не коллизия), superseded | identity только из artifact-type (D-1/D-8) |
| `packages/pilot/test/registry/quickstart.spec.ts` (и любые registry-фикстуры с `.get(key)`/`.has(key)`) | ADD/EDIT (qualified keys `builder:…`/`materializer:…`; +consumer-graph кейсы) | records-ключ kind-квалифицирован (Fix-5) |
| `packages/pilot/test/unit/build.spec.ts` / чache-кейсы | ADD (store-дескриптор в miss/hit/noCache) | artifact-store (Fix-2) |
| `packages/pilot/test/types/materializers-core-contract.test-d.ts` | EDIT (projectRoot в обеих сторонах) | D-2-контракт |
| `packages/pilot/test/types/builders-core-contract.test-d.ts` | ADD (appIdentities optional) | D-1-контракт |
| Любые pilot-golden с `yandex_function`/`yandex_api_gateway`-конфигом (grep-обновление на этапе implement) | EDIT (форма с required attrs) | Fix-3 (спека §13) |
| composer CLI legacy-фикстуры (array-form) | НЕТ правок (verify-only green) | NG-10 |
| docker.spec.ts существующие it (19 + 027) | НЕТ правок (verify-only; только ADD-дескрибы) | SC-005 |

## Additive-proofs

| Контракт / поверхность | Изменение | Аддитивность (чьё использование не задето) |
|---|---|---|
| `@ycforge/pilot/contracts` `BuildContext` | `appIdentities?: readonly AppIdentity[]` (optional) | `toMatchTypeOf` обе стороны; существующие builders (composer, builders-core) компилируются без правок |
| `@ycforge/pilot/contracts` `MaterializationContext` | `projectRoot?: string` (optional; replica-materializers-core синхронно) | `toEqualTypeOf` (обе стороны) — правятся оба файла-стороны за раз; dispatch-compat: `createContext` без args → прежний `{output}` |
| `resource-domain.ts` (новый модуль контракта) | полностью нового export | 0 существующих потребителей; composer `RESOURCE_DOMAINS` не заменяется (vocabulary-тест) |
| `data-model` resources.yaml | НЕ декларируется app-identity (запрещён) | composer merge только добавляет, никогда не перезаписывает external (fail-fast) |
| Store `artifact.json` | NEW файл в `.ycsf/artifacts/` (version 1) | `.gitignore:44` уже покрывает; fingerprint 022 не включает stores; dispatch-канал 025 `AppIdArtifactMap` без изменений |
| `DockerBuildConfig.image` | `{mode,ref,host}?` optional | парсер: прежние конфиги без `mode` → default (бит-в-бит); `no_push` (027) независим |
| `BLC_*` | +`BLC_DOCKER_UNREACHABLE` (new const + JSON) | existing keys frozen (audit-тест keys-множества: только +=1) |
| `registry.records` ключ | `<kind>:<key>` (id raw) | потребители: validate/build/select (см. D-5); диагностики печатают raw id — тексты не меняются |
| `.ycsf/builders.yaml` grammar | cross-section дубликат валиден (удалён только ручной цикл; `uniqueKeys` внутри-секций не тронут) | legacy bare-ключи/конфигурации валидны (FR-020); 025 `BRG_INVALID`/`BRG_DUPLICATE_KEY`-семантика внутри-секций без изменений |
| `cli/terraform.ts`, авто-outputs 025, IDT-таблица 026, `DockerArtifactValue`, `99-ycsf-outputs` | НЕ изменены | весь контракт ZOE 025/026/027 stays |

**Гарантии**: не редактируются `Artifact`, `DockerArtifactValue`, `TerraformResource.configuration` (opaque), `ycsf-api` CLI-машинерия composer, cache-блоб-форматы 022, `.ycsf/*.yaml` `version: 1`.

## Conjoined Change

Изменения вне перечисленных пакетов: **НЕТ**. Заметки (без правок файлов):
- **NOTICE для 024**: `specs/024-e2e-reference/` на ветке отсутствует; после 028 reference-проект соберётся целиком при условии, что apps.yaml использует artifact-type builder-ключи (`ycforge:function` и т.д.) — маппинг identity происходит только по ним (FR-002/edge §8). Правка reference-проекта — зона 024 (A-7). `specs/024-e2e-reference/{research,spec,plan}.md` — NOT на бранче (n/a этот цикл).
- **Потребители `.ycsf/artifacts/`**: build-артефакты уже лежат там; новый дескриптор `.ycsf/artifacts/<appId>/artifact.json` — additive; `.gitignore` не меняется (строки 44-45 уже покрыты). Старый blob-cache 022 **не** читается как store (OQ-4-отклонение), stale-инвалидация — полный rebuild (edge §8, 025 A-2).
- **README пакетов**: при /speckit.implement — короткие примечания (docker modes в README builders-core; store-контракт в README pilot; artifact-type builder keys как precondition для app-identities).

## Risks

| Риск (спека §9/§10/§12) | Оценка | Митигация в плане |
|---|---|---|
| **024 отсутствует на ветке** (golden anchors 024 named-only) | Средний (информационный) | Инлайн-эмпирика T001..T006 спеки; 028 сам закрывает свой fixture (map-form `ycforge:*`); golden-надookies 024 — зона 024, не блокер |
| **Legacy-PML-флип** (resources.spec.ts:83/101) | Низкий | Явное superseded-обновление (D-8), перечислено в «Modified Tests» |
| **`toEqualTypeOf`-гейт MaterializationContext** при `projectRoot` | Средний (одна сторона не обновлена → RED) | Обе структурные копии правятся в одном commit'е (contracts + replica) с помеченным test-d |
| **Consumer-graph резолюция может не найти workspace-симлинк при нестандартной hoist-конфигурации** | Средний | Фикстура объявляет dep `@ycforge/builders-core: workspace:*` (pnpm создаёт симлинк) + symlink fallback в тесте; опубликованный пакет резолвится штатно (A-7); BRG-list-недостижимость → actionable |
| **Registry-фикстур относительные путь-записи при отключении bare-only-dispatch** | Средний | Д-5: bare-only правило (относительные резолвятся как сегодня) + regression-прогон FR-020 |
| **Fake-docker расширение (envLog) заденет существующие режимы** | Низкий | Диспатч только по новой env-опции; существующие ветки бит-в-бит; docker.spec.ts без правок существующих it (SC-005) |
| **`terraform validate`-characterization требует terraform CLI в среде** | Низкий | Gated (probe `terraform` в PATH); иначе golden-форма конфига (unit-эффект) — не блокер |
| **Orders вот и формы: изменение положения ключей конфига function/gateway заденет goldens ловчее** | Низкий | Фиксированный порядок ключей в плане (D-2), golden-обновления перечислены по grep на этапе implement |

## Open Questions

1. **Тексты message**: (a) `BLC_DOCKER_UNREACHABLE`-guidance текст; (b) actionable-текст пропущенного store (`YMT_INVALID_ARTIFACT_VALUE`); (c) доп. часть `BRG_PACKAGE_NOT_FOUND`. Константы/коды зафиксированы D-1..D-5; финальные формулировки — при /speckit.implement (как и в 027 P-4).
2. **`registry-ref` имя поля (`image.ref` vs `image.repository`+`image.digest`)**: выбран единый `image.ref` (D-3) — одна строка = одна иммутабельная ref, проще валидация формы и взаимное исключение с `repository`/`tag`. Если на review-созвоне решат иначе — правка локальна (config.ts).
3. **`memory` константа**: `128` — совпадает с дефолтом provider; при необходимости иная детерминированная константа — аддитивна (config-значение, не контракт).

## Tasks Readiness

Готово к `/speckit.tasks`. Спецификация и план без [NEEDS CLARIFICATION]; FR-001..020 имеют test-first связки (Phases 1-7). Предварительный список задач (группировка по фиксам):
- T1: контракт Fix-1 — `resource-domain.ts` + `BuildContext.appIdentities?` + test-d (Phase 1).
- T2: контракт Fix-3 — `MaterializationContext.projectRoot?` (pilot+replica) + test-d (Phase 1).
- T3: store-контракт — `build/store.ts` + test-d/round-trip (Phase 1).
- T4: Fix-5 contracts — builders-yaml cross-section + `BRG_KEY_COLLISION` superseded + T013-flip (Phase 1/6).
- T5: Fix-1 composer — `mergeResourceIndex` + compile-core + builder + auth-ref + golden (Phase 2).
- T6: Fix-1 pilot — `checkIdentityCollision` domains + build appIdentities + PML-кейсы flip/add (Phase 2).
- T7: Fix-2 — store write (build loop) + reader + `--artifacts` + guards materializers-core + byte-compare (Phase 3).
- T8: Fix-3 — function/gateway attrs + companion root-relative + context-проброс + goldens (Phase 4).
- T9: Fix-4 — config-матрица + cli-ветки + classifier + fake env/argv + docker.spec describes (Phase 5).
- T10: Fix-5 — load.ts consumer-graph + qualified keys + lookups + registry tests (Phase 6).
- T11: приёмка — full suites, typecheck, audit-JSON, golden-свода, regression list check, README-примечания (Phase 7).

**Notifications** (без правок файлов): 024 — reference-проект собирается только при artifact-type builder keys (D-1); legacy-конфиги остаются рабочими без app-identities. Требования 16/16 pass; без [NEEDS CLARIFICATION].