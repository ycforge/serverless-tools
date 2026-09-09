---
description: "Task list for materializers-core — yandex-function/container/api-gateway/queue/bucket TF materializers, YMT_* diagnostics, artifact catalog"
---

# Tasks: materializers-core — `@ycforge/materializers-core` (5 yandex-материализаторов + YMT_* + каталог)

**Input**: Design documents from `/specs/019-materializers-yandex/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/materializers-core.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion (8 AC по US1–US3 плюс edge-case-инварианты; SC-001..SC-007), каждый FR-001..FR-027 и каждый quickstart-сценарий Sc1–Sc6 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED (падают по правильной причине: целевой модуль — стаб `'not implemented'` / отсутствующий тип / незарегистрированный каталог, а не по ошибке фикстуры). Constitution II exception НЕ применяется (материализаторы — чистые трансляции артефакт → `TerraformResource`, не thin CLI wrapper). Pilot (поверх 014 + cross-package conformance) должен оставаться zero-regression на каждом шаге; production-код pilot не трогается.

**Organization**: Задачи сгруппированы по фазам Setup / Foundational (типы + диагностики + каталог — блокируют все stories) / US1 (yandex-function) / US2 (yandex-serverless-container + yandex-storage-bucket) / US3 (yandex-api-gateway + yandex-message-queue) / Polish (pilot conformance + quickstart Sc1–Sc6), зеркаля 018: каждый модуль `packages/materializers-core/src/` реализуется test-first, а весь quickstart-suite валидируется в конце.

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[US1]/[US2]/[US3]**: Приоритетные P1 user stories
- Include exact file paths in descriptions

## Design decisions locked in (plan/research open questions → behavior + tests)

**DQ-1 — API Gateway `spec` attribute: `file()` + `${path.module}` verbatim (plan Q1, resolved)**. `configuration.spec` = строка `file("${path.module}/generated/<app_id>-openapi.yaml")` дословно (IDEA §32, data-model §5.3). Материализатор генерирует её сам; dispatch (021) при сериализации `.tf.json` оставляет `${...}`-строку как TF-интерполяцию (паттерн dispatch serialize). Проверяется точным string-equality в тесте — никакого `templatefile()` (research D-RE-4: прямая замена в companion-файле).

**DQ-2 — `content.zip_filename`: infra-relative `archivePath` verbatim (plan Q2, resolved)**. `ycforge:function` artefact: `value.archivePath` интерпретируется как путь к архиву **относительно `infra/`** (POSIX; `../`-формы допустимы). Материализатор HЕ переписывает его для `zip_filename` (FR-010: относительный, никогда не absolute); переписывание absolute→infra-relative выполняет dispatch 021 на этапе построения artefact value. Guard: absolute-путь (leading `/`, drive-форма `^[A-Za-z]:`) на входе → fail-fast `YMT_INVALID_ARTIFACT_VALUE` (никакой «magic»-релятивизации в materializer — Constitution V). `user_hash` (FR-009): файл читается по `resolve(process.cwd(), value.archivePath)` (fixture: tmp-zip + `relative(process.cwd(), absZip)` — герметично, без chdir). Тест: fixture archivePath = relative-форма; assert `zip_filename === value.archivePath` + `!isAbsolute(zip_filename)`. — *forward-contract refinement над формулировкой spec 018 «absolute path» на материализационной границе; зафиксировано здесь.*

**DQ-3 — Multi-resource dispatch: spec 014 НЕ расширяется (plan Q3, resolved)**. 014-dispatch остаётся single-resource (`materializeAll` пушет один `resource`; `materialize()` вызывается без `value` — descriptor `{ id, name, type }`). Поэтому SC-002-тест в pilot работает на **уровне selection** (`selectArtifacts`: `supports()` по `descriptor.type`, 0× `MTL_COLLISION` / 0× `MTL_UNHANDLED_ARTIFACT`) + registry-loading (5 subpath, `kind:'materializer'`, 0× `BRG_*`); materialize-с-артефакт-значениями и flattening `TerraformResource[]` — в 021. Bucket `materialize()` возвращает `readonly TerraformResource[]` (D-RE-5); тест этого возврата герметичен на уровне пакета (`test/unit/yandex-storage-bucket.spec.ts`), без прогона через pilot-dispatch.

**DQ-4 — `user_hash` = SHA-256 hex содержимого архива (research D-RE-6, resolved)**. `node:crypto` `createHash('sha256')` по байтам файла (async readFile), hex-строка. Детерминизм: одинаковые байты → идентичный hash. Проверяется: fixture-хелпер `makeZip()` считает ожидаемый SHA-256 известных байтов; repeat-call assert — конфигурация байт-идентична.

**DQ-5 — `YMT_EMPTY_DIRECTORY` — warning-канал, не throw (plan Q4, resolved)**. Функция `materialize()` НЕ бросает при пустой директории (FR-024: bucket создаётся). Warning эмитится через согласованный warning-chaining: materializer возвращает результат, а warning фиксируется константой `YMT_EMPTY_DIRECTORY` в сообщении/структуре (утверждается в тесте: bucket resource возвращён + константа-участник; не `throw`). Решение не влияет на контракт `TerraformResource` (документировано для 021).

**DQ-6 — Type-test placement: оба файла остаются (plan Q5, resolved)**. (а) materializers-core `test/types/materializers-core.test-d.ts` — standalone, пинит собственный публичный API пакета (типы, 5-элементный `ArtifactType` union, `MaterializerId`, 3 `YMT_*`, multi-resource return, importability из построенных subpath), **без импортов `@ycforge/pilot`**; (б) pilot `test/types/materializers-core-contract.test-d.ts` — кросс-пакетная структурная conformance (spec-002 контракты assignable ⇄ replicas) + additive-проверка multi-resource. Не фолдим: (б) проверяет границу контракта у потребителя, (а) — целостность пакета.

**DQ-7 — companion-файл API Gateway: `<cwd>/generated/<app_id>-openapi.yaml` (plan Q2-вариант B, resolved)**. Материализатор пишет companion по `resolve(process.cwd(), 'generated', '<app_id>-openapi.yaml')` (mkdir recursive). `spec`-атрибут ссылается на `file("${path.module}/generated/...")` (module dir = `infra/`). Контракт на 021: вызывать `materialize()` с cwd = terraform module dir (`infra/`), чтобы companion лёг рядом с `${path.module}` (зафиксировано здесь; unit-тест переключает cwd в mkdtemp — единственный файл spec, работающий с chdir: весь файл последовательный, cwd восстанавливается в `afterEach`). Детерминизм содержимого companion не зависит от cwd (SC-006-исключение: путь companion различается, содержимое — идентично).

**DQ-8 — `OutputBuilder` мапит pilot `createOutputBuilder` (plan «duplicate → error» уточнено, resolved)**. Standalone `helpers/output-builder.ts` зеркалит `packages/pilot/src/materialize/context.ts`: first-wins `declare` + запись дублей в `duplicateNames` (коллизии имён → `MTL_OUTPUT_NAME_COLLISION` на serialize у C; никогда silent merge — Constitution V). Это сохраняет структурную conformance (assignability) и не вводит отдельный error-канал в пакете.

**DQ-9 — queue `region`: default `ru-central1` (plan Q6, resolved)**. НЕ извлекается из host (хрупко, без выгоды); `queue_name` = последний path segment после `/queues/`; base URL не парсится / нет `/queues/`-сегмента → fail-fast `YMT_INVALID_QUEUE_URL` (research D-RE-7).

---

## Path Conventions

- **Monorepo package**: `packages/materializers-core/src/` — source, `packages/materializers-core/test/` — tests
- **Public surface**: `src/index.ts` (catalog + types, FR-003), подпуть-entry-модули `src/{yandex-function,yandex-serverless-container,yandex-api-gateway,yandex-message-queue,yandex-storage-bucket}/index.ts` (каждый default-export `Materializer` — `supports` + `materialize`, FR-001), экспорт через `package.json` `exports` map (6 подпутей)
- **Private shared modules**: `src/{types,catalog,diagnostics}.ts`, `src/helpers/{output-builder,filename}.ts`, `src/yandex-function/hash.ts`, `src/yandex-api-gateway/ref-resolver.ts`
- **Unit tests**: `packages/materializers-core/test/unit/{yandex-function,yandex-serverless-container,yandex-storage-bucket,yandex-api-gateway,yandex-message-queue}.spec.ts`, `catalog.test.ts`, `diagnostics.test.ts`, `zero-pilot-import.test.ts`, `output-builder.spec.ts`, `smoke.test.ts`
- **Fixture helpers**: `test/helpers/fixtures.ts`
- **Type tests**: `packages/materializers-core/test/types/materializers-core.test-d.ts` (vitest typecheck include)
- **Pilot (test-only delta, cross-package)**: `packages/pilot/test/materializers-core/dispatch-loading.spec.ts`, `packages/pilot/test/types/materializers-core-contract.test-d.ts`; `packages/pilot/package.json` devDep + pretest
- **Диагностики**: `YMT_INVALID_QUEUE_URL / YMT_INVALID_ARTIFACT_VALUE / YMT_EMPTY_DIRECTORY` — константы `src/diagnostics.ts`, машиночитаемый каталог — `specs/019-materializers-yandex/contracts/materializers-core.json` `#/errorCodes`
- ⚠️ **Runtime зависимостей НОЛЬ**: только node builtins (`node:crypto`, `node:url`, `node:fs`, `node:path`). `@ycforge/pilot` отсутствует в любых deps (FR-002, Constitution I).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Создать `packages/materializers-core` (package.json, tsconfig, tsup, vitest, src-каркас со стабами, тест-хелперы), baseline-валидация pilot (zero-regression 014 до изменений), перепроверка фактов монорепы. Последняя задача setup — pilot test-infra delta (devDep + pretest), включающая cross-package-инъекцию.

