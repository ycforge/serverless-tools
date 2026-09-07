---
description: "Task list for builders-core — nestjs-function (bundling), docker, vite builders, BLC_* diagnostics, artifact catalog"
---

# Tasks: builders-core — `@ycforge/builders-core` (nestjs-function/docker/vite Builder-плагины)

**Input**: Design documents from `/specs/018-builders-core/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/builders-core.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion (18 AC по US1–US5 плюс edge-case-инварианты; SC-001..SC-007), каждый FR-001..FR-020 и каждый quickstart-сценарий Sc1–Sc8 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED (падают по правильной причине: целевой модуль отсутствует / бросает `'not implemented'`, а не по ошибке фикстуры). Исключение Constitution II (docker CLI wrapper — тонкий оркестрационный слой) задокументировано: fake-docker characterization-тесты постфактум в `test/unit/docker.spec.ts`. Pilot (011/012/013/014/015 + новый US4-suite) должен оставаться zero-regression на каждом шаге.

**Organization**: Задачи сгруппированы по фазам Setup / Tests (RED) / Core (GREEN) / Integration (quickstart Sc1–Sc8) / Polish, зеркаля 013/014/015, чтобы каждый модуль `packages/builders-core/src/` реализовывался test-first, а весь quickstart-suite валидировался в конце.

## Format: `[ID] [P?] [P1/P2/P3] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]/[US2]/[US3]**: Priority P1 user stories; **[US4]/[US5]**: P2
- Include exact file paths in descriptions

## Design decisions locked in (plan/research open questions resolved → behavior + tests)

**DQ-1 — ZIP: метод, таймстамп, CRC-32, порядок (plan Q1, resolved)**. Свой dependency-free writer на `node:zlib` (+ `node:fs`). Решения:
- Метод записи: per-entry `deflateRawSync` (method DEFLATE=8); **если deflated-размер ≥ исходного → entry пишется STORE (method 0)** — чистый выбор по содержимому → детерминизм (SC-003).
- Таймстамп: **фиксированный** DOS time = `0`, DOS date = `0` (1980-01-01 00:00:00) — и в local file header, и в central directory header; никаких метаданных текущего времени (внешние атрибуты `0`, version-made-by фиксирован `20`).
- CRC-32: **собственная table-based реализация** (~25 строк pure TS, константная таблица; НЕ полагаемся на `node:zlib.crc32`, добавленный в Node 22.2 — `engines.node >= 22` не гарантирует 22.2). Проверяется известным вектором `crc32('123456789') === 0xCBF43926` и round-trip через system `unzip -t`.
- Порядок записей: сортировка по нормализованному пути (forward-slash, ASCII codepoint); **directory-entries не пишутся** — только файлы (unzip создаёт каталоги неявно).
- Стандартный `.zip` Yandex Cloud Functions: bundled-файл в корне архива + опциональный `node_modules/<external-id>/`.

**DQ-2 — `sourcePath`: без defaulting, обязателен (plan Q2, resolved)**. Для всех трёх builder-ов `context.sourcePath` **обязателен**; отсутствие → `BLC_MISSING_SOURCE` (spec Edge Cases «Для реализуемых builder-ов отсутствие sourcePath → error», data-model §7). Fallback `sourcePath ?? projectRoot` **НЕ реализуется** (неоднозначность вывода/контекста/push). Семантика: docker build context = `sourcePath`; vite `viteRoot = resolve(sourcePath, root)`; nestjs-function entry — relative к `sourcePath`.

**DQ-3 — `runtime` → esbuild target: закрытый set (plan Q3, resolved)**. Поддерживается ровно `{ nodejs20 → node20 (default), nodejs22 → node22 }`. Любое другое значение `runtime` → `BLC_INVALID_CONFIG` (совпадает с enum в `contracts/builders-core.json` `nestjsFunctionBuildConfig.runtime`). `nodejs18` и прочие Yandex-runtime **не** добавляются в этой волне (добавлять по мере поддержки).

**DQ-4 — external copy: realpath-копирование resolved-каталога (plan Q4, resolved)**. Для каждого id из `external`: `createRequire(join(sourcePath,'package.json'))` → `require.resolve(id + '/package.json')` → `realpathSync(dirname(...))` → `fs.cpSync(resolvedDir, join(staging,'node_modules',id), { recursive: true })` (копия пакета as-installed, бинарники не трогаются; pnpm isolated `.pnpm/` realpath копируется как есть). Нерезолвящийся external (задекларирован, но не установлен) → `BLC_BUILD_FAILED` (архив не был бы self-contained). **Документированное ограничение волны**: transitive npm-зависимости external-пакета НЕ закрываются в zip (копия самого пакета); канонический `sharp` — self-contained, полное closure — будущая волна/кэш 022.

**DQ-5 — Type test placement: оба файла остаются (plan Q5, resolved)**. Разные назначения: (а) builders-core `test/types/builders-core.test-d.ts` — standalone, пиннит собственный публичный API пакета (literal-типы артефакто-типов, union `BLC_*`, value/config-формы, importability из собственных subpath), **без импортов `@ycforge/pilot`**; (б) pilot `test/types/builders-core-contract.test-d.ts` — кросс-пакетная структурная conformance (spec-002 контракты assignable ⇄ replicas, биекция). Не фолдим: (б) проверяет границу контракта у потребителя, (а) — целостность пакета при отсутствии pilot.

**DQ-6 — docker `BLC_BUILD_FAILED`: truncated preview stderr (plan Q6, resolved)**. Message: `build failed: <command-сводка> exited with code <N>; <tail stderr>` где tail = последние **≤2000 символов** stderr; при превышении — ` …(truncated, <N> chars)`. RED/GREEN-ассерты — regex по `BLC_BUILD_FAILED`, фрагменту команды и `exited with code`.

### Deterministic DIAGNOSTIC MESSAGE тексты (все `BuilderError.message` содержат `(<code>)` — grep-абильны, паттерн BRG_/PML_ pilot)

| Code | Message-шаблон |
|------|----------------|
| `BLC_INVALID_CONFIG` | `build_config: <field> has invalid value (BLC_INVALID_CONFIG)` |
| `BLC_MISSING_SOURCE` | `<builder>: sourcePath is required (BLC_MISSING_SOURCE)` |
| `BLC_ENTRY_NOT_FOUND` | `entry file not found: <entry> (BLC_ENTRY_NOT_FOUND)` |
| `BLC_BUILD_FAILED` | `build failed: <cmd> exited with code <N>; <tail stderr ≤2000 chars>[ …(truncated, <n> chars)] (BLC_BUILD_FAILED)` |
| `BLC_ENV_NOT_RESOLVED` | `residual {{$...}} in buildConfig/buildEnv; D-3 violation (BLC_ENV_NOT_RESOLVED)` |
| `BLC_IMAGE_DIGEST_UNAVAILABLE` | `digest not resolved after push: <repository>:<tag> (BLC_IMAGE_DIGEST_UNAVAILABLE)` |
| `BLC_ARCHIVE_FAILED` | `zip write failed: <reason> (BLC_ARCHIVE_FAILED)` |

Проверка в RED-тестах — через regex-фрагменты, НЕ полные строки (таблица фиксирует contract, реализация — после планирования/задачи не дрейфует).

## Path Conventions

