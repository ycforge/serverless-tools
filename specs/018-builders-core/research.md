# Research: builders-core — nestjs-function (bundling), docker, vite builders

**Spec**: [specs/018-builders-core/spec.md](./spec.md) | **Branch**: `018-builders-core` | **Date**: 2026-09-08

Резолюция всех unknown-вопросов плановой фазы. Каждое решение: Decision / Rationale / Alternatives considered. Факты проверены по репозиторию (package.json, pnpm-lock.yaml, node_modules/.pnpm, IDEA.md, спецификации 002/011/012/013/014).

---

## D-RE-1 — Повторная валидация D-1: единый пакет `@ycforge/builders-core` с subpath exports

**Decision**: **KEEP** — один пакет `packages/builders-core` (`@ycforge/builders-core`), три подпути `./nestjs-function`, `./docker`, `./vite`.

**Rationale**:
- Конвенция subpath exports уже принята в репозитории: `@ycforge/pilot/contracts` (spec 002) и `@ycforge/nestjs-connector/{auth,queue,context,logger}` (packages/nest-bridge/package.json, exports map с 5 записями). registry (spec 013, `registry/load.ts` → `import(entry.packageName)`) резолвит подпуть как обычный package specifier (edge case 013 «Package name содержит подпуть — допустимо»).
- Один пакет = один `package.json`, один `tsup.config.ts` (multi-entry), один `vitest.config.ts`, один набор dev-зависимостей; общие внутренние хелперы (zip-writer, диагностика `BLC_*`, env-сканер) — приватные модули пакета без лишних публичных пакетов.
- Все три builder-а версионируются и поставляются вместе (core builders, spec 018 — name совпадает с пакетом).
- Отрицательная сторона (footer): получатель только одного builder-а ставит весь пакет + esbuild (~9–11 МБ). Для core-builders это приемлемо: единая точка раздачи core-плагинов, esbuild опционально не тянется, если отсутствует nestjs-function? — нет, esbuild runtime-зависимость пакета в целом.

**Alternatives considered**:
- 3 отдельных пакета `@ycforge/builder-nestjs-function`, `@ycforge/builder-docker`, `@ycforge/builder-vite`: 3 `package.json`, 3 build config, дублирование docker-CLI-обвязки/zip/env-сканера/`BLC_*`; синхронизация версий решается отдельно. Отклонено: никаких преимуществ для core-builders; registry-контракт (строка specifier в `builders.yaml`) одинаков в обоих вариантах, разделение в будущем дешёво (вынести хелперы).
- **Триггер пересмотра** (записано в Assumptions spec 018): измеримый рост install-size сверх ~30% для единственного builder, либо независимый темп релизов не-core команды → тогда split.

## D-RE-2 — Повторная валидация D-2: артефактные типы как forward contract

**Decision**: **KEEP** — `ycforge:function`, `ycforge:docker-image`, `ycforge:frontend` фиксируются здесь; materializers — spec 019. Машиночитаемый каталог (FR-003) — часть публичного API пакета.

**Rationale**: Все три типа валидируются предикатом pilot `ARTIFACT_TYPE_PATTERN` = `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` (`packages/pilot/src/contracts/artifact-type.ts`): `ycforge:function` ✓, `ycforge:docker-image` ✓, `ycforge:frontend` ✓. Значения `Artifact.value` совпадают с IDEA §8 (Function `{archivePath, entryPoint}`, Container `{image}`, Frontend `{directory}`) — стр. 397–419. «Один type — один materializer» (Принцип V) диспатчится по `type` в 021/019.

## D-RE-3 — Повторная валидация D-3: граница интерполяции, fail-fast `BLC_ENV_NOT_RESOLVED`

**Decision**: **KEEP** — builder-ы не интерполируют; любое residual-вхождение `{{$` в `buildConfig` (строковые листья) или в значения `buildEnv` → fail-fast `BLC_ENV_NOT_RESOLVED`, сборка не выполняется.

**Rationale**: spec 012 (FR-007a/SC-004) гарантирует отсутствие остаточных `{{$` в пред-переданном builder-у состоянии; проверка на стороне builder-а — дешёвый второй контур (defensive guard, Принцип V: явное вместо магии). Детекция по подстроке `{{$` (по аналогии с 012 FR-007a), сканирование — рекурсивный обход строковых листьев `buildConfig` + все значения `buildEnv`.