- [ ] T001 Verify baseline + monorepo dep facts: прогнать `pnpm --filter @ycforge/pilot test` — текущий baseline (014 + предыдущие suites + type-tests) green ДО изменений. Перепроверить факты research: `packages/pilot/package.json` уже содержит `devDependencies["@ycforge/builders-core"] = workspace:*` и `scripts.pretest = "pnpm --filter @ycforge/builders-core build"`; `packages/builders-core/package.json` — образец (6-subpath форма, `test: tsup && vitest run`, `typecheck: tsc --noEmit`); `pnpm-workspace.yaml` allowBuilds-конфиг; `node --version` ≥ 22. Записать актуальное число тестов/файлов baseline как точку отсчёта для T107/T113. (`workdir=repo root`)
- [ ] T002 [P] Create `packages/materializers-core/package.json` per `data-model.md` §1: `name: @ycforge/materializers-core`, `version: 0.1.0`, `description`, `license: MIT`, `type: module`, `engines.node: ">=22"`, `exports` map ровно 6 подпутей (`.`, `./yandex-function`, `./yandex-serverless-container`, `./yandex-api-gateway`, `./yandex-message-queue`, `./yandex-storage-bucket` — каждый `{ types/import/require }` → `./dist/<path>.{d.ts,js,cjs}` с `dist/yandex-function/index.*`-формами для подупутей), `files: ["dist"]`, `sideEffects: false`, `publishConfig.access: public`, `scripts: { build: "tsup", test: "tsup && vitest run", typecheck: "tsc --noEmit" }`, **ноль `dependencies`**, `devDependencies: { @types/node, tsup, typescript, vitest }` (версии = pilot mirror). После создания — `pnpm install` (обновление workspace lockfile) и проверить, что pnpm видит пакет (`pnpm list --filter @ycforge/materializers-core`). **Depends**: T001.
- [ ] T003 [P] Create `packages/materializers-core/tsconfig.json` — точная копия `packages/pilot/tsconfig.json` (strict, NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, target ES2022, `types: ["node"]`, `noEmit: true`) с include `["src/**/*.ts", "test/**/*.ts", "tsup.config.ts"]`. **Depends**: T002.
- [ ] T004 [P] Create `packages/materializers-core/tsup.config.ts` — multi-entry по образцу builders-core: `entry: { index: 'src/index.ts', 'yandex-function/index': 'src/yandex-function/index.ts', 'yandex-serverless-container/index': 'src/yandex-serverless-container/index.ts', 'yandex-api-gateway/index': 'src/yandex-api-gateway/index.ts', 'yandex-message-queue/index': 'src/yandex-message-queue/index.ts', 'yandex-storage-bucket/index': 'src/yandex-storage-bucket/index.ts' }`, `format: ['esm','cjs']`, `dts: true`, `clean: true`, `sourcemap: true`, `minify: false`. **Depends**: T002.
- [ ] T005 [P] Create `packages/materializers-core/vitest.config.ts` — `test.typecheck.enabled: true`, `include: ['test/types/**/*.test-d.ts']` (копия builders-core/pilot-конфигурации). **Depends**: T002.
- [ ] T006 [P] Scaffold `packages/materializers-core/src/` стабы — файлы per `data-model.md` §2–§5: `index.ts`, `types.ts`, `catalog.ts`, `diagnostics.ts`, `helpers/{output-builder,filename}.ts`, `yandex-function/{index,hash}.ts`, `yandex-serverless-container/index.ts`, `yandex-api-gateway/{index,ref-resolver}.ts`, `yandex-message-queue/index.ts`, `yandex-storage-bucket/index.ts`: сигнатуры/типы поверх `data-model.md` и `contracts/materializers-core.json`; логика НЕ реализована (`throw new Error('not implemented')` / заглушка-значение). Root `src/index.ts` — placeholder (константа `MATERIALIZERS_CORE_VERSION`) + минимальный placeholder-тест `test/unit/smoke.test.ts` (pass), чтобы цепочка `tsup && vitest run` работала end-to-end (self-reference subpath imports → нужен построенный dist). Прогнать `pnpm --filter @ycforge/materializers-core test` — build 6 entries + vitest зелёные. RED-тесты Phase 2/3/4/5 импортируются отсюда (относительные импорты из `test/unit`). **Depends**: T003, T004, T005.
- [ ] T007 [P] Create `packages/materializers-core/test/helpers/fixtures.ts` — mkdtemp-фабрики (герметично, параллельно-безопасно, БЕЗ process.env-мутаций, cleanup через `afterEach`): `makeZipUnder(tmpRoot, filename, bytes)` — реальный `.zip`-файл c известным содержимым, возвращает `{ path (absolute), relativePath (join('.', relative(process.cwd(), path))), sha256 }` (SHA-256 от байтов через `createHash`); `makeSpecFile(content)` — tmp OpenAPI YAML c `${resources.functions.user_service.id}`; `makeStaticDir(files)` — tmp-каталог с 3 файлами (`index.html`, `style.css`, `app.js` — точки для проверки sanitization) + вариант empty-dir; `makeQueueUrl(valid)` — валидный (`https://message-queue.api.cloud.yandex.net/{cloudId}/queues/{queueId}`) / инвалидный URL (без `/queues/`). **Depends**: T002.
- [ ] T008 Pilot test-infra delta (cross-package enable): `packages/pilot/package.json` — `devDependencies += { "@ycforge/materializers-core": "workspace:*" }`; `scripts.pretest` расширить до `pnpm --filter @ycforge/builders-core build && pnpm --filter @ycforge/materializers-core build`; `scripts.typecheck` аналогично (`pnpm --filter @ycforge/builders-core build && pnpm --filter @ycforge/materializers-core build && tsc --noEmit`). `pnpm install` → обновление lockfile + workspace-symlink в `packages/pilot/node_modules/@ycforge/materializers-core`. Верификация цепочки: после `pnpm --filter @ycforge/materializers-core build` из `packages/pilot` успешно резолвится `node -e "import('@ycforge/materializers-core/yandex-function')"`. НИКАКИХ production-изменений pilot; контракты `@ycforge/pilot/contracts` не трогаются (D-RE-10). **Depends**: T002. — *создаётся последним в setup: включает cross-package-тесты Phase 6.*