- **Monorepo package**: `packages/builders-core/src/` — source, `packages/builders-core/test/` — tests
- **Public surface**: `src/index.ts` (catalog + types, FR-003), subpath entry-модули `src/{nestjs-function,docker,vite}/index.ts` (default-export `Builder`), экспорты через `package.json` `exports` map
- **Private shared modules**: `src/{types,catalog,diagnostics,env,config}.ts`, `src/zip/{writer,collect}.ts`
- **Unit tests**: `packages/builders-core/test/unit/` (`nestjs-function.spec.ts`, `docker.spec.ts`, `vite.spec.ts`, `env-residual.test.ts`, `zip-writer.spec.ts`, `catalog.test.ts`, `diagnostics.test.ts`, `zero-pilot-import.test.ts`)
- **Fixture helpers**: `test/helpers/{fixture-project.ts,fake-bins.ts}`
- **Type tests**: `packages/builders-core/test/types/builders-core.test-d.ts` (vitest typecheck include)
- **Pilot (test-only delta, US4)**: `packages/pilot/test/builders-core/registry-loading.spec.ts`, `packages/pilot/test/types/builders-core-contract.test-d.ts`; `packages/pilot/package.json` devDep + `pretest`
- ⚠️ **Runtime deps минимальны**: `esbuild@^0.27.7` — единственная новая runtime-зависимость (уже транзитивно в lockfile, `allowBuilds: esbuild: true` — проверено, `pnpm-workspace.yaml` менять не нужно); `archiver` отсутствует в lockfile — свой writer (research D-RE-6/7). `@ycforge/pilot` **отсутствует** в любых deps builders-core (research D-RE-4).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Создать `packages/builders-core` (package.json, tsconfig, tsup, vitest, src-каркас со стабами, тест-хелперы), baseline-валидация pilot (zero-regression 011–015 до изменений), перепроверка фактов монорепы. Последняя задача setup — pilot test-infra delta (devDep + pretest), включающая US4-инъекцию.

- [x] T001 Verify baseline + monorepo dep facts: прогнать `pnpm --filter @ycforge/pilot test` — текущий baseline (011/012/013/014/015 suites + type-tests) green ДО изменений. Перепроверить факты research: `esbuild@0.27.7/0.28.2` присутствует транзитивно в `pnpm-lock.yaml`, `pnpm-workspace.yaml` уже содержит `allowBuilds: esbuild: true`; `archiver`/`yazl` в lockfile отсутствуют (grep → zero). Записать актуальное число тестов/файлов baseline как точку отсчёта для T085/T100. (`workdir=repo root`)
- [x] T002 [P] Create `packages/builders-core/package.json` per `data-model.md` §1: `name: @ycforge/builders-core`, `version: 0.1.0`, `type: module`, `engines.node >= 22`, `exports` map (`.` → `./dist/index.{d.ts,js,cjs}`, `./nestjs-function`, `./docker`, `./vite` — каждый с `types/import/require`), `files: ["dist"]`, `sideEffects: false`, `publishConfig.access: public`, `scripts: { build: "tsup", test: "tsup && vitest run", typecheck: "tsc --noEmit" }`, `dependencies: { esbuild: "^0.27.7" }`, `devDependencies: { @types/node, tsup, typescript, vitest }` (версии = pilot mirror). После создания — `pnpm install` (обновление workspace lockfile; esbuild allowBuilds уже открыт глобально) и проверить, что pnpm видит пакет (`pnpm list --filter @ycforge/builders-core`). **Depends**: T001.
- [x] T003 [P] Create `packages/builders-core/tsconfig.json` — точная копия `packages/pilot/tsconfig.json` (strict, NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, target ES2022, `types: ["node"]`, `noEmit: true`) с include `["src/**/*.ts", "test/**/*.ts", "tsup.config.ts"]`. **Depends**: T002.
- [x] T004 [P] Create `packages/builders-core/tsup.config.ts` — multi-entry по образцу pilot: `entry: { index: 'src/index.ts', 'nestjs-function/index': 'src/nestjs-function/index.ts', 'docker/index': 'src/docker/index.ts', 'vite/index': 'src/vite/index.ts' }`, `format: ['esm','cjs']`, `dts: true`, `clean: true`, `sourcemap: true`, `minify: false`. **Depends**: T002.
- [x] T005 [P] Create `packages/builders-core/vitest.config.ts` — `test.typecheck.enabled: true`, `include: ['test/types/**/*.test-d.ts']` (копия pilot-конфигурации). **Depends**: T002.
- [x] T006 [P] Scaffold `packages/builders-core/src/` стабы — файлы `index.ts`, `types.ts`, `catalog.ts`, `diagnostics.ts`, `env.ts`, `config.ts`, `nestjs-function/{index,config,bundle}.ts`, `docker/{index,config,cli}.ts`, `vite/{index,config,run}.ts`, `zip/{writer,collect}.ts`: сигнатуры/типы per `data-model.md` §2–§6 поверх контрактов (`contracts/builders-core.json`, `builders-core.draft.ts`); логика НЕ реализована (`throw new Error('not implemented')` / заглушка-значение). Root `src/index.ts` — placeholder (константа `BUILDERS_CORE_VERSION`) + минимальный placeholder-тест `test/unit/smoke.test.ts` (pass), чтобы цепочка `tsup && vitest run` работала end-to-end. Прогнать `pnpm --filter @ycforge/builders-core test` — build 4 entries + vitest зелёные. RED-тесты Phase 2 импортируются отсюда (относительные импорты из `test/unit`). **Depends**: T003, T004, T005.
- [x] T007 [P] Create `packages/builders-core/test/helpers/fixture-project.ts` — фабрика fixture-проектов (mkdtemp): `nestjsFixture(overrides)` — каталог с `src/main.ts` (экспорт `handler`), `package.json`, `tsconfig`-мин; вариант с `import sharp from 'sharp'` и с `openapi_entry`-подобным полем; `dockerFixture()` — `Dockerfile` + `analytics/` мини-app; `viteFixture(script)` — frontend с `index.html`/`src/main.ts`, инжектирующим `env.VITE_BANNER`/`YANDEX_ID_APP_ID` в документ. Вспомогательные: `writeProject(root, files)`, `makeStaticOutput(root, dir, files)`. Герметично, параллельно-безопасно, БЕЗ process.env-мутаций, cleanup через `afterEach`. **Depends**: T002.
- [x] T008 [P] Create `packages/builders-core/test/helpers/fake-bins.ts` — генерация executable-контрафактов в `mkdtemp`-PATH: `fakeDocker(opts)` — скрипт `docker` (bash, `#!/usr/bin/env bash`): логирует args в `$FAKE_BIN_LOG` (по одному аргументу на строку), поддержка режимов: ok-with-digest (печатает `…: digest: sha256:<64-hex> …`), no-digest (без digest), nonzero (exit 7 на `build`); `fakeVite(opts)` — скрипт `vite`: печатает `VITE_ENV_<KEY>=<value>` из env в лог, копирует фикс. static-вывод в `dist/`, exit 0/1. Оба читают `FAKE_BIN_LOG` для assertion'ов — детерминированный capture аргументов/env (характеризация docker-wrapper, Constitution II exception). **Depends**: T002.
- [x] T009 Pilot test-infra delta (US4 enable): `packages/pilot/package.json` — `devDependencies += { "@ycforge/builders-core": "workspace:*" }`, `scripts += { "pretest": "pnpm --filter @ycforge/builders-core build" }` (паттерн composer `pretest: pnpm --filter @ycforge/pilot build`; research D-RE-5). `pnpm install` → обновление lockfile + workspace-symlink в `packages/pilot/node_modules/@ycforge/builders-core`. Верификация цепочки: после `pnpm --filter @ycforge/builders-core build` из `packages/pilot` успешно резолвится `node -e "import('@ycforge/builders-core/nestjs-function')"`. НИКАКИХ production-изменений pilot; контракты `@ycforge/pilot/contracts` не трогаются. **Depends**: T002. — *создаётся последним в setup: включает US4 RED-тест.*

