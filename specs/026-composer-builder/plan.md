# Implementation Plan: 026 — Builder-модуль composer (`@ycforge/composer/builder`)

**Branch**: `026-composer-builder` | **Date**: 2026-09-12 | **Spec**: [feature.json](feature.json), [spec.md](spec.md)

**Input**: Feature specification `/specs/026-composer-builder/spec.md` (BIG-3/BIG-4 из roadmap Волна 5; зависимости: 025, 006, 007, 008, 009, 010).

## Summary

Spec 026 закрывает BIG-3/BIG-4: реализует **Builder-модуль проекта B (composer)** — публичный subpath export `@ycforge/composer/builder` с единственным плагином типа `ycforge:api-gateway`, который превращает приложение-шлюз (каталог исходников из `BuildContext`) в артефакт скомпилированного OpenAPI в `.ycsf/artifacts/<appId>/`.

Ключевые решения (обоснованы в Technical Context):

- **B не читает `apps.yaml`** (BIG-4, US-2 AC1 — fs-проверка): вход приходит целиком из `BuildContext` (пilot contract 002/014), а не из корневого `apps.yaml`. Возможность C задать вход через context — только через внутренний **wrapper `build_config`** (`project-model.ts`), из которого строится scoped `CompileSource`. Ключ `openapi_entry` живёт в `buildConfig.build_config.openapi_entry`, НЕ в `buildConfig.openapi_entry` (запись спеки `BuildContext.buildConfig.openapi_entry` — сокращение; реальный объект pilot-контракта — wrapper).
- **B переиспользует существующую композиционную пайплайн-логику CLI** (merge → auth → overrides → sort → resolveReferences) через новый общий модуль `src/compile-core.ts`, отрефакторенный из `src/cli/compile.ts` без изменения поведения CLI. Единственная компиляционная логика в пакете (D-3: «одна реализация»).
- **B читает `.ycsf/resources.yaml` + `.ycsf/env.yaml`** и глобальные overrides `<projectRoot>/openapi/` через существующую `buildResourceIndex(projectRoot)` / CLI-загрузчики — это сознательное чтение спеки (интерпретация в разделе Open Questions): US-3 AC3 (`RESOURCE_REF_NOT_DECLARED`) и SC-005 (bit-parity с CLI) физически требуют ресурсного индекса и overrides, тогда как §5 спеки утверждает обратное. Жёсткий запрет (apps.yaml + сборка из apps-конфигов) сохраняется и проверяется fs-пробами.
- **B ничего не пишет в окружение интеграционно**: `SERVERLESS_TOOLS_OPENAPI_BUILD=1` выставляется в `compile-core` на время вызова (не глобальный side-effect модуля при импорте из builder); spawn-runner выставляет его же в дочерний процесс. CLI сохраняет свой модульный side-effect (`compile.ts:18`) для обратной совместимости.
- **Артефакт**: `{ type: 'ycforge:api-gateway', value: { specPath: <абсолютный путь к .ycsf/artifacts/<appId>/openapi.json>, resourceReferences: [{ logical, terraformType }] } }` — дефолтный export `{ build }`, shape-соответствие `getBuilder` (registry/shape).
- **Никаких правок в pilot**: контракты `@ycforge/pilot/contracts` потребляются type-only + `parseResourceReference` (уже runtime-зависимость composer), src pilot не трогается (NG-3/C-contract frozen). materializers-core не трогается.

## Technical Context

**Language/Version**: TypeScript ^5.9 (strict), ESM, Node >= 22. Пакет composer: tsup ^8.5, vitest ^3.2.

**Primary Dependencies**: `@ycforge/pilot` (runtime: `parseResourceReference`; type-only: контракты), `yaml`, `commander` (использует CLI, не builder). devDeps новые: `@ycforge/materializers-core` (workspace:* — для conformance-типов и e2e hand-off), `typescript`, `tsup`, `vitest`.

**Storage**: файлы. Чтение: `.ycsf/resources.yaml`, `.ycsf/env.yaml`, каталог исходников шлюза (sourcePath), `<projectRoot>/openapi/overrides.yaml` + app-local `auth.yaml`/`overrides.yaml`/`openapi*.yaml`. Запись: `context.outputDir` (`${rootDir}/.ycsf/artifacts/${appId}`, `build/index.ts:271-280`), `specPath = resolve(outputDir, 'openapi.json')` (абсолютный).