---

## Phase 2: Foundational — общие типы, диагностики, каталог (блокирует все stories)

**Purpose**: Standalone structural types (FR-002, zero pilot imports), `YMT_*` diagnostics + `MaterializerError` (FR-026/027), materializer catalog (FR-003, включает 2 новых forward-contract типа D-3), shared helpers (`output-builder`, `filename`). Тесты RED → имплементация GREEN. Без этой фазы ни один story не реализуем (блокирующий слой).

### Foundational tests (RED)

- [ ] T010 [P] RED unit-test `packages/materializers-core/test/unit/catalog.test.ts` — FR-003/D-3 (src/catalog.ts, публичный root-экспорт): `MATERIALIZER_IDS` ровно 5 (`yandex-function`, `yandex-serverless-container`, `yandex-api-gateway`, `yandex-message-queue`, `yandex-storage-bucket`); `ARTIFACT_CATALOG` маппит каждый id → `{ artifactType }`: function→`ycforge:function`, serverless-container→`ycforge:docker-image`, api-gateway→`ycforge:api-gateway`, message-queue→`ycforge:queue`, storage-bucket→`ycforge:frontend`; `ARTIFACT_TYPES` = frozen 5-элементный (вкл. 2 новых forward-contract D-3); каждая строка `Artifact.type` проходит локальную копию грамматики pilot `isArtifactType` = `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` (research D-RE-3); root `@ycforge/materializers-core` экспортирует каталог + типы (import через self-reference построенного dist). RED: стаб-каталог пуст/не импортируется.
- [ ] T011 [P] RED unit-test `packages/materializers-core/test/unit/diagnostics.test.ts` — src/diagnostics.ts vs `specs/019-materializers-yandex/contracts/materializers-core.json` (Constitution V, «constants, not literals»): ровно 3 константы `YMT_INVALID_QUEUE_URL`/`YMT_INVALID_ARTIFACT_VALUE`/`YMT_EMPTY_DIRECTORY`; набор констант byte-for-byte совпадает с keys `#/errorCodes` JSON-контракта (JSON считывается тестом из 'specs/019-materializers-yandex/contracts/materializers-core.json' относительно репо-рута); `MaterializerError` — instance of `Error`, `name === 'MaterializerError'`, поле `code === YMT_*`, при наличии `materializer` — set; factory `materializerError(code, message, { materializer? })` с default-дефолтами. RED: константы отсутствуют.
- [ ] T012 [P] RED unit-test `packages/materializers-core/test/unit/zero-pilot-import.test.ts` — FR-002/Constitution I: статический walk `packages/materializers-core/src/**/*.ts` (паттерн pilot `zero-dependency.test.ts`): НОЛЬ value-position импортов `@ycforge/pilot`; плюс assert, что `packages/materializers-core/package.json` не содержит `@ycforge/pilot` ни в dependencies/devDependencies/peerDependencies. RED: guard-guard — стабы без импортов, пакет.json = текущее состояние (green немедленно, фиксирует инвариант; трактуем как guard-тест).
- [ ] T013 [P] RED unit-test `packages/materializers-core/test/unit/output-builder.spec.ts` (+ filename sanitization) — helpers (src/helpers/{output-builder,filename}.ts, DQ-8, FR-025): `OutputBuilder`-collector явных деклараций: first-wins `declare(name, { value, description? })`, запись дублей в `duplicateNames` (коллизия = сигнал C, не silent merge), description опционален (`exactOptionalPropertyTypes`); `sanitizeFilename`: `[a-zA-Z0-9_]`-только (замена `[^\w]`→`_`, дедуп `__`, trim ведущих/хвостовых `_`): `index.html`→`index_html`, `style.css`→`style_css`, `app.js`→`app_js`, `my--file.name`→`my_file_name`, `-leading`→`leading`; результирующее `<name>` удовлетворяет TF address-грамматике `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. RED: 'not implemented'.
- [ ] T014 [P] RED type-test `packages/materializers-core/test/types/materializers-core.test-d.ts` (standalone, без pilot-импортов, DQ-6): importability `Materializer/MaterializationContext/OutputBuilder/TerraformResource/Artifact`, value-shapes `FunctionArtifactValue/DockerArtifactValue/FrontendArtifactValue/ApiGatewayArtifactValue/QueueArtifactValue/ResourceReference`, `MATERIALIZER_IDS/ARTIFACT_CATALOG/ARTIFACT_TYPES/MaterializerId/ArtifactType`, 3 `YMT_*` константы из построенных подпутей `@ycforge/materializers-core` и `@ycforge/materializers-core/{yandex-function,yandex-serverless-container,yandex-api-gateway,yandex-message-queue,yandex-storage-bucket}` (само-ссылка через exports); `expectTypeOf` — `ArtifactType` равен union ровно 5-literal (вкл. `ycforge:api-gateway`, `ycforge:queue`); `default`-экспорт каждого subpath имеет поле `supports: (artifact, context) => boolean` и `materialize: (artifact, context) => Promise<TerraformResource | readonly TerraformResource[]>` (D-RE-5 additive multi-resource, FR-001). RED: dist.d.ts ещё не содержит типов (stubs), compile-fail — правильная причина.

### Foundational implementation (GREEN)

- [ ] T030 Implement `packages/materializers-core/src/types.ts` — standalone structural типы per data-model §3: `OutputBuilder` (`declare(name, output: { value; description? }): void`), `MaterializationContext` (`{ readonly output: OutputBuilder }`), `TerraformResource<T = unknown>` (`kind:'resource'; type; name; configuration`), `Artifact<T = unknown>` (`type; value`), `Materializer<A = Artifact>` (`supports(artifact, context): boolean` + `materialize(artifact, context): Promise<TerraformResource | readonly TerraformResource[]>` — additive multi-resource D-RE-5); value-shapes `FunctionArtifactValue`/`DockerArtifactValue`/`FrontendArtifactValue` (из spec 018) + forward-contract `ApiGatewayArtifactValue`/`QueueArtifactValue` + `ResourceReference` (`{ logical; terraformType }`) per data-model §3.2. НОЛЬ импортов pilot (Constitution I; T012 guard). **Depends**: T014 (RED shapes). — green T014.
- [ ] T031 [P] Implement `packages/materializers-core/src/catalog.ts` — `MATERIALIZER_IDS = ['yandex-function','yandex-serverless-container','yandex-api-gateway','yandex-message-queue','yandex-storage-bucket'] as const`, `MaterializerId` (union из 5), `ARTIFACT_CATALOG` (5 записей `{ artifactType }`, mapping из data-model §4), `ARTIFACT_TYPES` frozen 5-элементный (вкл. 2 новых D-3), `ArtifactType = (typeof ARTIFACT_CATALOG)[MaterializerId]['artifactType']` (literal-union ровно 5). **Depends**: T010, T030. — green T010.
- [ ] T032 [P] Implement `packages/materializers-core/src/diagnostics.ts` — 3 `YMT_*` константы (FR-026/027, никогда литералы — T011) + `MaterializerError` (extends Error, `code`, `materializer?`) + factory `materializerError(code, message, options?)` c `name = 'MaterializerError'`; сообщения содержат `(<code>)` (grep-абильны, паттерн BLC_/MTL_). **Depends**: T011, T030. — green T011.
- [ ] T033 [P] Implement `packages/materializers-core/src/helpers/output-builder.ts` — collector per DQ-8 (зеркало `packages/pilot/src/materialize/context.ts`): `declare` first-wins, дубли в `duplicateNames` (никогда silent merge — Constitution V), `OutputBuilderWithCollection` shape (`declared` + `duplicateNames` геттеры). **Depends**: T013, T030. — green T013 (output-builder-часть).
- [ ] T034 [P] Implement `packages/materializers-core/src/helpers/filename.ts` — `sanitizeFilename(filename): string` per research D-RE-8/DQ: `[^\w]`→`_`, дедуп `_`, trim ведущих/хвостовых `_`; пустой результат после trim → fallback `file` (address-существование); export `isTfAddress(value): boolean` = `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. **Depends**: T013, T030. — green T013 (filename-часть).
- [ ] T035 Implement `packages/materializers-core/src/index.ts` — публичный root-экспорт (FR-003): runtime-артефакты `ARTIFACT_CATALOG`/`ARTIFACT_TYPES`/`MATERIALIZER_IDS` (catalog.ts), `YMT_INVALID_QUEUE_URL`/`YMT_INVALID_ARTIFACT_VALUE`/`YMT_EMPTY_DIRECTORY` + `MaterializerError` (diagnostics.ts); type-экспорты всех standalone-типов, value-shapes, `ResourceReference`, `ArtifactType`/`MaterializerId`. Прогнать весь `pnpm --filter @ycforge/materializers-core test` — ВСЕ foundational RED (T010–T014) → GREEN. **Depends**: T031–T034. — green T010–T014.