---

## Phase 2: Tests — unit (RED)

**Purpose**: Failing unit-тесты (RED), маппящие каждый AC/FR/SC/edge-case на поведение. Все RED ДО реализации (Green в Phase 3): импорт-цели существуют (стабы, `'not implemented'`), ассерты падают по отсутствию реализации/контракта — правильная причина RED. Фикстуры — `test/helpers/{fixture-project,fake-bins}.ts` (T007/T008); fs — только в тестах (mkdtemp). Docker CLI wrapper — characterization (Constitution II exception, задокументировано в DQ-6/quickstart).

### nestjs-function.spec.ts (US1, US5, SC-001/003/006, FR-004..008, P1/P2)

- [x] T010 [P] [US1] RED unit-test happy path + детерминизм + self-contained in `packages/builders-core/test/unit/nestjs-function.spec.ts`: `build({ projectRoot, sourcePath, buildConfig: { entry: "src/main.ts", runtime: "nodejs20", external: [] }, buildEnv: {}, outputDir })` → `Artifact.type === 'ycforge:function'`; `archivePath` — существующий `.zip` внутри `outputDir`; `entryPoint` непустой и равна `"main.handler"` (contract D-RE-8); повторный вызов с идентичными входами (в т.ч. по одному и тому же outputDir) → **байт-идентичный** `.zip` (SC-003, `fs.readFileSync` compare); распакованный бандл — CJS, `module.exports.handler` — функция, ссылок на unbundled-модули вне `external` нет (SC-006: regex-scan импортов бандла) — US1-AC1, FR-006/005, quickstart Sc1. **RED**: стаб бросает `'not implemented'`.
- [x] T011 [P] [US1] RED unit-test edge/fail-fast + external + unknown-key + US5 in `packages/builders-core/test/unit/nestjs-function.spec.ts`: (1) `external: ["sharp"]` + `import sharp` → сборка успешна, бандл НЕ содержит sharp-кода, в zip есть `node_modules/sharp/` (копия realpath), остальное забандлено (US1-AC2, FR-005, Sc2); (2) `buildConfig` с неизвестным top-level `openapi_entry` → сборка без ошибок, ключ игнорирован (US1-AC3, FR-008, Sc2); (3) `entry: "src/nonexistent.ts"` → reject `BuilderError` `BLC_ENTRY_NOT_FOUND`, файла `.zip` в outputDir НЕТ (US1-AC4, FR-007, Sc3); (4) `entry: "{{$ENTRY}}"` → `BLC_ENV_NOT_RESOLVED`, `.zip` не создан (US5-AC1, FR-019, Sc8); (5) `external: "string"` (не-массив) → `BLC_INVALID_CONFIG`; `runtime: "nodejs16"` → `BLC_INVALID_CONFIG` (DQ-3); отсутствие `sourcePath` → `BLC_MISSING_SOURCE` (DQ-2); несуществующий `outputDir` → создаётся рекурсивно, `BLC_ARCHIVE_FAILED` при отказавшей записи (режим fake) — edge cases, FR-004/007, contract-проверка кодов через константы (не литералы). **RED**: `'not implemented'`/пустая заглушка `catalog`.

### docker.spec.ts (US2, US5, SC-004, FR-009..013, P1/P2)

- [x] T012 [P] [US2] RED unit-test in `packages/builders-core/test/unit/docker.spec.ts` (fake docker через `fake-bins.ts`, PATH-инжекция `process.env.PATH`, `FAKE_BIN_LOG` capture): (1) `build_config: { image: { repository: "test.local/app", tag: "v1" }, dockerfile: "Dockerfile" }`, fake docker ok-with-digest → `Artifact.type === 'ycforge:docker-image'`; `value.image` матчит `/@sha256:[a-f0-9]{64}$/`; mutable-тег `test.local/app:v1` в value НЕ присутствует (SC-004, US2-AC1, FR-011, Sc4); args-capture: `build -f <dockerfile> -t test.local/app:v1 <sourcePath>` затем `push test.local/app:v1`, затем при отсутствии digest в push — `image inspect --format '{{index .RepoDigests 0}}'` (fallback DQ → FR-011, characterization FR-010); (2) fake no-digest → reject `BLC_IMAGE_DIGEST_UNAVAILABLE`, Artifact не возвращён (US2-AC2, FR-011, Sc5); (3) fake nonzero (exit 7 на build) → reject `BLC_BUILD_FAILED`, message матчит `exited with code 7`, частичного артефакта нет (US2-AC4, FR-013, Sc5); (4) FR-012 (US2-AC3): в config/env присутствуют «секрет-подобные» значения (`API_TOKEN`, `DOCKER_USER`) — builder не передаёт их fake docker ни в argv, ни в env (assert по `FAKE_BIN_LOG`): только `build/push/inspect`-аргументы, среда = базовый `process.env` без credential-добавок, сам факт наличия в config не ошибка (Sc5); (5) missing `image.repository` → `BLC_INVALID_CONFIG`; `tag: "-bad"` или с пробелом → `BLC_INVALID_CONFIG` (арг-безопасность DQ); отсутствие `sourcePath` → `BLC_MISSING_SOURCE`; `image.tag === "{{$TAG}}"` → `BLC_ENV_NOT_RESOLVED`, push НЕ выполняется (US5-AC2, FR-019, Sc8); docker CLI отсутствует (PATH без docker) → `BLC_BUILD_FAILED`. **RED**: `'not implemented'`.

### vite.spec.ts (US3, US5, FR-014..017/020, P1/P2)

- [x] T013 [P] [US3] RED unit-test in `packages/builders-core/test/unit/vite.spec.ts` (fake vite через `fake-bins.ts`): (1) `build_config: { out_dir: "dist" }`, `buildEnv: { YANDEX_ID_APP_ID: "abc" }` → fake-vite env capture доказывает `YANDEX_ID_APP_ID=abc` в окружении build-процесса (FR-015, US3-AC1, Sc6); `Artifact.type === 'ycforge:frontend'`; `value.directory` — существующий каталог внутри `outputDir`; инжектированное значение observable в собранном bundle fixture (US3-AC1, FR-016, Sc6); (2) пустой `build_config` → defaults применены (`out_dir: dist`, `root: .`), корректный артефакт (US3-AC2, FR-014, Sc6); (3) fake vite exit 1 → `BLC_BUILD_FAILED`, `value.directory` не существует (US3-AC3, FR-017, Sc6); fake vite без вывода `dist/` → `BLC_BUILD_FAILED` (FR-017); (4) `value.directory` по-Sc6-AC4: каталог содержит ТОЛЬКО собранные ассеты, без `src/`/исходников/секрет-файлов (US3-AC4, FR-016, Sc6); (5) PATH-резолв: fake `vite` из `${sourcePath}/node_modules/.bin` вызывается, npx НЕ используется (argv capture, FR-015, research D-RE-10); `buildEnv: { GREETING: "{{$GREETING}}" }` → `BLC_ENV_NOT_RESOLVED`, вывод не создан (US5-AC3, FR-019, Sc8); `out_dir: 42` → `BLC_INVALID_CONFIG`; отсутствие `sourcePath` → `BLC_MISSING_SOURCE`; FR-020: значение env читается из `buildEnv`, а не из `process.env[YANDEX_ID_APP_ID]` (тест: process.env без него). **RED**: `'not implemented'`.