**Boundary note**: `${...}` (Terraform) и `${resources...}` (B→Materializer) — чужие namespace (012 §«Interpolation namespace boundary»), builder-ы их НЕ трогают и НЕ флагуют.

## D-RE-4 — Зависимость от типов pilot: standalone structural types

**Decision**: builders-core **переобъявляет структурно совместимые типы** `Builder`/`BuildContext`/`Artifact`/value-shapes в собственном `src/types.ts` и **не импортирует pilot ни в рантайме, ни в типах** (ни runtime deps, ни devDeps на pilot). Соответствие контракту 002 фиксируется compile-time conformance-тестом (type-only, в **pilot** test dir — pilot уже имеет devDep на builders-core ради US4).

**Rationale**:
- `packages/pilot/src/contracts/builder.ts` полностью type-only (45 строк, ноль runtime-импортов) → типы структурные; интерфейсная совместимость достижима без импортов.
- Это **ломает кросс-пакетный цикл сборки**. US4 требует, чтобы голый subpath-спецификатор `@ycforge/builders-core/nestjs-function` резолвился из **pilot** (dynamic import в `registry/load.ts` якорится на модуле pilot). Значит pilot обязан иметь `@ycforge/builders-core` в devDependencies (workspace symlink в `packages/pilot/node_modules`). Если одновременно builders-core импортирует типы из `@ycforge/pilot/contracts` (devDep), получается цикл `pilot ↔ builders-core` в dev-графе, который `pnpm -r build` не тупит детерминированно на свежем клоне (builders-core не соберётся без dist pilot, pilot-тесты — без dist builders-core).
- При выбранной схеме граф однонаправленный на тест-этапе: `pilot →(test)→ builders-core`; build-этап независим (builders-core собирается без pilot вообще, esbuild — единственная runtime-зависимость). `pnpm -r build` детерминирован.
- FR-002 («без знания внутренностей pilot», «отсутствие импортов pilot-runtime»): standalone-типы усиливают это — подтверждается статическим тестом (`zero-pilot-import.test.ts`, grep value-position импортов `@ycforge/pilot` в `src/`).
- Конвенция репозитория: composer — единственный пакет с dependency на pilot (runtime API B потребляет `@ycforge/pilot`); nest-bridge не зависит от pilot вовсе. Для builder-плагина, который фабрикует команды из `BuildContext`, runtime API pilot не нужен — только формы контракта, а они структурные.

**Alternatives considered**:
- (а) devDep на pilot + `import type { Builder, BuildContext, Artifact } from '@ycforge/pilot/contracts'` (путь spec 002 US1 «сторонний builder»): канонический для сторонних плагинов, но создаёт dev-цикл с US4; типовая совместимость строится на импорте, а не на conformance-тесте.
- (b) peerDependency `@ycforge/pilot` (>=1) + devDep: для локального typecheck всё равно нужен построенный dist pilot → тот же цикл.
- Итог: (а)/(b) — для будущих сторонних плагинов (документируется в quickstart); первый-party builders-core — standalone по причинам выше.

## D-RE-5 — Тестовая инфраструктура US4 (registry loading реальных плагинов)

**Decision**: US4-тесты живут в **pilot test dir** (`packages/pilot/test/builders-core/`), а не в builders-core.

**Rationale**:
- AC1/AC2 формулируют именно поведение *registry* (013): `loadRegistry`/`loadPlugins` + `validateBuilders` против канонических apps. Условие черного ящика — «в репо установлен `@ycforge/builders-core`» и bare-спецификаторы `@ycforge/builders-core/*` резолвятся из registry-модуля.
- Node 22 resolution: `import(specifier)` в `registry/load.ts` якорится на физическом модуле pilot (`packages/pilot/dist/registry/load.js`) → bare-спецификатор обязан резолвиться из `packages/pilot/node_modules`. Это возможно только если pilot devDep-ит builders-core (workspace symlink pnpm). Тест из builders-core с bare-спецификатором не сработал бы без файловых URL (малоприятный workaround).
- Схема (см. D-RE-4): pilot `devDependencies += @ycforge/builders-core: workspace:*`; pilot `pretest: pnpm --filter @ycforge/builders-core build` (паттерн composer `pretest: pnpm --filter @ycforge/pilot build`); `test`: виттест с `loadPlugins`/`loadRegistry`/`validateBuilders` на fixture-проекте (helper `temp-project.ts` уже есть). builders-core `test`: свой unit (zip/esbuild/vite-fake/docker-fake), pilot ему не нужен.
- Conformance-тест структурной совместимости (`test/types/builders-core-contract.test-d.ts`) — тоже **в pilot**: единственное место, где чистая структурная совместимость с pilot-контрактами проверяется напрямую, без нового devDep в builders-core.