**Testing**: vitest (globals:true, include `src/**/*.spec.ts` + `test/**/*.spec.ts`), `tsc --noEmit` typecheck; `.test-d.ts` типовые тесты через `expectTypeOf` (прецедент: `pilot/test/types/materializers-core-contract.test-d.ts`). RED → GREEN.

**Target Platform**: Node runtime; серверный/infra-инструмент (CI). Публикация npm; без внешних side-effects.

**Project Type**: библиотека с public subpath export; Builder-плагин по pilot contract 014/025.

**Performance Goals**: N/A (компиляция разовая, офлайн). Не менее детерминированный вывод.

**Constraints**: B = только сборка артефакта (никакой terraform/provisioning, никакого apps.yaml); fail-fast на: отсутствующий `source_path` (FR-006), непригодный `openapi_entry` (FR-005/N-3), необъявленный `resources.*` ref (FR-010), отсутствующий `openapi.yaml` (N-1/N-2). Выходной документ JSON-сериализуем (FR-015), типы артефакта JSON-совместимы. Построение происходит из context (без legacy root-формата apps.yaml).

**Scale/Scope**: один плагин типа, один пакет (composer), ~1 новый публичный subpath + 1 общий compile-core.

**Constraints (политика)**: `.ycsf/*.yaml` контракты `@ycforge/pilot/contracts` — builder является *пользователем*, не владельцем. Никаких изменений в `.ycsf/*.yaml` форматах (BIG-4).

### Grounding (факты из кода)

- **BuildContext** (`packages/pilot/src/contracts/builder.ts:20-45`): `{ projectRoot, sourcePath?, buildConfig: unknown, buildEnv, outputDir }`. B обязан быть `{ build(context): Promise<Artifact> }`-shape, `getBuilder` (`registry/shape.ts:17-25`) предпочитает `ns.default` объект.
- **buildConfig в C**: `BuildConfig = { build_config: Record<string,unknown>, build_env: Record<string,string|null> }` (`src/contracts/project-model.ts:40-43`). `build/index.ts:266-270` передаёт `projectModel.build_configs.get(appId)?.build_config ?? {}`. → **`openapi_entry` читается из `buildConfig.build_config.openapi_entry`** (вложенный wrapper). У "legacy root-form" (CLI `--app` путь, `load-openapi.ts:loadBuildConfig`) build_config пуст → builder деградирует к автодетекту 006 (fallback 006, N-2). Если же entry передан, но не является строкой — fail-fast (FR-005).
- **Формирование outputDir**: `build/index.ts` передаёт `context.outputDir = join(rootDir, '.ycsf', 'artifacts', appId)`; для B: `basename(resolve(outputDir))` === appId.
- **Registry load**: `registry/load.ts:18-27` — `await import(entry.packageName)`, резолв из модульного контекста pilot; `builderKey = build(ycsf:api-gateway)`. Прецедент-паттерн фикстур pilot registry: **абсолютные файловые пути** как packageName (`test/registry/quickstart.spec.ts:50-68`). In-workspace `@ycforge/composer` из dynamic-import pilot **не резолвится** (root `node_modules/@ycforge` отсутствует; в nm pilot нет composer) → фикстура builders.yaml мапит `ycforge:api-gateway` на **абсолютный путь `packages/composer/dist/builder/index.js`** (после билда; пре-сет-паттерн).
- **materializers-core (`yandex-api-gateway`)**: `{ type:'ycforge:api-gateway', value: { specPath, resourceReferences } }`, читает `readFileSync(specPath)` (абсолютный ОК), требует `artifact.name` (TF-address, проставляется C dispatch из appId), companion-dir `resolve(process.cwd(),'generated')` — **NG-3 (cwd-зависимость), в 026 не фиксим**; `replaceResourceRefs` превращает ``${resources.<type>.<name>.id}`` → ``${<terraformType>.<name>.id}`` (`ref-resolver.ts:3-13`); `resourceReferences: [{logical:'domain.name', terraformType}]`.
- **IDT/домены composer**: `RESOURCE_DOMAINS = functions/queues/buckets/containers/gateways` (`src/resource/types.ts:6-12`), свойства: functions{id}, queues{qurl}, buckets{name}, containers{id}, gateways{id}. `REFERENCE_BEARER_FIELDS` = `components.securitySchemes.*.x-yc-apigateway-authorizer.function_id` (`types.ts:69-75`). Шаблоны: `TEMPLATE_RE` ``^\$\{resources\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\}$`` (`refs/template.ts`).
- **CLI pipeline** (`src/cli/compile.ts:18-109`): side-effect env (`compile.ts:18`), `loadAppsYaml` (legacy array-form) → filter/select gateway app → `buildResourceIndex(projectRoot)` (`cli/resource-index.ts:6-21`) → `loadOpenApiSource(app, projectRoot, envOnly)` → `applyAuth` → `applyOverrides` → `mergeDocuments` → `resolveReferences` → `sortRecordKeys` → promptCompileOutput. Этот конвейер — то, что переиспользует общий compile-core.
- **loaders переиспользуемы**: `loadOverrides(projectRoot, appPath)` (`cli/load-overrides.ts:14-46`, глобальные overrides из `<projectRoot>/openapi` + app-local; **dedup** `sourcePath`), `loadAuthConfig`, `loadOpenApiArtifactFile` (swagger.json/openapi.json → 006 `main/dist` convention), `applyXxx`, `resolveReferencesInValue` (public API). Builder вызывает их из общего compile-core.
- **env-safe-mode**: `spawn-runner.ts:120-124` — resolver + `SERVERLESS_TOOLS_OPENAPI_BUILD=1` в env дочернего процесса; при загрузке `dist/builder/index.js` путь runner резолвится `../../runner/runner.mjs` → `packages/composer/runner/runner.mjs` (в пакете, вне dist). bin у composer остаётся CLI.