### env / zip / catalog / diagnostics / structural (все stories, P2)

- [x] T014 [P] [US5] RED unit-test `packages/builders-core/test/unit/env-residual.test.ts` — чистый сканер `scanBuildInput` (src/env.ts, FR-018/019, D-3): строковый лист в глубину `buildConfig` (вложенные объекты/массивы) c `{{$` → обнаружен; значение `buildEnv` c `{{$` → обнаружен; пустые/чистые входы → clean; `${...}` (Terraform) и `${resources...}` (B→Materializer) НЕ флагаются (012 namespace boundary); не-строковые листья (числа, booleans, null) не ломаются; `{{` без `$`, `$X}}` — не residual (только точная подстрока `{{$`); функция возвращает список путей/значений для диагностики (deteministic). RED: `'not implemented'`. Плюс per-builder reject-кадрирование уже в T010–T013 (US5-AC1..3).
- [x] T015 [P] RED unit-test `packages/builders-core/test/unit/zip-writer.spec.ts` — dependency-free writer (src/zip/writer.ts + collect.ts, FR-006/SC-003): round-trip системным `unzip -t`/`unzip -p` на собранном архиве (файлы восстанавливаются байт-в-байт); детерминизм: два записи одного набора файлов → байт-идентичны (SHA-256); CRC-32-heктор `crc32('123456789') === 0xCBF43926`; решение STORE/DEFLATE (DQ-1): сжимаемый файл → method 8, incompressible/короткий → method 0; сортировка записей детерминирована (порядок центрального каталога); DOS-таймстамп = 0/0 во всех headers (null-bytes-ассерт); файл >64 KiB корректен (data descriptor НЕ используется — размеры известны заранее). RED: `'not implemented'`.
- [x] T016 [P] RED unit-test `packages/builders-core/test/unit/catalog.test.ts` — FR-003/D-2 (src/catalog.ts, публичный root-экспорт): `ARTIFACT_CATALOG` ровно 3 записи `nestjs-function → ycforge:function`, `docker → ycforge:docker-image`, `vite → ycforge:frontend`; `BUILDER_IDS` = `['nestjs-function','docker','vite']`; каждая строка `Artifact.type` проходит локальную копию грамматики `isArtifactType` = `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` (research D-RE-2); root `@ycforge/builders-core` экспортирует каталог + типы (import через self-reference построенного dist); известный builder id вне каталога (typo `nestjs_funtion`) — compile-time/известного типа нет (literal union из 3). RED: стаб-каталог пуст/не импортируется.
- [x] T017 [P] RED unit-test `packages/builders-core/test/unit/diagnostics.test.ts` — src/diagnostics.ts vs `contracts/builders-core.json` (Constitution V, «constants, not literals»): ровно 7 констант `BLC_INVALID_CONFIG/BLC_MISSING_SOURCE/BLC_ENTRY_NOT_FOUND/BLC_BUILD_FAILED/BLC_ENV_NOT_RESOLVED/BLC_IMAGE_DIGEST_UNAVAILABLE/BLC_ARCHIVE_FAILED`; набор констант byte-for-byte совпадает с keys `#/errorCodes` JSON-контракта (стабильная точка: JSON считывается тестом из `specs/018-builders-core/contracts/builders-core.json`); `BuilderError` — instance of `Error`, поле `code === BLC_*`, `message` содержит `(<code>)`; конструктор с неизвестным кодом не даёт повисания (message по умолчанию). RED: константы отсутствуют.
- [x] T018 [P] RED unit-test `packages/builders-core/test/unit/zero-pilot-import.test.ts` — FR-002/Constitution I: статический walk `packages/builders-core/src/**/*.ts` (паттерн pilot `zero-dependency.test.ts`): НОЛЬ value-position импортов `@ycforge/pilot`; плюс assert, что `packages/builders-core/package.json` не содержит `@ycforge/pilot` в dependencies/devDependencies/peerDependencies. RED: мирно проходит уже сейчас? — нет: стаб `types.ts` пока без импортов, assert по package.json = текущее состояние (psg: package.json создан в Phase 1), тест assert'ит инвариант — фиксирует RED-критерий «инвариант на месте» (green немедленно, но подтверждает guard; трактуем как guard-тест, а не TDD-fail).

### Type-level (RED)

- [x] T019 [P] RED type-test `packages/builders-core/test/types/builders-core.test-d.ts` (standalone, без pilot-импортов, DQ-5): importability `BuildContext/Builder/Artifact`, `FunctionArtifactValue/DockerArtifactValue/FrontendArtifactValue`, `NestjsFunctionBuildConfig/DockerBuildConfig/ViteBuildConfig`, `BUILDER_IDS/ARTIFACT_CATALOG/BuilderId/ArtifactType`, 7 `BLC_*` literal-констант из построенных subpath `@ycforge/builders-core` и `@ycforge/builders-core/nestjs-function|docker|vite` (само-ссылка через exports); `expectTypeOf` — `ArtifactType` равно union ровно трёх literal; `default`-экспорт каждого subpath имеет поле `build: (context) => Promise<Artifact>` (spec-002 shape, FR-001). RED: dist.d.ts ещё не содержит типов (stubs), compile-fail — правильная причина.
- [x] T020 [P] [US4] RED integration-test `packages/pilot/test/builders-core/registry-loading.spec.ts` (fixtures через `test/helpers/temp-project.ts`, паттерн 013 quickstart.spec): `.ycsf/builders.yaml` c `nestjs-function: "@ycforge/builders-core/nestjs-function"`, `docker: "@ycforge/builders-core/docker"`, `vite: "@ycforge/builders-core/vite"` (version: 1) + `.ycsf/apps.yaml` c `user_service`(builder nestjs-function)/`analytics`(docker)/`frontend`(vite) → (a) `loadRegistry(root)` → `kind:'ok'`, `registry.records` содержит 3 id c `kind === 'builder'`, НОЛЬ `BRG_*` (US4-AC1, Sc7); (b) `loadProjectModel(root)` + `validateBuilders(model, registry)` → `kind:'ok'` (US4-AC2, Sc7); (c) прямой `import('@ycforge/builders-core/nestjs-function')` → `ns.default.build` — `Function` (US4-AC3, Sc7, FR-001). RED: пакет построен в pretest, но stubs не экспортируют Builder → detectPluginKind null → `BRG_NOT_A_PLUGIN`.
- [x] T021 [P] RED type-test `packages/pilot/test/types/builders-core-contract.test-d.ts` — структурная conformance spec-002 (research D-RE-4, DQ-5, FR-002): биекция assignability `PilotBuildContext ⇄ BuildContext`, `PilotBuilder ⇄ Builder`, `PilotArtifact ⇄ Artifact` (в обе стороны `expectTypeOf(...).toEqualTypeOf(...)` по shape); pilot `isArtifactType` предикат принимает три артефакто-типа (string-level). RED: типы не существуют → compile-fail.