## D-RE-6 — esbuild для bundling (nestjs-function)

**Decision**: esbuild — единственный **новый runtime-зависимый** пакет: `dependencies: { "esbuild": "^0.27.7" }`.

**Rationale** (проверено):
- В монорепо esbuild как прямой runtime-dep **нет нигде**; присутствует транзитивно через tsup в `pnpm-lock.yaml` (`esbuild@0.27.7`, `esbuild@0.28.2`; `node_modules/.pnpm/esbuild@0.27.7`). `pnpm-workspace.yaml` уже содержит `allowBuilds: esbuild: true` (postinstall разрешён) — установка esbuild в builders-core не потребует изменений workspace.
- Версия привязывается к используемой tsup-линии `^0.27.7` (минимизация дублирования артефактов в lockfile).
- esbuild — единственный bundler, уже фактически присутствующий в экосистеме репозитория (tsup сам на esbuild); webpack/rollup в lockfile отсутствуют.
- Зона bundling/tree-shaking/размера бандла — ответственность builder-а (IDEA §21, §1107); энд-юзер не конфигурирует оптимизации (spec 018 FR-005).

**Alternatives considered**: webpack/rollup — новых тяжёлых dev-циклов; shell-to-`npx esbuild` — внешний инструмент, не стабильное API; отклонены.

## D-RE-7 — ZIP-упаковка: dependency-free детерминированный writer

**Decision**: собственный минимальный ZIP-writer на `node:zlib` (`deflateRaw`) + ручная сборка local file headers и central directory. **Новые зависимости не вводятся** (archiver отсутствует в lockfile — проверено grep по pnpm-lock.yaml).

**Rationale**:
- `archiver`/`yazl` в монорепе **нет**; добавление = новая зависимость, а обоснование требует пользы, которой нет: содержимое архива тривиально (один bundled-файл + опциональная `node_modules/<external>` копия), zip-STORE/deflate достаточен.
- SC-003 (детерминизм: идентичные входы → байт-идентичный артефакт): ручной writer фиксирует DOS-таймстамп (константа) и порядок записей → воспроизводимость; библиотеки по умолчанию пишут текущее время.
- Замочная механика проста: `stored` или `deflate` + CRC-32 (реализуется ~40 строками pure-кода, тестируемо).
- `.zip` формат Yandex Cloud Functions — стандартный архив с bundled-файлом и/или `node_modules` (см. D-RE-8).

**Alternatives considered**: shell `zip` — внешний executable (не детерминирован, требует установленного zip); `archiver` — новая runtime-зависимость без выигрыша. Отклонены.

## D-RE-8 — Формат пакета/entryPoint Yandex Cloud Function (nestjs-function)

**Decision**: bundle → **один CJS-файл**, платформа `node`, target из `runtime` (`nodejs20` → `node20` — default, `nodejs22` → `node22`), имя файла = basename `entry` (напр. `src/main.ts` → `main.js`). `entryPoint` = `"<basename>.handler"` (напр. `main.handler`). Если `external` непуст — в zip дополнительно кладётся копия `node_modules/<id>/` каждого external-модуля (как есть, бинарники/native addons не трогаются).