---

## Phase 3: US1 — yandex-function materializer (P1)

**Purpose**: Материализатор `ycforge:function` → `yandex_function` (US1: DevOps материализует функцию `user_service`). Тест RED (по AC US1-1..3, FR-007..010, SC-006) ДО реализации; затем GREEN.

### Tests (RED)

- [ ] T040 [P] [US1] RED unit-test `packages/materializers-core/test/unit/yandex-function.spec.ts` (fixtures через `test/helpers/fixtures.ts` T007): (AC1) artifact `{ type:'ycforge:function', value:{ archivePath: <relative-форма tmp-zip>, entryPoint:'index.handler' } }` → `materialize()` → `TerraformResource { kind:'resource', type:'yandex_function', name:'<app_id>', configuration }`; `configuration.entrypoint === 'index.handler'`; `configuration.runtime === 'nodejs22'` (default FR-008/DQ); `configuration.content.zip_filename` существует и равен `value.archivePath` verbatim + `!isAbsolute` (FR-010, DQ-2); `configuration.user_hash` — SHA-256 hex содержимого архива = `fixture.sha256` (FR-009, D-RE-6); repeat-call с тем же artifact → конфигурация байт-идентична (SC-006 детерминизм, исключая companion-path — здесь его нет); (AC2) `supports({ type:'ycforge:docker-image', value:{} }, context) === false`, `supports({ type:'ycforge:function', value }, context) === true`; (AC3) `context.output` содержит `declare('<name>_function_id', { value:'yandex_function.<name>.id' })` (FR-005); (FR-004) `type`/`name` проходят TF address-грамматику; fail-fast: value без `archivePath`/`entryPoint` → `MaterializerError` c кодом `YMT_INVALID_ARTIFACT_VALUE` (константа, не литерал — FR-027); absolute-path `archivePath` (`/abs/...`) → `YMT_INVALID_ARTIFACT_VALUE` (DQ-2 guard). RED: стаб бросает `'not implemented'`.

### Implementation (GREEN)

- [ ] T050 [US1] Implement `packages/materializers-core/src/yandex-function/hash.ts` — `sha256Hex(filePath: string): Promise<string>` — `readFile` байтов архива (path как в artifact value; resolution `isAbsolute ? path : resolve(process.cwd(), path)`), `createHash('sha256')` → hex-строка (research D-RE-6); fs-ошибка чтения файла пробрасывается (trust builder output, spec Edge Cases: отсутствие файла → ошибка на apply, НЕ искажённая в YMT). **Depends**: T040, T030. — green hash-часть US1.
- [ ] T051 [US1] Implement `packages/materializers-core/src/yandex-function/index.ts` — default-export `Materializer`: `supports(artifact) === artifact.type === 'ycforge:function'` (FR-006); `materialize` = validate value (отсутствие `archivePath`/`entryPoint`/absolute-path → `YMT_INVALID_ARTIFACT_VALUE`, константы, DQ-2) → `user_hash = await sha256Hex(value.archivePath)` → `TerraformResource { kind:'resource', type:'yandex_function', name:<app_id>, configuration:{ runtime:'nodejs22', entrypoint: value.entryPoint, user_hash, content:{ zip_filename: value.archivePath } } }` (FR-007..010, minimal per IDEA §27) → `context.output.declare('<name>_function_id', { value:'yandex_function.<name>.id' })` (FR-005). **Depends**: T050, T033. — green T040 (US1). **MVP REACHED**: `user_service` генерирует `yandex_function`.

---

## Phase 4: US2 — yandex-serverless-container + yandex-storage-bucket (P1)

**Purpose**: Материализаторы `ycforge:docker-image` → `yandex_serverless_container` и `ycforge:frontend` → `yandex_storage_bucket` + N×`yandex_storage_object` (US2: DevOps материализует `analytics`-контейнер и `frontend`-бакет). Bucket — единственный multi-resource materializer (D-RE-5). Тесты RED по AC US2-1..3 + FR-011..013 / FR-021..025, затем GREEN.

### Tests (RED)