---

## Phase 3: Core — implementation (GREEN)

**Purpose**: Реализовать `src/*` модули, чтобы Phase-2 тесты стали GREEN. Порядок: контракты/типы/константы (T050–T054) → zip (T055/T056) → per-builder config → pipeline-модуль → builder index → root export. `test: tsup && vitest run` (build dist перед прогоном — self-reference subpath). esbuild — единственный runtime-импорт; `@ycforge/pilot` — нигде.

- [x] T050 Implement `packages/builders-core/src/types.ts` — standalone structural типы per data-model §3/`builders-core.draft.ts`: `BuildContext` (`projectRoot`, `sourcePath?`, `buildConfig: unknown`, `buildEnv: Record<string,string>`, `outputDir`), `Artifact<T=unknown>` (`type: string`, `value: T`), `Builder` (`build(context): Promise<Artifact>`), value-shapes `FunctionArtifactValue`/`DockerArtifactValue`/`FrontendArtifactValue`, типы конфигов `NestjsFunctionBuildConfig/DockerBuildConfig/ViteBuildConfig` (optional-поля per data-model §4), `BuilderDiagnostic`/`BuilderError` shared. НОЛЬ импортов pilot (constitution I; T018 guard). **Depends**: T019, T021 (RED shapes). — green T019/T021.
- [x] T051 [P] Implement `packages/builders-core/src/catalog.ts` — `BUILDER_IDS = ['nestjs-function','docker','vite'] as const`, `ARTIFACT_CATALOG` (3 записи, расmapping из data-model §5/DQ), `BuilderId`/`ArtifactType` (literal-union ровно 3). **Depends**: T016, T050. — green T016.
- [x] T052 [P] Implement `packages/builders-core/src/diagnostics.ts` — 7 `BLC_*` констант (DQ-таблица сообщений) + `BuilderError extends Error implements BuilderDiagnostic { code }`, message всегда содержит `(<code>)`. Константы сравнивать через `constants`, никогда литералы (T017). **Depends**: T017, T050. — green T017.
- [x] T053 [P] Implement `packages/builders-core/src/env.ts` — `scanBuildInput(buildConfig: unknown, buildEnv: Record<string,string>): { clean: true } | { clean: false; hits: readonly string[] }` — рекурсивный обход строковых листьев `buildConfig` + все значения `buildEnv`, детекция подстроки `{{$` (D-3, research D-RE-3), `${...}`/`${resources...}` НЕ трогает; детерминированный порядок hits (обход в порядке структуры). **Depends**: T014, T050. — green T014.
- [x] T054 [P] Implement `packages/builders-core/src/config.ts` — shared helpers: `validateKnownFields(raw: unknown, schema: { field: string; type: 'string'|'string[]'; allowed?: readonly string[] }[]): { ok: true; value: Record<string, unknown> } | { ok: false; field: string }` — известное поле неверного типа/вне `allowed` → `BLC_INVALID_CONFIG` (сообщение per DQ-таблица); unknown top-level ключи игнорируются by construction (return-структура содержит только известные поля); `requireString/requireStringArray` (неоднозначные/whitespace-значения → invalid). **Depends**: T010–T013 (config-RED-кейсы), T052. — green config-части builder-тестов.
- [x] T055 [P] Implement `packages/builders-core/src/zip/writer.ts` — dependency-free deterministic writer (DQ-1): hand-rolled CRC-32 table + `deflateRawSync` (fallback STORE при ≥raw), local headers (DOS time/date = 0/0, external attrs 0, version-made-by 20), central directory, EOCD; входы `{ path, data: Uint8Array }[]`, сортировка по нормализованному пути; `BLC_ARCHIVE_FAILED` при fs-ошибке записи. **Depends**: T015, T052. — green zip-writer.spec.
- [x] T056 [P] Implement `packages/builders-core/src/zip/collect.ts` — `collectDir(dir): { path, data }[]` рекурсивный обход staging-каталога (файлы; без directory-entries; относительные forward-slash пути), common-case порядок опционально уже отсортирован writer-ом. **Depends**: T015. — green zip-writer.spec (layout-часть).
- [x] T057 [P] Implement `packages/builders-core/src/nestjs-function/config.ts` — `parseNestjsConfig(raw: unknown): NestjsFunctionBuildConfig` — defaults per data-model §4.1 (`entry: "src/main.ts"`, `runtime: "nodejs20"`, `external: []`, `out_filename: "function.zip"`), `runtime` `allowed: ["nodejs20","nodejs22"]` (DQ-3), `out_filename` — непустая строка без path-разделителей (`BLC_INVALID_CONFIG`), validation через shared helpers T054, unknown-ключи-propagate не мешает (config вытаскивает только известные). **Depends**: T054, T050. — green config-кейсы nestjs.
- [x] T058 [P] Implement `packages/builders-core/src/nestjs-function/bundle.ts` — pipeline: (1) entry-existence `existsSync(join(sourcePath, entry))` иначе `BLC_ENTRY_NOT_FOUND`; (2) `esbuild.build({ entryPoints:[join(sourcePath, entry)], bundle:true, platform:'node', format:'cjs', target: TARGET_BY_RUNTIME[runtime], external, outfile: join(staging, basename), logLevel:'silent' })` — ошибка → `BLC_BUILD_FAILED` (esbuild-сообщение в <hint>, ≤2000); staging через `mkdtemp`, cleanup в finally; (3) external-copy (DQ-4): `createRequire` + `resolve(id+'/package.json')` → realpath → `fs.cpSync` в `staging/node_modules/<id>`; нерезолв → `BLC_BUILD_FAILED`; (4) zip через T055/T056 → `outputDir/out_filename` (mkdir recursive), `BLC_ARCHIVE_FAILED` при сбое; `entryPoint = "<basename>.handler"`. **Depends**: T057, T055, T056, T053 (env-guard вызывается из index, а не bundle), T052. — green nestjs RED.
- [x] T059 Implement `packages/builders-core/src/nestjs-function/index.ts` — default-export `Builder`: `build(context)` = prepare-чейн data-model §7 → validate config (T057) → env-scan (T053, residual → `BLC_ENV_NOT_RESOLVED`) → sourcePath-check (`BLC_MISSING_SOURCE`, DQ-2) → mkdir outputDir → bundle (T058) → `Artifact<FunctionArtifactValue>`. **Depends**: T058, T053, T054, T051. — green T010/T011 (US1).
- [x] T060 [P] Implement `packages/builders-core/src/docker/config.ts` — `parseDockerConfig(raw: unknown): DockerBuildConfig` per data-model §4.2: `image.repository` обязателен (непустая строка) → иначе `BLC_INVALID_CONFIG`; `image.tag` default `"latest"`, safety-regex (нет пробелов, не начинается с `-`) → `BLC_INVALID_CONFIG` (арг-безопасность); `dockerfile` default `"Dockerfile"`, relative к sourcePath; unknown top-level игнорируются. **Depends**: T054, T050. — green docker config-кейсы.
- [x] T061 [P] Implement `packages/builders-core/src/docker/cli.ts` — spawn (arg-array, `shell:false`, research D-RE-9): (1) `docker build -f <dockerfile> -t <repo>:<tag> <sourcePath>`; (2) `docker push <repo>:<tag>` → digest-parse `/(?:@sha256:|digest: )(sha256:[0-9a-f]{64})/` на stdout+stderr; (3) fallback `docker image inspect --format '{{index .RepoDigests 0}}' <repo>:<tag>` → `sha256:[0-9a-f]{64}`; (4) всё ещё нет → `BLC_IMAGE_DIGEST_UNAVAILABLE`; nonzero exit / ENOENT CLI → `BLC_BUILD_FAILED` c шаблоном DQ-6 (`exited with code <N>; <tail stderr ≤2000>`); credentials НЕ передаются (только build/push/inspect аргументы; env = process.env) — FR-012. **Depends**: T060, T052, T053. — green docker RED.
- [x] T062 Implement `packages/builders-core/src/docker/index.ts` — default-export `Builder`: prepare (validate → env-scan → `BLC_MISSING_SOURCE` → `BLC_ENV_NOT_RESOLVED` guard) → cli.ts build+push+digest → `Artifact<DockerArtifactValue>` (immutable `@sha256:`). **Depends**: T061, T053, T051. — green T012 (US2).
- [x] T063 [P] Implement `packages/builders-core/src/vite/config.ts` — `parseViteConfig(raw: unknown): ViteBuildConfig` per data-model §4.3: defaults `out_dir: "dist"`, `root: "."`, `command: "vite build"`; `out_dir`/`command` — непустые строки (`command` пустой/не-строка → `BLC_INVALID_CONFIG`). **Depends**: T054, T050. — green vite config-кейсы.
- [x] T064 [P] Implement `packages/builders-core/src/vite/run.ts` — `runVite(buildEnv, viteRoot, outDir, command, sourcePath)`: `spawn(command, { shell:true, cwd: viteRoot, env: { ...process.env, ...buildEnv }, env-PATH += `${sourcePath}/node_modules/.bin` })` (research D-RE-10); collect stdout+stderr; nonzero/missing binary → `BLC_BUILD_FAILED` (tail ≤2000, DQ-6); после успеха `{viteRoot}/{out_dir}` копируется в `outputDir` (mkdir recursive) — отсутствие вывода → `BLC_BUILD_FAILED`, неполный вывод НЕ возвращается. **Depends**: T063, T052. — green vite pipeline-part.
- [x] T065 Implement `packages/builders-core/src/vite/index.ts` — default-export `Builder`: prepare (validate → env-scan → `BLC_MISSING_SOURCE` → `BLC_ENV_NOT_RESOLVED`) → `runVite` → `Artifact<FrontendArtifactValue>` (`directory = outputDir`). **Depends**: T064, T053, T051. — green T013 (US3).
- [x] T066 Implement `packages/builders-core/src/index.ts` — публичный root-экспорт (FR-003): `export * from './catalog.js'` (runtime) + `export * from './types.js'` (types) + `export { BuilderError } from './diagnostics.js'` (carrier) — data-only/type-only? BuilderError — runtime класс; root остаётся лёгким (без esbuild-импортов); subpath-модули невидимы из root (приватные pipelines). Прогнать весь `pnpm --filter @ycforge/builders-core test` — ВСЕ RED → GREEN (T010–T021 assertion sets в builders-core; pilot suite отдельно на T080+ после построения). **Depends**: T051, T052, T059, T062, T065.

