# Quickstart: builders-core — runnable validation guide

**Spec**: [specs/018-builders-core/spec.md](./spec.md) | **Branch**: `018-builders-core` | **Date**: 2026-09-08

Валидационные сценарии Sc1..Sc7 доказывают фичу end-to-end (acceptance criteria US1–US5, SC-001..SC-007). Сценарии на каноническом проекте (`user_service`, `analytics`, `frontend`) и registry-mapping `@ycforge/builders-core/*`. Детали форм — в `data-model.md` и `contracts/builders-core.json`.

*Преамбула пакета*: `packages/builders-core` ("проверка сборки вручную"): `pnpm --filter @ycforge/builders-core build` → `dist/` с `index`, `nestjs-function/`, `docker/`, `vite/`. Все три builder-а default-экспортируют `Builder` (поле `build`), registry (013) распознаёт `kind: 'builder'`.

---

## Sc1 — DevOps собирает NestJS-функцию (US1, P1)

**Given**: fixture-проект `user_service` (`sourcePath` = каталог с `src/main.ts`, экспортом `handler`).
**When**: `build({ projectRoot, sourcePath, buildConfig: { entry: "src/main.ts", runtime: "nodejs20", external: [] }, buildEnv: {}, outputDir })` вызывается на модуле `@ycforge/builders-core/nestjs-function`.
**Then**:
- `Artifact.type === 'ycforge:function'`;
- `value.archivePath` — существующий файл `function.zip` внутри `outputDir`;
- `value.entryPoint` — непустая строка вида `main.handler` (research D-RE-8);
- распакованный бандл — CJS, не ссылается на unbundled runtime-модули вне `external` (SC-006).

**Как проверить автоматикой**: `test/unit/nestjs-function.spec.ts` — fixture-проект в `mkdtemp`, вызов, структурные проверки артефакта; второй прогон с идентичными входами → байт-идентичный `.zip` (SC-003).

## Sc2 — external + коэкзистенция B-полей (US1-AC2/AC3)

**Given**: `user_service` с `buildConfig: { entry: "src/main.ts", external: ["sharp"], openapi_entry: "..." }` (`openapi_entry` — consumed Project B).
**When**: `build(...)`.
**Then**: сборка успешна (без `BLC_*`); `sharp`-импорт не забандлен, но `node_modules/sharp/` скопирован в zip рядом с бандлом; неизвестный top-level ключ `openapi_entry` проигнорирован.

**Как проверить автоматикой**: `test/unit/nestjs-function.spec.ts` — fixture с `import sharp`, проверка содержимого zip (отсутствует sharp-код в бандле, присутствует `node_modules/sharp`); fixture с `openapi_entry` — без ошибок.

## Sc3 — fail-fast: entry не существует (US1-AC4)

**Given**: `buildConfig: { entry: "src/nonexistent.ts" }`.
**When**: `build(...)`.
**Then**: `BuilderError` с кодом `BLC_ENTRY_NOT_FOUND`; `.zip` в `outputDir` не создан; `Artifact` не возвращён.

**Как проверить автоматикой**: `test/unit/nestjs-function.spec.ts` — expect reject c `BLC_ENTRY_NOT_FOUND`, отсутствие файла.

## Sc4 — Docker-образ с иммутабельной ссылкой (US2, P1)

**Given**: fixture-проект `analytics` (`sourcePath` с `Dockerfile`), `buildConfig: { image: { repository: "test.local/app", tag: "v1" }, dockerfile: "Dockerfile" }`, тестовая среда с **fake docker CLI** (скрипт в `test/fixtures/bin/docker`: логирует args, печатает `…: digest: sha256:<64 hex> …`).
**When**: `build(...)` на `@ycforge/builders-core/docker`.
**Then**: `Artifact.type === 'ycforge:docker-image'`; `value.image` матчит `/@sha256:[a-f0-9]{64}$/`; mutable-тег `test.local/app:v1` в `value.image` отсутствует (SC-004).

**Как проверить автоматикой**: `test/unit/docker.spec.ts` (fake docker в PATH: матчинг args `build … -t test.local/app:v1 …` → `push test.local/app:v1`); characterization-обвязки (Constitution II exception). Реальный docker — ребёнок-тест, задокументированный как manual/e2e (spec Assumption: CLI available in build environment).

## Sc5 — fail-fast по digest и docker-ошибке (US2-AC2/AC4)

**Given**: (а) fake docker успешный build+push, но вывод без digest; (б) fake docker возвращает ненулевой код на `build`.
**When**: `build(...)`.
**Then**: (а) `BLC_IMAGE_DIGEST_UNAVAILABLE`, `Artifact` не возвращён; (б) `BLC_BUILD_FAILED` с кодом docker CLI; частичного артефакта нет.
- Credentials (AC3): в конфиге/env присутствуют «секрет-подобные» значения — builder их не использует для аутентификации; сам факт наличия ошибкой не является (assert: fake docker НЕ получил никаких аргументов/env, кроме build/push/image inspect).