### Оркестрация frontier

```
[BuildContext] ──(compile-core)──▶ buildResourceIndex(projectRoot)
                              ├─ loadOverrides(projectRoot, appDir)
                              ├─ loadOpenApiSourceForBuild(CompileSource)
                              ├─ applyAuth → applyOverrides → mergeDocuments
                              ├─ resolveReferences (fail-fast per FR-010)
                              └─ sortRecordKeys
                                        │
      builder/index.ts                  │
      ├─ derive CompileSource           ├─ документ
      │   (appId = basename(outputDir), appDir = resolve(sourcePath), 
      │    openapi_entry из buildConfig.build_config.openapi_entry)
      ├─ collectResourceReferences(document) ── IDT-таблица
      ├─ mkdir(outputDir); write(resolve(outputDir,'openapi.json'), document)
      └─ return { type:'ycforge:api-gateway', value:{ specPath, resourceReferences } }
```

## Constitution Check

GATE пройден. Ключевые правила:

| Rule | Соответствие 026 |
|------|------------------|
| I. Separation of concerns (A/B/C/Terraform ownership) | B владеет композицией/сборкой артефакта; B ничего не делает с terraform/provisioning; C владеет orchestration; не расширяем B за пределы `build()`. |
| I. Spec-first/test-first | Приёмка (US/SC/FR) оформлена тестами до реализации; RED в фазе 1-5 до GREEN. |
| II. Contract versioning | Новый публичный контракт `@ycforge/composer/builder` — аддитивный subpath. Потребляемые `@ycforge/pilot/contracts` — только чтение (та же версия, семвер уважаем). |
| II. Fail-fast vs magic | Коллизии/отсутствия → код ошибки (CLIError-style: RESOURCE_REF_NOT_DECLARED, OPENAPI_*); никаких silent merges. |
| II. Explicit-over-magic | Вход шлюза явный из context (sourcePath + build_config.openapi_entry); fallback 006 — только при отсутствии явного входа и задокументирован. |
| B не шлёт в мир | B не пишет в ссылки terraform, не вызывает terraform CLI; лимит — артефакт JSON. |
| Спека wins | 026 = владелец `@ycforge/composer/builder`; чтение спеки §5 «не переоткрывает» — интерпретировано (см. Open Questions), жесткие запреты соблюдены. |

**Complexity Tracking**: нарушений конституции нет.

## Project Structure

### Documentation (this feature)

```text
specs/026-composer-builder/
├── feature.json            # (сущ.)
├── spec.md                 # (сущ.)
├── plan.md                 # этот файл (/speckit-plan)
├── tasks.md                # будет создан /speckit-tasks
└── checklists/
    └── requirements.md     # (сущ.)
```

### Source Code (repository root) — компоненты