**Rationale**:
- Yandex Cloud Functions, Node.js runtime: `entryPoint` в формате `<файл>.<экспорт>`; архив — zip с кодом + `node_modules` для unbundled-зависимостей. CJS-бандл (format:'cjs') — единственный self-contained вариант без нодового `node_modules` дерева; esbuild в CJS-режиме пробрасывает `module.exports.<export>` для именованных экспортов entry (генерирует `module.exports = __toCommonJS(src_exports)`), так что `handler` доступен как `module.exports.handler`.
- Канонический экспорт nest-bridge-приложений — `handler` (адаптер отдаёт `exports.handler`), spec 018 не даёт конфигурируемого поля для имени экспорта (схема `entry?/runtime?/external?/out_filename?` закрыта) → фиксированный контракт: `handler`. Иная форма экспорта — зона будущих spec/документации (021/023), не расширение схемы 018.
- External-модули (native, напр. `sharp`) не бандлятся (FR-005) и не могут существовать в рантайме сами по себе → копируются в zip рядом с бандлом (именно так работает практика деплоя Yandex Cloud с unbundled deps). SC-006 проверяет, что бандл не ссылается на runtime-модули вне списка `external`.

## D-RE-9 — Docker CLI-обвязка (docker builder)

**Decision**: `node:child_process` `spawn` с аргументным массивом (без shell — защита от инъекций; аргументы валидируются конфигом, см. data-model), последовательность команд:

1. `docker build -f <dockerfile> -t <repository>:<tag> <sourcePath>`
2. `docker push <repository>:<tag>` → парсинг digest из вывода: regex `/(?:@sha256:|digest: )(sha256:[0-9a-f]{64})/`
3. если digest не найден → фолбэк `docker image inspect --format '{{index .RepoDigests 0}}' <repository>:<tag>` → извлечь `sha256:[0-9a-f]{64}`
4. всё ещё нет digest → fail-fast `BLC_IMAGE_DIGEST_UNAVAILABLE`; mutable-тег в `Artifact.value.image` **никогда** не попадает (FR-011, IDEA §37 immutable-reference усилено до MUST).

**Rationale**:
- Credentials — строго из Docker CLI-окружения (credential helper / `docker login` / `DOCKER_*`), builder ничего не передаёт на аутентификацию (FR-012); конфиг не содержит секретов (spec 011 §119, IDEA §1876).
- `docker build` и `docker push` — внешний executable; обвязка — тонкий оркестрационный слой (Constitution II exception: characterization-тесты постфактум, fake docker-скрипт в фикстурах определяет детерминированный вывод с digest и коды возврата).
- Парсинг stdout+stderr `docker push`: digest печатается в финальной строке вывода (`<tag>: digest: sha256:… size: …`); `--quiet`-режим в новых версиях не даёт полной гарантии → primary = парсинг, fallback = `docker image inspect RepoDigests` (после push локальный образ имеет registry-digest в `RepoDigests`).

**Alternatives considered**: `docker manifest inspect` + `--remote` — избыточно; вычисление digest локально по манифесту — сложно, хрупко.

## D-RE-10 — vite builder: shell-out к команде через `command`

**Decision**: builder **не зависит от vite** (в монорепо vite отсутствует — проверено; frontend-app владеет своим тулчейном, IDEA §36). Выполняется сконфигурированный `command` (default `"vite build"`) через `spawn(..., { shell: true })` с `cwd = viteRoot` (= `resolve(sourcePath, root)`), `env = { ...process.env, ...buildEnv }`. PATH дополняется `${sourcePath}/node_modules/.bin` (и корневыми `.bin`), чтобы `vite` резолвился из локального `node_modules` frontend-приложения, а не из registry.

**Rationale**:
- Vite JS API (импорт) = новая runtime-зависимость + жёсткая привязка версии пакета к vite; shell-out к `command` — конфигурируемо (spec 014 `command?`), default понятен, frontend-проект сам ставит vite (dev-зависимость своих `package.json`).
- `npx vite` не используется: npx может скачать из registry — неявный источник (Принцип V), и медленнее локального `.bin`.
- `env = { ...process.env, ...buildEnv }`: базовый `process.env` наследуется как механизм исполнения (node/PATH), но **все build-переменные** — строго из `buildContext.buildEnv` (FR-015); `.env`/неявные источники не подключаются (Принцип V; 012 FR-012).
- После успешной сборки содержимое `{viteRoot}/{out_dir}` (default `dist`) копируется в `outputDir`; `Artifact.value.directory = outputDir` (FR-016, IDEA §8 Frontend → `{directory}`).