---

## Phase 4: Integration — quickstart scenarios (Sc1–Sc8) + cross-package

**Purpose**: Сценарии quickstart Sc1–Sc8 формально валидируются против зелёного кода (сами тесты живут в unit-suite Phase 2 + pilot registry-loading, quickstart.md их маппит в таблице покрытия). Здесь — по-сценарийная верификация green + полный прогон обоих пакетов + runbook.

- [x] T080 Verify quickstart Sc1–Sc3 green: `pnpm --filter @ycforge/builders-core test -- --run test/unit/nestjs-function.spec.ts` — Sc1 (happy zip + `main.handler` + байт-детерминизм + SC-006), Sc2 (external sharp + `openapi_entry` ignore), Sc3 (`BLC_ENTRY_NOT_FOUND`, частичного артефакта нет). Если не green — вернуться в Phase 3. **Depends**: T066. — SC-001/003/006 (nestjs-часть).
- [x] T081 Verify quickstart Sc4–Sc5 green: `pnpm --filter @ycforge/builders-core test -- --run test/unit/docker.spec.ts` — Sc4 (fake docker, immutable `@sha256:` artifact, SC-004), Sc5 (no-digest → `BLC_IMAGE_DIGEST_UNAVAILABLE`; exit-7 → `BLC_BUILD_FAILED`; FR-012: fake docker не получил credential-arg/env). **Depends**: T066. — SC-004.
- [x] T082 Verify quickstart Sc6 green: `pnpm --filter @ycforge/builders-core test -- --run test/unit/vite.spec.ts` — env-injection observable, defaults, `BLC_BUILD_FAILED`, AC4 (нет исходников/секретов в `value.directory`). **Depends**: T066. — SC-001 (frontend-часть).
- [x] T083 Verify quickstart Sc7 green (cross-package): `pnpm --filter @ycforge/pilot test -- --run test/builders-core/registry-loading.spec.ts` (pretest строит builders-core dist) + type-test `-- --run test/types/builders-core-contract.test-d.ts` (conformance DQ-5) — три subpath-спецификатора загружаются `kind:'builder'`, ноль `BRG_*`, `validateBuilders` ok, `default.build` — Function. **Depends**: T020, T021, T066, T009. — SC-002.
- [x] T084 Verify quickstart Sc8 green: residual `{{$...}}` fail-fast во всех трёх builder-ах (`BLC_ENV_NOT_RESOLVED`; сборка не выполняется — docker push не вызывался, `.zip`/static не созданы) + unit `test/unit/env-residual.test.ts`. **Depends**: T066, T053. — SC-005.
- [x] T085 Full cross-package suite + runbook: `pnpm --filter @ycforge/builders-core test` И `pnpm --filter @ycforge/pilot test` (pretest builds builders-core; pilot zero-regression 011–015 + новый US4-suite) — всё green. Зафиксировать порядок запуска вручную и добавить краткий **Runbook** в конец этого файла (команды установки/сборки/тестов + что доказывает каждая команда), переиспользуя преамбулу quickstart.md. **Depends**: T080–T084. — SC-001..007 (оркестровочно).

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Полный toolchain clean, exports-санити (import/require каждого subpath из dist), консистентность `BLC_*` (src ↔ contracts JSON ↔ docs), детерминизм-инвариант, drafts, SC-007 traceability, закрытие checklist.