```text
packages/composer/
├── package.json                # [МОДИФИКАЦИЯ] exports "./builder", tsup-запись, pretest, devDep
├── tsup.config.ts              # [МОДИФИКАЦИЯ] + entry dist/builder, clean:false
├── src/
│   ├── compile-core.ts         # [НОВЫЙ] общий конвейер составной компиляции (B и CLI)
│   ├── cli/
│   │   └── compile.ts          # [МОДИФИКАЦИЯ] тонкий glue поверх compile-core (без смены поведения)
│   ├── builder/
│   │   ├── index.ts            # [НОВЫЙ] default-export { build }; derive CompileSource; mkdir+write
│   │   ├── artifact.ts         # [НОВЫЙ] ApiGatewayArtifactValue / ResourceReferenceValue, IDT-таблица, collectResourceReferences
│   │   └── errors.ts           # [НОВЫЙ] BuilderError (обёртка входных контекстов + код)
│   └── index.ts                # (без изменений; builder не экспортируется из "." — только subpath)
├── test/
│   ├── builder/
│   │   ├── builder-api.integration.spec.ts   # артефакт, fallback, fail-fast, fs-пробы (ЧАСТЬ US1-3)
│   │   └── safe-mode.spec.ts                 # runner-изоляция (US-4)
│   ├── builder/artifact-value.test-d.ts      # conformance к materializers-core (FR-014)
│   ├── builder/cache-roundtrip.spec.ts       # FR-015 + blob-кэш C
│   └── compile-core.integration.spec.ts      # безопасность env, детерминизм, приоритет entry
└── test/fixtures/
    ├── builder-openapi/        # [НОВЫЙ] map-form C-проект: .ycsf/apps.yaml+resources.yaml+env.yaml+builders.yaml; apps/openapi/*
    └── runner-entry-*          # [НОВЫЙ] фикстуры для safe-mode/env-probe
```

Pilot / materializers-core — **без изменений**.

Интеграционные проверки запланированы в фазах 4/5: e2e-тест живёт в `packages/composer/test/builder/`, фикстуры под `packages/pilot` не нужны (используется прецедент-паттерн pilot-фикстур с абсолютными путями).