- [ ] T060 [P] [US2] RED unit-test `packages/materializers-core/test/unit/yandex-serverless-container.spec.ts` (US2-AC1, FR-011..013): artifact `{ type:'ycforge:docker-image', value:{ image:'cr.yandex/app@sha256:abc123' } }` → `materialize()` → `TerraformResource { kind:'resource', type:'yandex_serverless_container', name:'<app_id>', configuration:{ image:'cr.yandex/app@sha256:abc123' (as-is, immutable, FR-013), name:'<app_id>' } }` (FR-012); `supports({ type:'ycforge:function' }) === false`, `supports(ycforge:docker-image) === true` (FR-011); `image` НЕ трансформирован (никаких default-тегов/переписываний); repeat-call → конфигурация байт-идентична (SC-006); отсутствие `image` → `YMT_INVALID_ARTIFACT_VALUE` (константа); `context.output` содержит `declare('<name>_container_id', { value:'yandex_serverless_container.<name>.id' })` (FR-005); address-грамматика type/name (FR-004). RED: 'not implemented'.
- [ ] T061 [P] [US2] RED unit-test `packages/materializers-core/test/unit/yandex-storage-bucket.spec.ts` (US2-AC2/AC3, FR-021..025, SC-005/006, DQ-5): (AC2) fixture dir c 3 файлами (`index.html`, `style.css`, `app.js`) → `materialize()` возвращает `readonly TerraformResource[]` из 4 ресурсов: 1× `yandex_storage_bucket` (name `<app_id>`, configuration `{ bucket:'<app_id>', acl:'public-read' }` — FR-022) + 3× `yandex_storage_object` (names `<app_id>_index_html`, `<app_id>_style_css`, `<app_id>_app_js` — sanitization FR-025/DQ-8; configuration `{ bucket:'yandex_storage_bucket.<app_id>.id', key:<original basename (напр. 'index.html'), source:<absolute file path> }` — FR-023); (AC3/DQ-5) пустой dir → ровно 1 ресурс `yandex_storage_bucket`, СИГНАЛ `YMT_EMPTY_DIRECTORY` (warning-константа, не throw — FR-024); (SC-006) listing отсортирован алфавитно — repeat-call порядок и конфигурации байт-идентичны; `supports({ type:'ycforge:function' }) === false`, `ycforge:frontend` → true (FR-021); отсутствие `directory` → `YMT_INVALID_ARTIFACT_VALUE`; `context.output` содержит `declare('<name>_bucket_id', { value:'yandex_storage_bucket.<name>.id' })` (FR-005); address-грамматика всех names (FR-004/025). RED: 'not implemented'.

### Implementation (GREEN)

- [ ] T070 [P] [US2] Implement `packages/materializers-core/src/yandex-serverless-container/index.ts` — default-export `Materializer`: `supports === 'ycforge:docker-image'` (FR-011); `materialize` = validate `image` (отсутствие → `YMT_INVALID_ARTIFACT_VALUE`) → `{ kind:'resource', type:'yandex_serverless_container', name:<app_id>, configuration:{ image: value.image (verbatim), name:<app_id> } }` (FR-012/013) → `context.output.declare('<name>_container_id', { value:'yandex_serverless_container.<name>.id' })`. **Depends**: T060, T030, T033. — green T060.
- [ ] T071 [US2] Implement `packages/materializers-core/src/yandex-storage-bucket/index.ts` — default-export `Materializer` (multi-resource, D-RE-5): `supports === 'ycforge:frontend'` (FR-021); `materialize` = validate `directory` (→ `YMT_INVALID_ARTIFACT_VALUE`) → list каталог рекурсивно, относительные path-и **отсортированны алфавитно** (SC-006, DQ-детерминизм); 0 файлов → bucket-only + warning-эмиссия `YMT_EMPTY_DIRECTORY` (DQ-5, FR-024); собрать `yandex_storage_bucket` `{ bucket:'<app_id>', acl:'public-read' }` (FR-022, IDEA §36 default) + на каждый файл `yandex_storage_object` `{ name:'<app_id>_<sanitizeFilename(basename)>', configuration:{ bucket:'yandex_storage_bucket.<app_id>.id', key:<relative-имя как в листинге>, source:<absolute path> } }` (FR-023/025, sanitize через T034) → вернуть `readonly TerraformResource[]` (D-RE-5/blocks stories: return type из types.ts) → `context.output.declare('<name>_bucket_id', { value:'yandex_storage_bucket.<name>.id' })`. **Depends**: T061, T034, T033, T031. — green T061 (US2).

---

## Phase 5: US3 — yandex-api-gateway + yandex-message-queue (P1)

**Purpose**: Материализаторы `ycforge:api-gateway` → `yandex_api_gateway` (US3: DevOps материализует `openapi`-шлюз с resource references; companion-файл + ref replacement, D-RE-4 — прямая замена, не `templatefile()`) и `ycforge:queue` → `yandex_message_queue` (FR-018..020, `YMT_INVALID_QUEUE_URL` fail-fast). Тесты RED по AC US3-1..2 + FR-014..020, затем GREEN.

### Tests (RED)

- [ ] T080 [P] [US3] RED unit-test `packages/materializers-core/test/unit/yandex-message-queue.spec.ts` (FR-018..020/026, Sc5, DQ-9): artifact `{ type:'ycforge:queue', value:{ queueUrl:'https://message-queue.api.cloud.yandex.net/b1g1/queues/my-queue' } }` → `materialize()` → `TerraformResource { kind:'resource', type:'yandex_message_queue', name:'<app_id>', configuration:{ queue_name:'my-queue' (последний path segment после /queues/), region:'ru-central1' (default, D-RE-7/DQ-9) } }` (FR-019/020); `supports({ type:'ycforge:function' }) === false`, `ycforge:queue` → true (FR-018); инвалидный URL (`https://message-queue.api.cloud.yandex.net/path-without-queues` — нет `/queues/`) → fail-fast `MaterializerError` c кодом `YMT_INVALID_QUEUE_URL` (FR-020/026, сравнение через константу T011); `queueUrl` не парсящийся в `new URL()` → `YMT_INVALID_QUEUE_URL`; отсутствие `queueUrl` → `YMT_INVALID_ARTIFACT_VALUE`; `context.output` содержит `declare('<name>_queue_id', { value:'yandex_message_queue.<name>.id' })`; repeat-call → байт-идентичен (SC-006). RED: 'not implemented'.
- [ ] T081 [P] [US3] RED unit-test `packages/materializers-core/test/unit/yandex-api-gateway.spec.ts` (US3-AC1/AC2, FR-014..017, Sc4, SC-004/006, DQ-1/7): fixture spec-файл с `${resources.functions.user_service.id}` (T007); artifact `{ type:'ycforge:api-gateway', value:{ specPath:<tmp spec>, resourceReferences:[{ logical:'functions.user_service', terraformType:'yandex_function' }] } }` → (AC1) `materialize()` пишет companion `<cwd>/generated/<app_id>-openapi.yaml` (cwd → mkdtemp через fixture-chdir, DQ-7) c содержимым `${yandex_function.user_service.id}` и БЕЗ `${resources.functions.user_service.id}` (FR-015, D-RE-4); `TerraformResource { kind:'resource', type:'yandex_api_gateway', name:'<app_id>', configuration:{ spec:'file("${path.module}/generated/<app_id>-openapi.yaml")' } }` (FR-016, string-equality verbatim, DQ-1); (AC2) пустой `resourceReferences` → companion скопирован as-is (byte-for-byte, FR-017); (SC-006) repeat-call → companion-содержимое + конфигурация идентичны (path исключение DQ-7); `supports({ type:'ycforge:queue' }) === false`, `ycforge:api-gateway` → true (FR-014); отсутствие `specPath`/`resourceReferences` → `YMT_INVALID_ARTIFACT_VALUE`; `context.output` содержит `declare('<name>_gateway_id', { value:'yandex_api_gateway.<name>.id' })`. Весь файл — последовательный (chdir), cwd восстановлен в `afterEach`. RED: 'not implemented'.