- [x] T100 Full suite green incl. baseline: `pnpm --filter @ycforge/builders-core test` и `pnpm --filter @ycforge/pilot test` (zero-regression 011–015 + US4) — с нуля: `pnpm install` → `pnpm --filter @ycforge/builders-core build` → оба test скрипта; зафиксировать финальное число тестов/файлов каждого пакета. **Depends**: T085.
- [x] T101 Exports sanity from dist: `node -e` для каждого subpath: `await import('@ycforge/builders-core')`, `.../nestjs-function`, `.../docker`, `.../vite` (ESM) — каждый успешно грузится, default-экспорт имеет поле `build: Function`; CJS-варианты через `require()` из `.cjs` тем же `exports`-map (консистентность `import`/`require` образцов); `require('@ycforge/builders-core')` даёт root-каталог+типы. Скрипт-проверка в CI-безопасной форме (никогда не падает по таймауту). **Depends**: T100.
- [x] T102 BLC_* consistency audit: (1) grep-verify в `src/` нет string-literal сравнений кодов (только `import { BLC_* }`), Хотя бы 7 констант в diagnostics.ts byte-for-byte == keys `contracts/builders-core.json` `#/errorCodes` == таблице DQ-в-top этого файла == data-model §6; (2) `contracts/builders-core.json` пропускается через валидатор JSON-schema (self-consistent: `errorCodes` required список == 7). **Depends**: T100.
- [x] T103 Typecheck + build clean: `pnpm --filter @ycforge/builders-core typecheck` → ноль ошибок (внимание: `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` на optional-полях конфигов и BuildContext); `pnpm --filter @ycforge/builders-core build` → dist содержит 4 entry × {esm, cjs, dts}; `pnpm --filter @ycforge/pilot typecheck` по-прежнему green (conformance type-test пинит типы builders-core). **Depends**: T100.
- [x] T104 Drafts & doc-hygiene: `contracts/builders-core.draft.ts` остаётся как plan-фаза reference (НЕ удалять, НЕ импортировать из src — grep-verify); `contracts/builders-core.json` — единый machine-контракт (упомянут в шапке diagnostics.ts через doc-комментарий); никаких копий каталога в `packages/builders-core/` (конвенция: каталоги в `specs/NNN-*/contracts/`, см. Ambiguity 1 015). **Depends**: T102.
- [x] T105 Determinism guard scan: grep-verify в `src/` нет `Date.now()`, `new Date()`, `Math.random()`, `randomUUID`, `process.uptime` и т.п. (SC-003: детерминизм — контракт; единственные недетерминированные данные — docker digest из registry, документировано); zip-writer не пишет текущее время (DQ-1); esbuild bundle детерминирован (без `--metafile`-timestamps в артефакте; фикс. заголовок). **Depends**: T100.
- [x] T106 SC-007 traceability report: заполнить раздел «Traceability» в конце этого файла: каждый AC (US1-AC1..4, US2-AC1..4, US3-AC1..4, US4-AC1..3, US5-AC1..3 = 18 + edge-case-инварианты) → тест-файл + строки (file:line точные после финализации); каждый FR-001..FR-020 → тест (FR-002 — zero-pilot-import T018; FR-003 — catalog T016; FR-004/007/008 — nestjs T010/T011; FR-009..013 — docker T012; FR-014..017/020 — vite T013; FR-018/019 — env-residual T014 + per-builder); каждый Sc1–Sc8 → T080–T084; каждый SC-001..007 → тест-задача (SC-003 — T010+T015, SC-004 — T012/T081, SC-005 — T014/T084, SC-006 — T010/T011, SC-007 — этот report); «каждый AC → ≥1 тест (RED → GREEN)» подтверждено прогонами Phase 4. **Depends**: T100–T105.
- [x] T107 Final checklist close-out: отметить все задачи `[x]` в этом файле (T001–T107), сверить `Done When` ниже, подтвердить, что plan.md Open Questions (6 шт.) разрешены в «Design decisions locked in» (DQ-1..DQ-6) этого файла; `specs/README.md` (018 🚧) и `.specify/feature.json` обновляет main agent на PR-этапе (НЕ здесь). **Depends**: T106.

---

## AC → Test Traceability (SC-007; file:line заполняется в T106)

| AC | Тест (файл — задача RED) |
|----|---------------------------|
| US1-AC1 (happy zip artifact + entryPoint) | `test/unit/nestjs-function.spec.ts` — T010 |
| US1-AC2 (external) | `test/unit/nestjs-function.spec.ts` — T011 |
| US1-AC3 (unknown-key ignore) | `test/unit/nestjs-function.spec.ts` — T011 |
| US1-AC4 (BLC_ENTRY_NOT_FOUND) | `test/unit/nestjs-function.spec.ts` — T011 |
| US2-AC1 (digest artifact) | `test/unit/docker.spec.ts` — T012 |
| US2-AC2 (digest unavailable) | `test/unit/docker.spec.ts` — T012 |
| US2-AC3 (FR-012 no-auth) | `test/unit/docker.spec.ts` — T012 |
| US2-AC4 (build failure) | `test/unit/docker.spec.ts` — T012 |
| US3-AC1 (env injection observable) | `test/unit/vite.spec.ts` — T013 |
| US3-AC2 (defaults) | `test/unit/vite.spec.ts` — T013 |
| US3-AC3 (build failure) | `test/unit/vite.spec.ts` — T013 |
| US3-AC4 (no sources/secrets) | `test/unit/vite.spec.ts` — T013 |
| US4-AC1 (registry loads 3 subpath builders) | pilot `test/builders-core/registry-loading.spec.ts` — T020 |
| US4-AC2 (validateBuilders ok) | pilot `test/builders-core/registry-loading.spec.ts` — T020 |
| US4-AC3 (default.build — Function) | pilot `test/builders-core/registry-loading.spec.ts` — T020 |
| US5-AC1 (nestjs residual) | `test/unit/nestjs-function.spec.ts` — T011 |
| US5-AC2 (docker residual) | `test/unit/docker.spec.ts` — T012 |
| US5-AC3 (vite residual) | `test/unit/vite.spec.ts` — T013 |
| Edge: sourcePath absent | `test/unit/{nestjs-function,docker,vite}.spec.ts` — T010–T013 |
| Edge: unknown top-level keys | `test/unit/nestjs-function.spec.ts` T011 (+ все builder-специфичные config-кейсы) |
| Edge: invalid known-field type | `test/unit/{nestjs-function,docker,vite}.spec.ts` — T010–T013 |
| Edge: immutable digest / no `latest` in value | `test/unit/docker.spec.ts` — T012 |
| Edge: docker CLI недоступен | `test/unit/docker.spec.ts` — T012 |
| Edge: residual `{{$…}}` (D-3) | `test/unit/env-residual.test.ts` T014 + T010–T013 |
| FR-001 | T019 + T020 (subpath importability, kind='builder') |
| FR-002 | T018 (zero-pilot-import) + T021 (structural conformance) |
| FR-003 | T016 (catalog + isArtifactType grammar) |
| FR-004/007/008 | T010–T011 (nestjs config/fail-fast/ignore-unknown) |
| FR-005 | T010–T011 (SC-006 bundle layout + external copy) |
| FR-006 | T015 (zip writer) + T010 (artifact shape) |
| FR-009..013 | T012 (docker config/build/push/digest/auth/fail-fast) |
| FR-014..017/020 | T013 (vite config/run/copy/fail-fast/buildEnv source) |
| FR-018/019 | T014 (scanBuildInput) + T010–T013 (per-builder reject) |
| SC-001 | T010/T012/T013 + T080–T082 |
| SC-002 | T020/T021 + T083 |
| SC-003 | T010 (по-байтный детерминизм) + T015 |
| SC-004 | T012 + T081 |
| SC-005 | T014 + T084 |
| SC-006 | T010 + T011 |
| SC-007 | T106 (этот report) + T100/T103 |