**Структурное решение**: новый публичный subpath `./builder` + shared compile-core в корне `src/` composer (переиспользуется CLI; пайплайн не дублируется). `buildResourceIndex` (cli-враппер) остаётся в CLI и вызывается из compile-core (loader'ы не двигаем — минимизируем churn и риск расхождения parity).

## Implementation Phases

Каждая фаза: deliverable → verification (приёмка проверяется красными тестами до зелёных — кроме characterization-этапа, где сначала фиксируется текущее поведение, см. P0).

### P0 — Characterization (pin поведения CLI; без новых тестов)

- **Deliverable**: аудит текущих cli-тестов + фикстур; контракт `compile.ts:18` (модульный side-effect env) сохраняется. Фикстуры `cli-pass` (array-формат apps.yaml + root build_config) остаются и служат базой CLI-parity.
- **Verification**: `pnpm --filter @ycforge/composer test` зелёные до изменений (baseline). Никаких правок существующих тестов — только рефакторинг compile glue.

### P1 — compile-core extraction (общая пайплайн-логика)

- **Deliverable**: `src/compile-core.ts` — `compileComposition(source: CompileSource, projectRoot): CompiledComposition`; CompileSource `{ appId, appName, appDir, openapiEntry?, envOnly? }`; внутренне: side-effect-сет env при вызове, `buildResourceIndex(projectRoot)`, `loadOverrides(projectRoot, appDir)`, source-load (entry ИЛИ 006 fallback), auth/overrides/merge/reference/sort.
- **Соответствие**: `src/cli/compile.ts` — тонкий glue: читает apps.yaml (legacy) + filter/select + loadBuildConfig → составляет CompileSource → вызывает compile-core → пишет stdout/--output, без изменения CLI-семантики, включая обработку ошибок (коды и обёртки `cli/errors`).
- **RED тесты**: `test/compile-core.integration.spec.ts` — детерминизм (2 вызова на одном входе → byte-equal), env-safe-mode (env выставляется на время вызова и снимается после — без глобального модульного side-effect), приоритет entry vs fallback 006, отсутствие `openapi.yaml` → код `OPENAPI_*`.
- **Verification**: существующие CLI-тесты (`src/**/*.spec.ts`, `test/check.integration.spec.ts`) зелёные без правок фикстур — доказательство неломления CLI (SC-006).

### P2 — builder module core (артефакт, resourceReferences, ошибки)

- **Deliverable**: `src/builder/artifact.ts` (types + IDT-таблица `frozen`, `collectResourceReferences`), `src/builder/errors.ts`, `src/builder/index.ts` (`default: { build }`, `deriveCompileSource`, mkdir/write).
- **RED**: `test/builder/builder-api.integration.spec.ts` (первые): 
  - US-2 AC1: fs-проба — отсутствие доступа к `apps.yaml` при build (проект *намеренно* содержит инвалидный apps.yaml, чтобы тест упал, если файл прочитан);
  - US-2 AC2: `openapi_entry` в build_config приоритетнее; AC3: отсутствие entry → 006 fallback (метод select файла main/dist);
  - FR-005/FR-006: missing `source_path`/unusable entry → fail-fast;
  - FR-015: документ сериализуем в JSON (json round-trip), сортировка ключей;
  - D-4/D-7: `collectResourceReferences` — уникализация по logical, порядок (по домену+свойству), именно один экземпляр на `${resources.*}` шаблон в bearer-полях, не трогает не-bearer строки.
- **Verification**: RED→GREEN; unit-уровень полностью в compose-пакете.

### P3 — публикация контракта `./builder`

- **Deliverable**: package.json exports `"./builder"` (types+import), tsup 3-й entry (dist/builder, ESM, external yaml/commander/@ycforge/pilot), `pretest: "pnpm build && pnpm --filter @ycforge/pilot build"`, devDep `@ycforge/materializers-core` (workspace:*).
- **RED**: `test/builder/artifact-value.test-d.ts` — `ApiGatewayArtifactValue` composer ↔ materializers-core `ApiGatewayArtifactValue` структурно совместимы (toEqualTypeOf; core value = `{ specPath, resourceReferences }` — соблюдён); `ResourceReferenceValue` ↔ core `ResourceReference`; `import type { Builder, BuildContext, Artifact } from '@ycforge/pilot/contracts'` в builder → типовой тест assignability.
- **Verification**: `tsc --noEmit`, `pnpm --filter @ycforge/composer build` (dist/builder существует), vitest зелёный; аддитивность `.` не изменён (протестировано: `"."` import остаётся как было).

### P4 — интеграция через pilot (registry + materializer hand-off)

- **Deliverable**: `test/builder/pilot-integration.spec.ts`:
  - фикстура `builder-openapi` = map-form проект (`.ycsf/apps.yaml`, `builders.yaml` key `builders: ycforge: api-gateway: <absolute path packages/composer/dist/builder/index.js>`, resources.yaml, env.yaml, apps/openapi/*);
  - вызов через public API pilot: `loadProjectModel` → `loadRegistry` → `buildApps(projectModel, registry, {onAppProgress})`;
  - сбор артефактов, assert `type==='ycforge:api-gateway'`, `value.specPath` существует; 
  - hand-off: `dispatch` (или `dispatch`+`materialize`) с реальным `@ycforge/materializers-core/yandex-api-gateway` → `.tf.json` содержит `${yandex_function.<name>.id}` (replace на ``${resources.functions.<name>.id}``);
  - **spawn-probe**: во время build не порождается composer CLI-субпроцесс (лог: 0 процессов), при этом runner-spawn разрешён (Node-раннер — это и есть сборка).
- **FR-015 / blob-кэш**: `cache-roundtrip.spec.ts` — результат build() в outputDir переживает round-trip через blob-кэш pilot (buildApps-сценарий).
- **Verification**: полный RED→GREEN; убеждаемся, что e2e не требует правок pilot.

### P5 — CLI-parity + backcompat guard

- **Deliverable**: `test/builder/cli-parity.spec.ts`: один и тот же app-dir + один и тот же openapi_entry → CLI (compileCommand) и builder (build) выдают **bit-identical** документ + resolver подтверждает; determinism через 2 запуска builder.
- **Backcompat guard**: прогон ВСЕГО существующего composer CLI-набора (SC-006) — по-прежнему зелёный без правок; плюс test fixtures `cli-bad-*` как негативные прецеденты.
- **Verification**: `pnpm --filter @ycforge/composer test` и `pnpm --filter @ycforge/pilot test` зелёные; `git status` — только планируемые файлы.

### Эскалация/удаления

- **НЕ делаем**: materializers-core NG-3 (cwd companion) фиксить; composer CLI-рефакторинг за пределы compile-core glue; добавление builder в "." export; чтение apps.yaml из builder.
- **Документируем** в spec.md любые discrepancy, если parity-тест выявит boundary-поведение (напр. env-only placeholder `info.title`: CLI берёт `name` из apps.yaml, builder — appId из outputDir; документированное расхождение в placeholder для env-only-режима, реальную композицию не затрагивает).

## Risks (топ-3)

1. **Wrapper-vs-root `build_config` dialect gap** — если писать по шортхенду спеки `buildConfig.openapi_entry` — сломается C-сценарий. Mitigation: единая точка чтения `build_config.build_config.openapi_entry`, покрытая US-2 AC2; разница для legacy root-form задокументирована (CLI-only backcompat).
2. **Registry резолв subpath in-workspace** — dynamic `import('@ycforge/composer/builder')` из pilot не разрешится без линковки. Mitigation: фикстура маппит на **абсолютный dist-путь** (прецедент-паттерн pilot); публичное имя гарантируется publish-contract (dist-экспорт + типовой тест). Это структурно аналогично `e2e-real-cores.spec.ts` (025).
3. **Parity/CLI-регресс при extraction compile-core** — риск изменить CLI-поведение или коды ошибок. Mitigation: compile-core extraction в P1 первым, перед builder; существующие cli-тесты как регрессионная сеть; parity-тест P5; никаких правок фикстур и существующих тестов.

Дополнительно: определение `openapi.json` имени файла — стабильно и **детерминировано**; filename является частью значения артефакта (указано в value.specPath) — не константа из спеки, зафиксирована в artifact.ts.

## Open Questions (для /speckit-clarify, не блокирует план)

1. §5 «Builder не переоткрывает resources/env» vs SC-005/US-3-AC3 — принято решение: builder ЧИТАЕТ плоские `.ycsf/resources.yaml` + `.ycsf/env.yaml` (через buildResourceIndex) и глобальные overrides `<projectRoot>/openapi/` — это единственный способ отдать валидный artifact + bit-parity. Жёсткий запрет (apps.yaml/root build_config) соблюдается. Если владелец спеки против — parity-тест станет нежизнеспособным.
2. env-only placeholder `info.title`: CLI использует apps.yaml `name`, builder — appId (нет name в BuildContext). Варианты: (а) оставить документированным расхождением (рекомендованный, placeholder только для env-only); (б) передавать name в context через расширение контракта — не делаем в 026 (additive contract runtime).
3. Фиксация решения: builder никогда не получает `sourcePath` неопределённым — если context без sourcePath и без build_config ⇒ fail-fast FR-006, НЕ fallback к projectRoot.

## Contract surfaces touched / Additivity

| Surface | Тип изменения | Additivity proof |
|---------|--------------|------------------|
| `@ycforge/composer` `"."` | **без изменений** | `"."`-export и bin `ycsf-api` не трогаются; CLI-набор тестов зелёный без правок (SC-006). |
| `@ycforge/composer/builder` | **НОВЫЙ** subpath (default-export builder + типы value) | net-new; отсутствие ключа раньше = ничего не ломалось; semver minor. |
| `@ycforge/pilot/contracts` | потребляются type-only + `parseResourceReference` (runtime dep уже есть у composer) | класс consume-only; контракт не модифицируется; pilot src не редактируется. |
| `@ycforge/materializers-core` (yandex-api-gateway) | потребляется как потребитель (типы + материализация) | подключается devDep для тестов; публичный контракт core не меняется. |
| `.ycsf/*.yaml` форматы | без изменений | builder читает существующие ресурсы/overrides; ни один формат не расширяется 026. |
| `package.json` composer | exports+=`"./builder"`, tsup entry, pretest (само-билд), devDep | аддитивные поля; сборка CLI-артефакта нетронута. |

## Wrap-up

После зелёных фаз 1-5 задания готовы. Первый `git add packages/composer` — только новые файлы + правки по списку (compile.ts glue, package.json, tsup). Правок в pilot/materializers-core — нет. Замечание к /speckit-tasks: полные coverage-чеклисты US/SC/FR проставлены в spec checklist — считаются выполненными тестами в каждой фазе.

Итог: 026 закроет BIG-3/BIG-4 без правок в A/C и без изменения `.ycsf` форматов — чистый аддитивный контракт.