### Implementation (GREEN)

- [ ] T090 [P] [US3] Implement `packages/materializers-core/src/yandex-message-queue/index.ts` — default-export `Materializer`: `supports === 'ycforge:queue'` (FR-018); `materialize` = validate `queueUrl` (→ `YMT_INVALID_ARTIFACT_VALUE`) → `new URL(value.queueUrl)` (`node:url`); parse-fail ИЛИ отсутствие `/queues/`-сегмента → `throw materializerError(YMT_INVALID_QUEUE_URL, ...)` (FR-020/026, константа); `queue_name` = последний path segment после `/queues/`, `region` = `'ru-central1'` default (DQ-9) → `{ kind:'resource', type:'yandex_message_queue', name:<app_id>, configuration:{ queue_name, region } }` (FR-019) → `context.output.declare('<name>_queue_id', { value:'yandex_message_queue.<name>.id' })`. **Depends**: T080, T032. — green T080.
- [ ] T091 [US3] Implement `packages/materializers-core/src/yandex-api-gateway/ref-resolver.ts` — `replaceResourceRefs(spec: string, references: readonly ResourceReference[]): string` — прямая замена (D-RE-4, НЕ `templatefile()`): для каждого ref `logical` (`functions.user_service` → type-segment/name-segment) заменить подстроку `${resources.<logical>.id}` → `${<ref.terraformType>.<name-segment>.id}` (`${resources.functions.user_service.id}` → `${yandex_function.user_service.id}`); пустой `references` → spec as-is (FR-017); явный mapping строка-в-строку, никакого magic (Constitution V); ref без совпадения в spec — не ошибка (trust B-output, spec Edge Cases). **Depends**: T081, T030.
- [ ] T092 [US3] Implement `packages/materializers-core/src/yandex-api-gateway/index.ts` — default-export `Materializer`: `supports === 'ycforge:api-gateway'` (FR-014); `materialize` = validate value (`specPath`/`resourceReferences` → иначе `YMT_INVALID_ARTIFACT_VALUE`) с default `resourceReferences` = `[]` (contract default, FR-017) → read spec-файл → `replaceResourceRefs` (T091) → write companion `resolve(process.cwd(), 'generated', '<app_id>-openapi.yaml')` (mkdir recursive; DQ-7) → `{ kind:'resource', type:'yandex_api_gateway', name:<app_id>, configuration:{ spec:'file("${path.module}/generated/<app_id>-openapi.yaml")' } }` (FR-016, DQ-1) → `context.output.declare('<name>_gateway_id', { value:'yandex_api_gateway.<name>.id' })`. **Depends**: T081, T091, T032, T033. — green T081 (US3).

---

## Phase 6: Polish — pilot conformance, quickstart Sc1–Sc6 validation

**Purpose**: Cross-package conformance (structural — pilot contracts ⇄ standalone replicas; behavior — SC-002 dispatch-loading/selection), формальная валидация сценариев quickstart Sc1–Sc6 на зелёном коде, полный green-прогон обоих пакетов, exports-санити, consistency-аудит, SC-007 traceability, закрытие checklist.