**Alternatives considered**: импорт vite JS API (отклонено: зависимость и версионная связка); `npx vite build` (отклонено: скачивание из registry = неявный источник).

## D-RE-11 — Каталог артефактных типов (FR-003)

**Decision**: `src/catalog.ts`, экспортируемый из корня пакета (`"."` → `./dist/index.js`). Форма:

```ts
export const BUILDER_IDS = ['nestjs-function', 'docker', 'vite'] as const;
export type BuilderId = (typeof BUILDER_IDS)[number];
export const ARTIFACT_CATALOG = {
  'nestjs-function': { artifactType: 'ycforge:function' },
  docker: { artifactType: 'ycforge:docker-image' },
  vite: { artifactType: 'ycforge:frontend' },
} as const;
export type ArtifactType = (typeof ARTIFACT_CATALOG)[BuilderId]['artifactType'];
```

Машиночитаемость: `ARTIFACT_CATALOG` — plain data (C/021 диспатчит по `Artifact.type`, 019 — ключ `supports()`); тип `ArtifactType` охватывает ровно три значения. Каталог не требует изменения pilot-контрактов (spec Assumption).

## D-RE-12 — Конвенции пакета (build/test/typecheck)

**Decision**: (все факты из packages/*):
- `type: "module"`, `engines.node: ">=22"`, `files: ["dist"]`, `sideEffects: false` — как у pilot/composer/nest-bridge.
- `tsup.config.ts` multi-entry (4 entry: `index`, `nestjs-function/index`, `docker/index`, `vite/index`; format esm+cjs, `dts: true`, `clean: true`) — по образцу pilot, но подпути = записи entry map.
- `vitest.config.ts` с `typecheck` include → `test/types/**/*.test-d.ts` (по образцу pilot).
- `test`: `"tsup && vitest run"` — паттерн nest-bridge (строим dist перед прогоном: тесты импортируют собственные subpath-модули по self-reference через exports → нужен собранный dist).
- `package.json` builders-core не имеет `pretest` на pilot (нет зависимости); pilot имеет `pretest` на builders-core (см. D-RE-5).
- tsconfig: копия pilot tsconfig (strict, NodeNext, exactOptionalPropertyTypes, noUncheckedIndexedAccess) без devDep на pilot.

---

## Consolidated facts (проверено по репозиторию)

| Fact | Source |
|---|---|
| esbuild присутствует транзитивно (0.27.7/0.28.2), `allowBuilds: esbuild: true` | pnpm-lock.yaml, pnpm-workspace.yaml, node_modules/.pnpm |
| archiver/yazl отсутствуют | pnpm-lock.yaml (grep `archiver` → ноль) |
| `@ycforge/pilot/contracts` builder.ts — type-only | packages/pilot/src/contracts/builder.ts (45 строк, без импортов) |
| pilot root имеет runtime dep `yaml@^2.9.0` (src/model), contracts subpath — zero-dep | packages/pilot/package.json; test/unit/zero-dependency.test.ts |
| `ARTIFACT_TYPE_PATTERN` = `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` | packages/pilot/src/contracts/artifact-type.ts |
| registry: `import(entry.packageName)` + `detectPluginKind` (default-export priority, builder-priority) | packages/pilot/src/registry/load.ts, shape.ts |
| subpath в package specifier допустим (edge case 013) | specs/013 §Edge Cases |
| `<app>/build_config.yaml` — **versionless** (только `build_config:` + `build_env:`; никакого `version`) | specs/011 §«<app>/build_config.yaml» |
| composer: `pretest: pnpm --filter @ycforge/pilot build` (паттерн кросс-пакетной сборки dist) | packages/composer/package.json |
| nest-bridge: `test: tsup && vitest run` (self-reference после build) | packages/nest-bridge/package.json |
| dist/ в .gitignore (собирается локально); conformance требует построенной зависимости | .gitignore:6 |
| YC Function entryPoint = `<file>.<export>`; zip может содержать node_modules для unbundled deps | IDEA §8, практика ручного деплоя Yandex Cloud |
| vite/rollup/webpack нет ни в одном package.json монорепо | grep завимостей |