**Как проверить автоматикой**: `test/unit/docker.spec.ts` — два фейковых скрипта; assert отстуtствия аутентификационных данных в аргументах/env.

## Sc6 — Frontend: сборка с buildEnv (US3, P1)

**Given**: fixture-проект `frontend` (package.json c `vite` devDep), `buildConfig: { out_dir: "dist" }`, `buildEnv: { YANDEX_ID_APP_ID: "abc" }`.
**When**: `build(...)` на `@ycforge/builders-core/vite` (builder вызывает `vite build` локальным бинарём из `node_modules/.bin`).
**Then**: `Artifact.type === 'ycforge:frontend'`; `value.directory` — существующий каталог внутри `outputDir`; в собранном bundle observable `YANDEX_ID_APP_ID=abc` (fixture `index.html`/`.ts` инжектит его в документ); каталог не содержит исходников/секретов (AC4).
- Пустой `buildConfig` → defaults (`out_dir: dist`, `root: .`, `command: vite build`), корректный артефакт (AC2).
- Фиктивный vite без конфигурации → `BLC_BUILD_FAILED`, артефакт не создан (AC3).

**Как проверить автоматикой**: `test/unit/vite.spec.ts` — fixture со статическими ассетами; fake `vite`-скрипт (`test/fixtures/bin/vite`: печатает принятый env, копирует фиксированный `dist`, exit 0/1); проверка env в аргументах процесса.

## Sc7 — Registry загружает core builders по subpath (US4, P2)

**Given**: `packages/pilot` devDep-ит `@ycforge/builders-core` (workspace symlink), `pretest` построил его dist. Fixture-проект с `.ycsf/builders.yaml`:

```yaml
version: 1
builders:
  nestjs-function: "@ycforge/builders-core/nestjs-function"
  docker: "@ycforge/builders-core/docker"
  vite: "@ycforge/builders-core/vite"
```

и `.ycsf/apps.yaml` с apps `user_service` (builder `nestjs-function`), `analytics` (`docker`), `frontend` (`vite`).
**When**: `loadRegistry(root)` → `loadProjectModel(root)` → `validateBuilders(projectModel, registry)` (все из pilot).
**Then**: `registry.records.get(kind)` для трёх id — `'builder'`, ошибок загрузки (`BRG_*`) нет; `validateBuilders` — `ok` (US4-AC1/AC2); прямой `import('@ycforge/builders-core/nestjs-function')` даёт `default.build` — функция (AC3).

**Как проверить автоматикой**: `packages/pilot/test/builders-core/registry-loading.spec.ts` (fixture-проект через `helpers/temp-project.ts`); conformance типов — `packages/pilot/test/types/builders-core-contract.test-d.ts`.

## Sc8 — Fail-fast на неразрешённом `{{$ENV}}` (US5, P2, D-3)

**Given**: три инвокации с остаточными ссылками:
1. nestjs-function `buildConfig: { entry: "{{$ENTRY}}" }`;
2. docker `buildConfig: { image: { repository: "r", tag: "{{$TAG}}" } }`;
3. vite `buildEnv: { GREETING: "{{$GREETING}}" }`.
**When**: каждый `build(...)`.
**Then**: во всех трёх — `BuilderError` `BLC_ENV_NOT_RESOLVED`; сборка не выполняется (docker push/image не происходят — fake docker не вызывался; `.zip`/статический вывод не созданы).

**Как проверить автоматикой**: `test/unit/env-residual.test.ts` (чистая функция-сканер) + по одному reject-тесту на builder в соответствующих `*.spec.ts`.

---

## Покрытие Success Criteria

| SC | Сценарий(и) quickstart | Место теста |
|----|------------------------|-------------|
| SC-001 | Sc1, Sc4, Sc6 | builders-core `test/unit/*.spec.ts` |
| SC-002 | Sc7 | pilot `test/builders-core/registry-loading.spec.ts` |
| SC-003 | Sc1 «байт-идентичный zip» | builders-core `test/unit/nestjs-function.spec.ts` (детерминизм) |
| SC-004 | Sc4 | builders-core `test/unit/docker.spec.ts` |
| SC-005 | Sc8 | builder-специфичные reject-тесты |
| SC-006 | Sc1, Sc2 | builders-core `test/unit/nestjs-function.spec.ts` (структурный разбор zip) |
| SC-007 | все сценарии | Red→Green по AC; `typecheck`/`lint` чистые |