- [ ] T100 Write pilot conformance type-test `packages/pilot/test/types/materializers-core-contract.test-d.ts` — структурная conformance spec-002 (research D-RE-2, DQ-6, FR-002): биекция assignability `PilotMaterializer ⇄ Materializer`, `PilotMaterializationContext ⇄ MaterializationContext`, `PilotOutputBuilder ⇄ OutputBuilder`, `PilotTerraformResource ⇄ TerraformResource`, `PilotArtifact ⇄ Artifact` (`expectTypeOf(...).toEqualTypeOf(...)` по shape в обе стороны); additive-проверка D-RE-5: `Materializer` с `materialize(): Promise<TerraformResource | readonly TerraformResource[]>` assignable туда, где ожидается single-resource spec-002 `Materializer` (не-breaking); pilot `isArtifactType` принимает `ycforge:api-gateway` и `ycforge:queue` (string-level). Прогнать → GREEN (типы существуют после фаз 2–5). **Depends**: T035, T008. — SC-003.
- [ ] T101 Write pilot dispatch-loading/selection integration-test `packages/pilot/test/materializers-core/dispatch-loading.spec.ts` (SC-002, Sc6, mirror of `packages/pilot/test/builders-core/registry-loading.spec.ts`, DQ-3): fixture `.ycsf/materializers.yaml` (version: 1) с 5 subpath-спецификаторами `yandex-function: "@ycforge/materializers-core/yandex-function"` ... `yandex-storage-bucket: "@ycforge/materializers-core/yandex-storage-bucket"` + `.ycsf/apps.yaml` (version: 1) с каноническими apps `user_service`/`analytics`/`frontend`/`openapi` (+ `notifications` для queue), у которых `builder` = соответствующий Artifact.type (`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`, `ycforge:api-gateway`, `ycforge:queue` — fixture-конвенция 014-selection) → (a) `loadRegistry(root)` → `kind:'ok'`, `registry.records` содержит 5 id c `kind === 'materializer'`, НОЛЬ `BRG_*` (FR-001, Sc6); (b) `selectArtifacts(model, registry)` → `kind:'ok'`, каждый app сматчен 1:1, `MTL_COLLISION` = 0, `MTL_UNHANDLED_ARTIFACT` = 0 (SC-002); (c) прямой `import('@ycforge/materializers-core/<subpath>')` для каждого → `ns.default.supports` — `Function` + `ns.default.materialize` — `Function`; (d) root-import `@ycforge/materializers-core` → `ARTIFACT_TYPES` содержит 5 типов (FR-003). HЕ вызывать полный `dispatch()` (материализация требует artifact values, которых нет на 014-уровне — DQ-3, DQ-5: flattening в 021). Прогнать → GREEN. **Depends**: T008, все materializers построены. — SC-002.
- [ ] T102 Verify quickstart Sc1 green: `pnpm --filter @ycforge/materializers-core test -- --run test/unit/yandex-function.spec.ts` — user_hash (SHA-256), entrypoint, runtime default, zip_filename infra-relative, output declare, `supports=false` для других типов; детерминизм SC-006. **Depends**: T051. — SC-001/006.
- [ ] T103 Verify quickstart Sc2+Sc3 green: `pnpm --filter @ycforge/materializers-core test -- --run test/unit/yandex-serverless-container.spec.ts test/unit/yandex-storage-bucket.spec.ts` — image as-is + name (Sc2); N файлов → N objects + bucket, sanitization, key=original, empty dir → bucket-only + `YMT_EMPTY_DIRECTORY`, sorted deterministic (Sc3). **Depends**: T070, T071. — SC-001/005/006.
- [ ] T104 Verify quickstart Sc4 green: `pnpm --filter @ycforge/materializers-core test -- --run test/unit/yandex-api-gateway.spec.ts` — companion ref replacement (`${yandex_function.user_service.id}`), `file()`-spec verbatim, empty refs → copy as-is. **Depends**: T092. — SC-004.
- [ ] T105 Verify quickstart Sc5 green: `pnpm --filter @ycforge/materializers-core test -- --run test/unit/yandex-message-queue.spec.ts` — queue_name/region parse, `YMT_INVALID_QUEUE_URL` fail-fast (константа), region default. **Depends**: T090. — SC-001.
- [ ] T106 Verify quickstart Sc6 green (cross-package): `pnpm --filter @ycforge/pilot test -- --run test/materializers-core/dispatch-loading.spec.ts` (pretest собирает materializers-core dist) + тип-тесты `-- --run test/types/materializers-core-contract.test-d.ts` — пять subpath-спецификаторов → `kind:'materializer'`, `BRG_*` = 0, `selectArtifacts` 0× `MTL_COLLISION`/0× `MTL_UNHANDLED_ARTIFACT`, conformance type-test green. **Depends**: T100, T101, T008. — SC-002/003.
- [ ] T107 Full cross-package suite + runbook: `pnpm --filter @ycforge/materializers-core test` И `pnpm --filter @ycforge/pilot test` (pretest builds materializers-core; pilot zero-regression 014 + новый cross-package-suite) — всё green. Зафиксировать порядок запуска вручную и добавить краткий **Runbook** в конец этого файла (команды установки/сборки/тестов + что доказывает каждая команда), переиспользуя преамбулу quickstart.md. **Depends**: T102–T106. — SC-007 (оркестровочно).
- [ ] T108 Exports sanity from dist: `node -e` для каждого из 6 подпутей: `import('@ycforge/materializers-core')` (root catalog + types), `.../yandex-function`, `.../yandex-serverless-container`, `.../yandex-api-gateway`, `.../yandex-message-queue`, `.../yandex-storage-bucket` (ESM) — каждый грузится, default-экспорт имеет `supports: Function` + `materialize: Function`; CJS-варианты через `require()` из `.cjs` тем же `exports`-map (консистентность `import`/`require`). **Depends**: T107.
- [ ] T109 YMT_* consistency audit: (1) grep-verify в `src/` нет string-literal сравнений YMT-кодов (только `import { YMT_* }` из diagnostics.ts; паттерн BLC_/MTL_); 3 константы byte-for-byte == keys `contracts/materializers-core.json` `#/errorCodes` == таблице DQ-в-top этого файла == data-model §6; (2) `contracts/materializers-core.json` пропускается через JSON-schema-валидатор (self-consistent: `errorCodes.required` == 3). **Depends**: T107.
- [ ] T110 Typecheck + build clean: `pnpm --filter @ycforge/materializers-core typecheck` → ноль ошибок (внимание `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` на value-shapes и `MaterializationContext`); `pnpm --filter @ycforge/materializers-core build` → dist содержит 6 entries × {esm, cjs, dts}; `pnpm --filter @ycforge/pilot typecheck` по-прежнему green (conformance type-test T100 пиннит типы). **Depends**: T107.
- [ ] T111 Determinism guard scan: grep-verify в `src/` нет `Date.now()`, `new Date()`, `Math.random()`, `randomUUID`, `process.uptime` и т.п. (SC-006: детерминизм — контракт; единственное path-исключение — companion file path DQ-7); bucket-listing отсортирован (T071); SHA-256 не зависит от времени (T050). **Depends**: T107.
- [ ] T112 SC-007 traceability report: заполнить раздел «Traceability» в конце этого файла: каждый AC (US1-AC1..3, US2-AC1..3, US3-AC1..2 = 8 + edge-case-инварианты) → тест-файл + задачи; каждый FR-001..FR-027 → тест (FR-001 — T014+T101; FR-002 — T012+T100; FR-003 — T010/T035; FR-004/005 — все unit-spec; FR-006..010 — T040/T051; FR-011..013 — T060/T070; FR-014..017 — T081/T092; FR-018..020 — T080/T090; FR-021..025 — T061/T071; FR-026/027 — T011/T032+T080); каждый Sc1–Sc6 → T102–T106; каждый SC-001..007 → тест-задача (SC-003 — T012+T100, SC-004 — T081/T092/T104, SC-005 — T061/T103, SC-006 — T040/T050+T071+T111, SC-007 — этот report); «каждый AC → ≥1 тест (RED → GREEN)» подтверждено прогонами Phase 3–6. **Depends**: T107–T111.
- [ ] T113 Final checklist close-out: отметить все задачи `[x]` в этом файле (T001–T113), сверить «Done When» ниже, подтвердить, что plan.md Open Questions (6 шт.) разрешены в «Design decisions locked in» (DQ-1..DQ-9) этого файла; `specs/README.md` (019 🚧) и `.specify/feature.json` обновляет main agent на PR-этапе (НЕ здесь). **Depends**: T112.

---

## AC → Test Traceability (SC-007; заполняется в T112)

| AC | Тест (файл — задачи RED/GREEN) |
|----|--------------------------------|
| US1-AC1 (yandex_function config: entrypoint, zip_filename, runtime) | `test/unit/yandex-function.spec.ts` — T040/T051 |
| US1-AC2 (supports=false для других типов) | `test/unit/yandex-function.spec.ts` — T040 |
| US1-AC3 (output declare function_id) | `test/unit/yandex-function.spec.ts` — T040 |
| US2-AC1 (container config: image as-is) | `test/unit/yandex-serverless-container.spec.ts` — T060/T070 |
| US2-AC2 (bucket: N files → N objects + bucket) | `test/unit/yandex-storage-bucket.spec.ts` — T061/T071 |
| US2-AC3 (empty dir → bucket only) | `test/unit/yandex-storage-bucket.spec.ts` — T061/T071 |
| US3-AC1 (companion ref replacement + file() spec) | `test/unit/yandex-api-gateway.spec.ts` — T081/T092 |
| US3-AC2 (0 refs → companion as-is) | `test/unit/yandex-api-gateway.spec.ts` — T081/T092 |
| Edge: archivePath не существует | T051 (trust builder; ошибка не создаётся на materialize) |
| Edge: пустой directory | `test/unit/yandex-storage-bucket.spec.ts` — T061/T071 (YMT_EMPTY_DIRECTORY) |
| Edge: unsafe-символы имени файла | `test/unit/yandex-storage-bucket.spec.ts` — T061/T071 (+T013/34) |
| Edge: resource reference не найден | `test/unit/yandex-api-gateway.spec.ts` — T081/T091 (без ошибки) |
| Edge: queueUrl некорректен | `test/unit/yandex-message-queue.spec.ts` — T080/T090 (YMT_INVALID_QUEUE_URL) |
| Edge: absolute archivePath | `test/unit/yandex-function.spec.ts` — T040/T051 (YMT_INVALID_ARTIFACT_VALUE, DQ-2) |
| FR-001 | T014 + T101 (subpath importability, kind='materializer') |
| FR-002 | T012 (zero-pilot-import) + T100 (structural conformance) |
| FR-003 | T010/T035 (catalog + isArtifactType grammar) + T101 (root exports) |
| FR-004 | все unit-spec (address-грамматика) |
| FR-005 | все unit-spec (output declare) |
| FR-006..010 | T040/T051 (yandex-function) |
| FR-011..013 | T060/T070 (container) |
| FR-014..017 | T081/T092 (api-gateway) |
| FR-018..020 | T080/T090 (queue) + T011/T032 (YMT_* constants) |
| FR-021..025 | T061/T071 (bucket) + T013/T034 (sanitization) |
| FR-026 | T080/T090 (YMT_INVALID_QUEUE_URL fail-fast) |
| FR-027 | T011/T032 + T109 (constants, не literals) |
| SC-001 | T040/T060/T061/T080 + T102–T105 |
| SC-002 | T101 + T106 |
| SC-003 | T012 + T100 |
| SC-004 | T081/T092 + T104 |
| SC-005 | T061/T071 + T103 |
| SC-006 | T040/T050 + T071 + T111 |
| SC-007 | T112 (этот report) + T107/T110 |