## Done When

- [x] `specs/018-builders-core/tasks.md` создан: 5 фаз (Setup / RED / GREEN / Quickstart / Polish), все задачи с ID, `[P]`/`[USn]` тегами, checkbox'ами и file-путями (формат-чеклист 013/015).
- [x] Каждый открытый вопрос plan.md (6 шт. — zip STORE/deflate+timestamp+CRC, sourcePath defaults, runtime→esbuild-target, external realpath copy, type-test placement, docker stderr payload) разрешён задокументированным решением (DQ-1..DQ-6) в этом файле.
- [x] Каждый AC/FR/SC/edge-case из spec 018 маппится на ≥1 RED-тест (раздел Traceability); RED-причина каждой test-задачи названа (стаб `'not implemented'` / отсутствующий тип / `BRG_NOT_A_PLUGIN`).
- [x] Внешние файлы, кроме `specs/018-builders-core/`, НЕ тронуты.
- [x] Extension hooks: `specs/018-builders-core/.specify/extensions.yml` отсутствует → pre/post hooks пропущены молча (проверено).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline+b) → T002 (package.json) → T003–T007 [P] (tsconfig/tsup/vitest/src-stubs/helpers) параллельно после T002; T009 (pilot devDep+pretest) — последний, зависит от T002 и `pnpm install`. Итог setup: пакет собирается, цепочка `test: tsup && vitest run` рабочий, pilot резолвит `@ycforge/builders-core/*`.
- **Tests (Phase 2)**: зависит от T006–T009. RED-тесты пишутся ДО реализации; падают по правильной причине (стаб/отсутствующий линк). T010–T021 [P] — разные файлы/пакеты, кроме внутренних связок (T010/T011 один `nestjs-function.spec.ts` — писать в одном прогоне).
- **Core (Phase 3)**: зависит от Phase 2 (green-им их). Порядок: T050 (types — блокирует type-импорты всех модулей) → T051–T054 [P] (catalog/diagnostics/env/config); T055/T056 [P] (zip) параллельно; per-builder: T057 → T058 → T059 (nestjs), T060 → T061 → T062 (docker), T063 → T064 → T065 (vite) — независимые цепочки [P] между собой; T066 (root export + полный green-прогон) — финал Phase 3.
- **Integration (Phase 4)**: зависит от Phase 3 и T009. T080–T084 [P] (по-сценарийные верификации) параллельно; T085 (полные suite'ы + runbook) — последний.
- **Polish (Phase 5)**: зависит от Phase 4. T100–T105 [P]-совместимы после T100; T106 traceability (нужны file:line финальных тестов); T107 — закрытие.

### Parallel Opportunities

- Setup: T003/T004/T005/T006/T007/T008 [P] после T002; T002/T009 последовательны (инсталляция).
- Phase 2: все RED-задачи [P] (разные файлы), кроме T010+T011 (один файл) и T019↔T021 независимы.
- Phase 3: три builder-цепочки (nestjs/docker/vite) полностью параллельны после T050–T054; T055/T056 — параллельно; T066 — объединяющий.
- Phase 4: T080–T084 [P]; T085 — после всех.
- Polish: T101–T105 [P] после T100; T106 после финализации; T107 последний.

### Within Each Builder Chain (пример: nestjs-function)

- Тесты RED (T010/T011) → config (T057) → bundle (T058) → index (T059) → green-прогон. Тест-фикстуры — только T007/T008.

---

## Parallel Example: Phase 3 builder chains

```bash
# После T050 (types) + T051–T054 (catalog/diagnostics/env/config) + T055/T056 (zip):
Task: "Implement nestjs-function chain (config T057 → bundle T058 → index T059)"
Task: "Implement docker chain (config T060 → cli T061 → index T062)"
Task: "Implement vite chain (config T063 → run T064 → index T065)"
# затем корневой экспорт и полный GREEN-прогон:
Task: "Implement src/index.ts root export (T066) + pnpm --filter @ycforge/builders-core test"
```

---

## Implementation Strategy

### MVP First (US1-only core path)

1. Setup T001–T009 (baseline + пакет + tags/helpers + pilot infra).
2. RED T010/T011 (nestjs), T014 (env-scan), T015 (zip), T016–T018 (catalog/diagnostics/zero-pilot), T019/T021 (types).
3. GREEN T050–T059 (types/catalog/diagnostics/env/config/zip/nestjs chain) → **STOP and VALIDATE**: `test/unit/nestjs-function.spec.ts` + `zip-writer.spec.ts` + `env-residual.test.ts` + `catalog.test.ts` green.
4. **MVP reached**: US1 (nestjs-function builder) собирает канонический `user_service` в `ycforge:function`-артефакт; затем наслаиваются US2 (docker) → US3 (vite) → US4 (registry) → US5 (guard).

### Incremental Delivery

1. Setup (T001–T009) → foundation (buildable package + pilot hook).
2. Общий слой (T050–T056): типы, каталог, BLC_*, env-guard, детерминированный zip.
3. US1 (T057–T059) → US2 (T060–T062) → US3 (T063–T065) — независимо, параллельно.
4. Root export T066 → full green.
5. Sc1–Sc8 (T080–T084) → полные suite'ы + runbook (T085) → Polish (T100–T107).

### Parallel Team Strategy

1. Setup вместе (T001–T009).
2. Developer A: US1 (nestjs) + zip + env.
3. Developer B: US2 (docker) + catalog/diagnostics.
4. Developer C: US3 (vite) + pilot US4/type-conformance.

---

## Runbook (T085; финальные команды валидации)

```bash
# 1. Установка (workspace lockfile; esbuild allowBuilds уже открыт в pnpm-workspace.yaml)
pnpm install

# 2. Сборка builders-core (dist: 4 entry × {esm,cjs,dts})
pnpm --filter @ycforge/builders-core build

# 3. Пакет: unit + zip + catalog + diagnostics + zero-pilot + type-tests (tsup && vitest run)
pnpm --filter @ycforge/builders-core test

# 4. Typecheck пакета
pnpm --filter @ycforge/builders-core typecheck

# 5. Pilot: zero-regression 011–015 + US4 registry-loading + conformance type-test
#    (pretest собирает builders-core автоматически)
pnpm --filter @ycforge/pilot test

# 6. Точка входа US4 (изолированно): три subpath-спецификатора → kind:'builder', BRG_* = 0
pnpm --filter @ycforge/pilot test -- --run test/builders-core/registry-loading.spec.ts

# 7. Каждый подпуть грузится из dist (exports sanity, T101)
node -e "import('@ycforge/builders-core').then(m => console.log(Object.keys(m)))"
node -e "import('@ycforge/builders-core/nestjs-function').then(m => console.log(typeof m.default.build))"
node -e "import('@ycforge/builders-core/docker').then(m => console.log(typeof m.default.build))"
node -e "import('@ycforge/builders-core/vite').then(m => console.log(typeof m.default.build))"
```