---

## Done When

- [ ] `specs/019-materializers-yandex/tasks.md` создан: 6 фаз (Setup / Foundational / US1 / US2 / US3 / Polish), все задачи с ID, `[P]`/`[USn]` тегами, checkbox'ами и file-путями (формат-чеклист 013/015/018).
- [ ] Каждый открытый вопрос plan.md (6 шт. — spec-атрибут `file()`+`path.module`, relativePath для zip_filename, multi-resource dispatch, `YMT_EMPTY_DIRECTORY` warning-канал, type-test placement, queue region default) разрешён задокументированным решением (DQ-1..DQ-9) в этом файле.
- [ ] Каждый AC/FR/SC/edge-case из spec 019 маппится на ≥1 RED-тест (раздел Traceability); RED-причина каждой test-задачи названа (стаб `'not implemented'` / отсутствующий тип / пустой каталог).
- [ ] Внешние файлы, кроме `specs/019-materializers-yandex/` и pilot test-infra delta (`packages/pilot/package.json` devDep+pretest dev-only), НЕ тронуты; production-код pilot без изменений.
- [ ] Extension hooks: `specs/019-materializers-yandex/.specify/extensions.yml` отсутствует → pre/post hooks пропущены молча (проверено).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline) → T002 (package.json) → T003–T007 [P] (tsconfig/tsup/vitest/src-stubs/helpers) параллельно после T002 + `pnpm install`; T008 (pilot devDep+pretest) — последний, зависит от T002. Итог setup: пакет собирается, цепочка `test: tsup && vitest run` рабочий, pilot резолвит `@ycforge/materializers-core/*`.
- **Foundational (Phase 2)**: зависит от T006–T008. RED-тесты T010–T014 [P] — разные файлы; пишутся ДО имплементации. Имплементация: T030 (types — блокирует type-импорты) → T031–T034 [P] (catalog/diagnostics/output-builder/filename) → T035 (root export + full green-прогон).
- **US1 (Phase 3)**: T040 (RED) → T050 (hash) → T051 (index) — последовательно; зависит от Phase 2.
- **US2 (Phase 4)**: T060/T061 (RED) [P] → T070 (container) и T071 (bucket) — две независимые цепочки [P]; T071 зависит от T034 (sanitization), T070 — нет.
- **US3 (Phase 5)**: T080 (queue RED) и T081 (gateway RED) [P] → T090 (queue impl, [P]) + T091 (ref-resolver) → T092 (gateway index).
- **Polish (Phase 6)**: зависит от Phase 3–5 + T008. T100/T101 (conformance тесты) — могут писаться после T035; T102–T106 [P] по-сценарийные верификации параллельно; T107 (полные suite'ы + runbook) — после всех; T108–T111 [P] после T107; T112 traceability; T113 закрытие.

### Parallel Opportunities

- Setup: T003/T004/T005/T006/T007 [P] после T002; T002, T008 — последовательны (install).
- Phase 2: все RED-задачи T010–T014 [P]; имплементация T031–T034 [P] после T030.
- Phase 3–5: после Phase 2 три story-цепочки (US1: T050→T051; US2: T070 ∥ T071; US3: T090 ∥ (T091→T092)) полностью параллельны между собой.
- Phase 6: T100/T101 параллельны с T102–T105; T106 после T100/T101; T102–T106 → T107; T108–T111 [P] после T107.

### Parallel Example: Phase 3–5 materializer chains

```bash
# После Phase 2 (types/catalog/diagnostics/helpers + root export):
Task: "Implement US1 chain (hash T050 → yandex-function index T051)"
Task: "Implement US2 chains (container T070 ∥ bucket T071)"
Task: "Implement US3 chains (queue T090 ∥ api-gateway ref-resolver T091 → index T092)"
# затем Polish:
Task: "Write pilot conformance + dispatch-loading tests (T100/T101) → verify quickstart Sc1–Sc6 (T102–T106) → full suites (T107)"
```

---

## Implementation Strategy

### MVP First (US1-only core path)

1. Setup T001–T008.
2. Foundational: RED T010–T014 → GREEN T030–T035 (types/catalog/diagnostics/helpers/root).
3. US1: RED T040 → GREEN T050–T051 → **STOP and VALIDATE**: `test/unit/yandex-function.spec.ts` + `catalog.test.ts` + `diagnostics.test.ts` green.
4. **MVP reached**: `user_service` (ycforge:function) генерирует `yandex_function` через `@ycforge/materializers-core/yandex-function`; затем наслаиваются US2 (container+bucket) → US3 (api-gateway+queue) → Polish (conformance).

### Incremental Delivery

1. Setup → Foundational (buildable package + types/catalog/diagnostics).
2. US1 (T050–T051) → US2 (T070–T071) → US3 (T090–T092) — chains независимы, параллельны.
3. Polish: pilot conformance (T100/T101) → quickstart Sc1–Sc6 (T102–T106) → полные suite'ы (T107) → аудиты (T108–T111) → traceability (T112) → close-out (T113).

---

## Runbook (T107; финальные команды валидации)

```bash
# 1. Установка (workspace lockfile; без новых runtime-зависимостей — allowBuilds не меняется)
pnpm install

# 2. Сборка materializers-core (dist: 6 entries × {esm,cjs,dts})
pnpm --filter @ycforge/materializers-core build

# 3. Пакет: unit + catalog + diagnostics + zero-pilot + output-builder + type-tests (tsup && vitest run)
pnpm --filter @ycforge/materializers-core test

# 4. Typecheck пакета
pnpm --filter @ycforge/materializers-core typecheck

# 5. Pilot: zero-regression 014 + cross-package dispatch-loading + conformance type-test
#    (pretest собирает builders-core + materializers-core автоматически)
pnpm --filter @ycforge/pilot test

# 6. Точка входа cross-package (изолированно): пять subpath-спецификаторов → kind:'materializer', BRG_* = 0
pnpm --filter @ycforge/pilot test -- --run test/materializers-core/dispatch-loading.spec.ts

# 7. Каждый подпуть грузится из dist (exports sanity, T108)
node -e "import('@ycforge/materializers-core').then(m => console.log(Object.keys(m)))"
node -e "import('@ycforge/materializers-core/yandex-function').then(m => console.log(typeof m.default.supports, typeof m.default.materialize))"
node -e "import('@ycforge/materializers-core/yandex-serverless-container').then(m => console.log(typeof m.default.supports, typeof m.default.materialize))"
node -e "import('@ycforge/materializers-core/yandex-api-gateway').then(m => console.log(typeof m.default.supports, typeof m.default.materialize))"
node -e "import('@ycforge/materializers-core/yandex-message-queue').then(m => console.log(typeof m.default.supports, typeof m.default.materialize))"
node -e "import('@ycforge/materializers-core/yandex-storage-bucket').then(m => console.log(typeof m.default.supports, typeof m.default.materialize))"
```