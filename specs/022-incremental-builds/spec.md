# Spec 022: incremental-builds — content-addressed кэш артефактов

## Metadata

- **Spec ID**: 022
- **Title**: incremental-builds — content-addressed кэш артефактов (skip rebuild при неизменном fingerprint)
- **Feature Branch**: `022-incremental-builds`
- **Created**: 2026-09-11
- **Status**: 🚧 Draft
- **Input**: roadmap row `022 | incremental-builds — content-addressed кэш артефактов | §39 | ⬜ | 021`; IDEA.md §39, §20, §30
- **Dependencies**: 021 (ycsf-cli ✅), 011 (project-model ✅ — `depends_on` граф), 013 (builder-registry ✅), 002 (pilot-contracts ✅ — `Builder`/`Artifact`)
- **IDEA.md sections**: §39 (Incremental builds), §20 (Project C CLI), §30 (B+C+Terraform pipeline), §5–§6 (.ycsf/apps.yaml, build_config.yaml)
- **Packages**: `packages/pilot` (`@ycforge/pilot`), contracts via `@ycforge/pilot/contracts`

---

## Problem Statement

`ycsf build` (spec 021) всегда перестраивает все apps: `buildApps` по очереди вызывает `Builder.build()` для каждого `App` из `.ycsf/apps.yaml`, даже если исходники, `build_config.yaml`, `buildEnv` и `builder`-пакет не менялись. На reference-проекте (`user_service` + `analytics` + `frontend` + `openapi`) это — секунды–минуты лишней работы на каждый `ycsf plan/apply` во время локальной разработки и CI.

IDEA §39 определяет оптимизацию: **content-addressed кэш артефактов на уровне C**:

- fingerprint source файлов app;
- skip build, если fingerprint не изменился и artifact существует;
- dependency graph через `depends_on` учитывается при инвалидации.

На сегодня этой логики нет: `packages/pilot/src/build/index.ts:buildApps` не знает fingerprint, не хранит cache index, не делает hit/miss ветвление и не учитывает `depends_on` при инвалидации. Spec 022 добавляет этот слой как **оптимизацию внутри `buildApps`/CLI**, не меняя контракты `Builder`/`Artifact` (Constitution III) и не вторгаясь в ответственность builder-ов (Constitution I: C не знает схемы NestJS/Docker/OpenAPI).

Кэш — **локальный, content-addressed, best-effort**: корректный miss всегда приводит к rebuild; hit безопасно переиспользует ранее сохранённый `Artifact` + `outputDir` snapshot. Инвалидация transitive по `depends_on`.

---

## Scope (In Scope)

### S-1 — Cache location и формат

| Аспект | Решение |
|--------|---------|
| **Root** | `<projectRoot>/.ycsf/cache/` — директория рядом с `.ycsf/artifacts/` (обе — локальные, регенерируются, gitignored). |
| **Gitignore** | `.ycsf/cache/` добавляется в корневой `.gitignore` (рядом с уже существующей записью `.ycsf/artifacts/`). `.ycsf/cache/` никогда не коммитится; Terraform state её не видит. |
| **Version** | `/.ycsf/cache/manifest.json` имеет `version: 1` (Constitution III). Несовместимая версия → cache считается пустым (auto-reset), warning в stderr. |
| **Manifest** | `/.ycsf/cache/manifest.json: { version: 1, entries: { <appId>: { fingerprint, effectiveFingerprint, artifactType, createdAt, dependsOnFingerprints } } }` — по одной актуальной записи на app (last-build-wins). История не хранится. |
| **Blob store** | `/.ycsf/cache/blobs/<effectiveFingerprint>/` — snapshot `outputDir` (файлы, которые builder записал) + `artifact.json` (`{ type, value }`). Content-addressed ключ — `effectiveFingerprint` (hex sha256). |
| **Artifacts** | Актуальные артефакты для `materialize` по-прежнему находятся в `/.ycsf/artifacts/<appId>/`. При cache hit C копирует blob → artifacts. При miss — builder пишет в artifacts, затем C копирует artifacts → blob. |
| **Purge** | `ycsf destroy --cleanup` НЕ трогает `.ycsf/cache/` (cache — не Terraform resource). Отдельная команда очистки не в scope v1; пользователь удаляет директорию вручную или `--no-cache`/`--force` игнорирует её. |

### S-2 — Fingerprint method (content-addressed)

**Собственный fingerprint `ownFingerprint(app)`** = `sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder }))` (hex, 64 символа), где:

1. **`filesHash`** — sha256 от упорядоченного списка файлов под `source_path` (рекурсивно). Для каждого файла: `relativePath + '\0' + sha256(fileContent) + '\0'`. Список сортируется лексикографически по `relativePath` (относительно `projectRoot`, POSIX). Исключения: `.git/`, `node_modules/`, `.ycsf/cache/`, `.ycsf/artifacts/`, `infra/*.ycsf.tf.json`, временные файлы (фильтр фиксирован в коде, не конфигурируется в v1). Симлинки — следуются? **Нет**: symlink → ошибка чтения = cache miss (fail-safe); в v1 симлинки не поддерживаются как source inputs (документируется). Пустой `source_path` (нет файлов) → `filesHash = sha256('')` (валидно).
2. **`buildConfig`** — канонический JSON (`JSON.stringify` с сортировкой ключей рекурсивно, без пробелов) содержимого `build_config` из `build_config.yaml` для app (opaque, но детерминированно сериализуется). Если файл отсутствует → `{}`.
3. **`buildEnv`** — **разрешённые** значения `buildEnv` (после `prepareBuildEnv`, т.е. `{{$ENV}}` уже подставлены) — объект `Record<string,string>` с сортировкой ключей. Изменение ENV без изменения файла → fingerprint меняется (требуется, иначе cache вернёт stale artifact).
4. **`builder`** — строка `{ builderId + '@' + packageVersion }`. `packageVersion` берётся из `package.json` установленного plugin-пакета (через `loadRegistry` уже загружен). Если версию определить не удалось → только `builderId` (degraded, warning не требуется). Обновление builder-пакета → fingerprint меняется.

**Эффективный fingerprint `effectiveFingerprint(app)`** =

```
effective = sha256(ownFingerprint + '|' + sortedJoin(dependsOnEffectiveFingerprints))
```

где `dependsOnEffectiveFingerprints` — `effectiveFingerprint` каждого прямого `depends_on` соседа (берётся из уже вычисленных значений в topological order; граф — DAG из spec 011, `PML_DEPENDS_CYCLE` fail-fast до fingerprint). Если `depends_on = []` → `effective = ownFingerprint`. Это обеспечивает transitive инвалидацию: изменение `user_service` инвалидирует `analytics` (depends_on user_service), даже если файлы `analytics` не менялись.

**Порядок вычисления**: `buildApps` вычисляет `effectiveFingerprint` для всех `appsToBuild` в `topologicalOrder` из `ProjectModel.depends_on_graph` (spec 011). Для `--target <app>` — зависимости вне target учитываются по последнему закэшированному `effectiveFingerprint` (если есть) или считаются изменившимися (miss).

Формат хранения: fingerprint — lower-case hex sha256 (64 chars). В логах — сокращается до 8 символов (`abc12345…`).

### S-3 — Invalidation rules и `depends_on` граф

| Условие | Результат |
|---------|-----------|
| `manifest.json` отсутствует или `version !== 1` | Cache reset: все apps — miss. |
| Запись для `appId` отсутствует в manifest | Miss для этого app. |
| `effectiveFingerprint` в manifest ≠ вычисленному сейчас | Miss (source/buildConfig/buildEnv/builder/dependency изменились). |
| Blob директория `blobs/<effectiveFingerprint>/` отсутствует или повреждена (нет `artifact.json` или файлов) | Miss + warning `CACHE_BLOB_MISSING`; запись в manifest удаляется (self-heal). |
| Любая прямая зависимость имела miss/rebuild в этом запуске | Dependent — miss (транзитивная инвалидация через effectiveFingerprint, см. S-2). |
| `source_path` не существует или нечитаем | Miss (builder будет вызван; если builder упадёт → `CLI_BUILD_FAILED` как и раньше; cache не маскирует ошибку). |
| `--no-cache` или `--force` указан | Все apps — miss; существующий manifest/blobs не читаются и не инвалидируются (перезаписываются новыми после успешного build). |
| Успешный build | Запись в manifest обновляется + blob записывается (копирование `artifacts/<appId>/` → `blobs/<effective>/`). Атомарно: write to temp + rename. |

**Что НЕ инвалидирует**: изменения в `resources.yaml`, `extensions.yaml`, `outputs.yaml`, `moved.yaml`, `infra/*.tf`, `.ycsf/builders.yaml` кроме версии builder-пакета (учитывается), и любые файлы вне `source_path`. Это осознанно: кэш — per-app source-addressed.

**Конкурентность**: параллельный `ycsf build` — out of scope v1; manifest запись — last-write-wins (атомарный rename виден следующему запуску). Блокировка файла не требуется в v1.

### S-4 — Интеграция с `ycsf` командами (§20, §30, D-18..D-25 spec 021)

```
ycsf build      : loadProjectModel → prepareBuildEnv → loadRegistry → validateBuilders → [incremental-cache check] → builders (только miss) → artifacts (hit: copy blobs → artifacts; miss: builder → blobs) → manifest update
ycsf materialize: без изменений (всегда выполняет dispatch; всегда читает .ycsf/artifacts/<appId>/ — кэш уже обеспечил их актуальность)
ycsf plan       : build (с кэшем) → materialize → terraform init → terraform plan   (fail-fast pipeline как в 021, §30)
ycsf apply      : build (с кэшем) → materialize → terraform init → terraform plan → terraform apply
ycsf destroy    : без изменений (не читает и не пишет cache)
ycsf check      : без изменений (не читает cache; check — pure validation)
```

`buildApps` остаётся единственной точкой, где кэш применяется (Constitution I: orchestration layer). Materialize/plan/apply просто вызывают `buildApps` и получают актуальные `artifacts` (hit или miss — прозрачно).

`--target <app>` с кэшем: fingerprint вычисляется только для target + его зависимость-замыкания (см. S-2). Нетаргетированные apps — не трогаются; их записи в manifest не инвалидируются.

### S-5 — CLI flags / поведение

| Флаг | Команды | Описание | Default |
|------|---------|----------|---------|
| `--no-cache` | `build`, `plan`, `apply` | Полностью игнорировать кэш (read и write). Эквивалент «чистой сборки». При успехе — перезаписывает manifest/blobs новыми fingerprint. | `false` |
| `--force` | `build`, `plan`, `apply` | Alias `--no-cache` (для совместимости с ожиданиями пользователей; оба флага делают одно и то же). Если указан любой из них — кэш bypass. | `false` |
| `--cache-dir <path>` | `build`, `plan`, `apply` | Переопределить root кэша (default `.ycsf/cache`). Для тестов/CI с эфемерным FS. | `.ycsf/cache` |

Поведение:

- Без флагов — кэш включён по умолчанию (opt-out, а не opt-in). Причина: инкрементальность — ожидаемое поведение для `ycsf build` (§39).
- Флаги — explicit (Constitution V): нет скрытого `--cache` флага, нет env-переменной `YCSF_CACHE`. Только явный CLI флаг выключает кэш.
- `--target` + `--no-cache` — rebuild only target, игнорируя кэш.
- Конфликт `--no-cache` + `--cache-dir` — допустимо; `--cache-dir` игнорируется когда `--no-cache`.

Валидация: неизвестный флаг → `CLI_UNKNOWN_COMMAND`/commander error как в 021 (exit 2).

### S-6 — Observability (cache hit/miss logging)

**Human-readable (default, stderr)** — per-app, одна строка:

- Hit: `  • cache hit  user_service  (a1b2c3d4) — skipped build`
- Miss (source changed): `  • cache miss  analytics  (e5f6g7h8) — source changed`
- Miss (dependency): `  • cache miss  frontend  (9i0j1k2l) — dependency user_service changed`
- Miss (no-cache): `  • cache miss  openapi  (3m4n5o6p) — --no-cache`
- Miss (no entry): `  • cache miss  user_service  (a1b2c3d4) — no cache entry`
- On blob missing (self-heal): `  ! cache corrupted for analytics (e5f6g7h8) — rebuilding`

Строки выводятся в том же потоке, что и `Building app …` из 021, но cache-строки предшествуют build-строкам (или заменяют их при hit). Формат стабилен для `grep`.

**Structured (`--json`)** — поле `cache` в `CLIResult.summary`:

```json
{
  "command": "build",
  "exitCode": 0,
  "diagnostics": [],
  "summary": {
    "apps": 3,
    "artifacts": 3,
    "cache": {
      "hits": 2,
      "misses": 1,
      "entries": [
        { "appId": "user_service", "hit": true, "fingerprint": "a1b2c3d4…", "reason": "hit" },
        { "appId": "analytics", "hit": false, "fingerprint": "e5f6…", "reason": "source_changed" }
      ]
    }
  }
}
```

`reason` enum: `hit | no_entry | source_changed | build_config_changed | build_env_changed | builder_changed | dependency_changed | no_cache | blob_missing | corrupted`.

`--json` не выводит cache-строки в stderr (чистый JSON на stdout, как в 021 FR-005).

### S-7 — Fail-fast vs explicit (Constitution V)

| Ситуация | Поведение |
|----------|-----------|
| Cache miss | Нормальный путь: build выполняется, результат кэшируется. Не ошибка. |
| Cache hit | Skip build, copy blob → artifacts. Не ошибка. |
| Corrupted manifest / blob (непарсится JSON, нет файла, I/O error при чтении кэша) | **Fail-safe, не fail-fast**: warning в stderr (`CACHE_CORRUPTED`), treat as miss, rebuild, self-heal (перезапись). Pipeline не прерывается. Причина: кэш — оптимизация (D-XXX), не correctness gate. |
| `manifest version !== 1` | Warning + reset (treat as miss for all). |
| I/O error при записи кэша (диск заполнен, права) | Warning (`CACHE_WRITE_FAILED`), build считается успешным (артефакты уже в `.ycsf/artifacts/`), exit code 0. Кэш не маскирует успех build. Следующий запуск — miss. |
| `source_path` не существует | Не ошибка кэша; builder вызовется и, как и раньше, может упасть с `CLI_BUILD_FAILED` (fail-fast как в 021). Кэш не скрывает ошибку исходников. |
| `depends_on` цикл / unknown app | Fail-fast на `loadProjectModel` (spec 011 `PML_DEPENDS_CYCLE`/`PML_DEPENDS_UNKNOWN`), до любого cache I/O. Кэш не оценивается. |
| `--no-cache` / `--force` | Explicit opt-out (Constitution V). Нет магии, нет env-auto-detection. |

Кэш **никогда** не превращает invalid project model в valid и никогда не скрывает `CLI_BUILD_FAILED`.

---

## Scope Boundaries (Out of Scope)

| Что | Почему не в scope | Кто/когда |
|-----|-------------------|-----------|
| Сетевой/remote cache (S3, Redis, CI cache) | §39 — локальный content-addressed кэш; remote — отдельный spec | Future spec |
| Кэширование `materialize` / `.tf.json` генерации | §39 — кэш артефактов (build), не Terraform; materialize дешёв и детерминирован от artifacts | — |
| Инвалидация по `resources.yaml`/`extensions.yaml`/`infra/*.tf` | Не source для builder; кэш per-app source-addressed | — |
| Автоочистка / LRU / TTL / max-size | v1 — last-build-wins, без eviction; ручная очистка — `rm -rf .ycsf/cache` | Future |
| Параллельный build с file locking | v1 — sequential `buildApps` loop (021); параллельность — отдельный spec | Future |
| Конфигурируемые ignore patterns для fingerprint | v1 — фиксированный exclude list; пользовательский `.ycsfignore` — future | Future |
| Хеширование с учётом `node_modules` без exclude | Намеренно исключены (volatile); если builder использует их — должен вендорить в source_path | — |
| Изменение формата `Artifact` (добавление fingerprint поля) | Artifact — контракт spec 002, версионируется отдельно; fingerprint — C-внутренний, не часть Artifact | Constitution III |
| `ycsf cache clean/prune` команда | CLI расширения — только `--no-cache`/`--force`/`--cache-dir` в v1 | Future |
| Шифрование/подпись blob-ов | Локальный кэш — доверенная FS | — |

---

## Decisions

### D-1 — Кэш принадлежит C, не builder-ам (Constitution I)

**Решение**: `effectiveFingerprint` вычисляется и проверяется в `buildApps` (C, `packages/pilot/src/build/`), а не внутри каждого `Builder`. Builder остаётся stateless: `build(BuildContext) → Artifact`, без знания о кэше.

**Рациональность**: §39: «C может реализовывать кэширование на уровне C» — уровень C, не builder. Если бы кэш жил в builder-е, каждый builder (nestjs-function, docker, vite) дублировал бы логику, а C потерял бы транзитивную инвалидацию по `depends_on` (builder не знает граф). Constitution I: C — orchestration, builder — изолированный transform. Кэш в C сохраняет separation.

### D-2 — Root `.ycsf/cache/` с `manifest.json version: 1` и `blobs/<hash>/` (Constitution III, IV)

**Решение**: cache root = `<projectRoot>/.ycsf/cache/` (рядом с `.ycsf/artifacts/`). Manifest имеет `version: 1`; несовместимая версия → reset с warning. Blob store — content-addressed по `effectiveFingerprint`.

**Рациональность**: Аналогия с `version: 1` во всех `.ycsf/*.yaml` (011, Constitution III): версионирование формата — контракт. Хранение рядом с artifacts упрощает lifecycle (оба — регенерируются, оба — gitignored, оба — локальные). `blobs/<hash>/` делает кэш content-addressed (дедупликация, детерминированный lookup). Альтернатива — `node_modules/.cache/ycsf` отклонена: C-артефакты — часть проекта, а не node_modules; разные package managers чистят `.cache` по-разному.

### D-3 — Fingerprint: filesHash + buildConfig + resolved buildEnv + builderId@version (explicit, Constitution V)

**Решение**: fingerprint включает 4 компонента (S-2). `filesHash` — sorted relativePath + sha256(content). `buildEnv` — resolved значения (уже подставленные), не сырой `{{$ENV}}`. `builder` — `id@version` из `package.json` plugin-а.

**Рациональность**: Только так достигается корректный skip: изменение любого входа (файл, build_config, ENV, обновление builder) должно инвалидировать. Если бы `buildEnv` не включался, изменение `NPM_TOKEN` не вызвало бы rebuild — stale artifact. Если бы `builder` версия не включалась, фикс bundler-а в `@ycforge/builder-nestjs-function` не инвалидировал бы кэш. `filesHash` через relativePath (не absolute) даёт стабильность между машинами/CI. Фиксированный exclude list (`.git`, `node_modules`, `.ycsf/cache`, `.ycsf/artifacts`) — explicit (Constitution V): нет магии `.gitignore` в v1.

### D-4 — `effectiveFingerprint = hash(own || dependsOn)` — transitive инвалидация по `depends_on` (011, §39)

**Решение**: эффективный fingerprint — хэш от собственного + хэшей прямых зависимостей (рекурсивно, в topological order). Изменение зависимости → dependent miss, даже если его файлы не менялись.

**Рациональность**: §39 прямо: «dependency graph через `depends_on` учитывается при инвалидации». `depends_on` — порядок сборки (011), но также семантическая зависимость: `analytics` depends_on `user_service` означает, что `analytics` может импортировать типы/контракты `user_service`; stale `user_service` artifact → stale `analytics`. Прямое включение транзитивных хэшей — минимальная корректная стратегия. Альтернатива — инвалидировать только при miss зависимости во время текущего запуска — слабее (не ловит изменения из предыдущего запуска, где зависимость пересобралась, а dependent — нет). Эффективный fingerprint ловит оба случая, т.к. берёт актуальные fingerprints зависимостей из FS + пересчёт.

### D-5 — Cache opt-out по умолчанию выключен: включён всегда, `--no-cache`/`--force` — explicit disable (Constitution V)

**Решение**: Кэш включён по умолчанию для `build`/`plan`/`apply`; только явные `--no-cache` или `--force` его отключают. Нет `--cache` флага, нет `YCSF_CACHE=0`, нет `.ycsf/cache.yaml` настройки.

**Рациональность**: §39 — «skip build, если fingerprint не изменился» — это expected optimization, а не экспериментальная опция. Opt-in требовал бы от каждого пользователя помнить флаг — магия наоборот. Explicit-over-magic (Constitution V) здесь означает: поведение по умолчанию детерминировано и документировано; отключение — явным флагом. Два alias (`--no-cache` + `--force`) — для DX: `--force` знаком пользователям `npm`/`docker`.

### D-6 — Observability: per-app hit/miss строки в stderr + `summary.cache` в `--json` (§39, 021 FR-005/FR-009)

**Решение**: Human-readable — одна строка на app с fingerprint prefix и reason; `--json` — structured `summary.cache`.

**Рациональность**: §39 не определяет observability, но 021 уже определяет progress messages (`Building app …`) и `--json` summary. Кэш должен быть observable: пользователь должен понять, почему rebuild случился/не случился (иначе debug невозможен). Per-app строка — минимальный полезный уровень; global «cache hit rate» недостаточен. `--json` интеграция — для CI: pipeline может проверять `cache.misses == 0` как assertion.

### D-7 — Fail-safe на corrupted cache, fail-fast на project model (Constitution V, II)

**Решение**: Corrupted manifest/blob → warning + treat as miss (self-heal), не error, не exit 1. Invalid project model / builder error → fail-fast exit 1/2 как в 021.

**Рациональность**: Кэш — оптимизация, не gate корректности. Fail-fast на кэше сделал бы flaky FS фатальной ошибкой сборки — нарушение Developer Experience. Constitution V (fail-fast) применяется к коллизиям контрактов (apps.yaml/resources.yaml, artifact type), не к best-effort optimization layer. Corruption — редкость; self-heal (перезапись при следующем успешном build) восстанавливает консистентность без ручного вмешательства.

### D-8 — Blob — snapshot `outputDir` + `artifact.json` (не только `Artifact.value`)

**Решение**: Cache сохраняет и `Artifact` (type+value) и файловый snapshot `outputDir` (то, что builder записал на диск). При hit оба восстанавливаются.

**Рациональность**: Некоторые builders (e.g. `nestjs-function` — zip bundle, `docker` — image tar, `vite` — dist) пишут артефакт как файлы в `outputDir`, а `Artifact.value` — лишь путь/метаданные. Кэширование только JSON без файлов дало бы broken `materialize` (materializer читает файлы). Snapshot `outputDir` гарантирует, что hit полностью эквивалентен miss+build с точки зрения последующей `materialize`.

---

## User Scenarios & Testing

### User Story 1 — Повторный `ycsf build` без изменений — cache hit, skip сборки (Priority: P1)

Разработчик (`user_service`, `analytics`, `frontend`, `openapi`) запускает `ycsf build`, затем сразу повторно `ycsf build` без изменения файлов, `build_config.yaml`, ENV и builder-версии. Второй запуск не вызывает `Builder.build()` ни для одного app, копирует blobs → artifacts, завершается на порядок быстрее.

**Why this priority**: Ядро фичи §39. Основной выигрыш для локальной разработки и CI. Без этого — нет инкрементальности.

**Independent Test**: Фикстура: проект с 1 app (`user_service`) и fake builder (счётчик вызовов `build()`). Запустить `ycsf build` (miss, build called 1 раз, blob записан, manifest создан). Запустить `ycsf build` повторно (hit, build не вызван, `artifacts/user_service/` восстановлен из blob, manifest fingerprint совпадает). Проверить `summary.cache.hits == 1`.

**Acceptance Scenarios**:

1. **Given** проект с 1 app, чистый cache, **When** `ycsf build` выполняется первый раз, **Then** exit 0, `summary.cache.misses == 1`, builder вызван 1 раз, `blobs/<fp>/` создан, `manifest.entries[user_service].effectiveFingerprint == <fp>`.
2. **Given** тот же проект, cache содержит запись, файлы не менялись, **When** `ycsf build` выполняется второй раз, **Then** exit 0, `summary.cache.hits == 1`, builder НЕ вызван, `artifacts/user_service/` восстановлен из `blobs/<fp>/`, stderr содержит `cache hit  user_service  (a1b2c3… ) — skipped build`.
3. **Given** проект с 2 apps (A, B независимы), оба закэшированы, **When** `ycsf build` повторно, **Then** оба — hit, ни один builder не вызван.

---

### User Story 2 — Изменение файла инвалидирует кэш (Priority: P1)

Разработчик меняет один файл в `source_path` (`user_service/src/main.ts` — добавлена строка). Следующий `ycsf build` пересобирает только `user_service` (miss), остальные apps — hit.

**Why this priority**: Корректность fingerprint: без этого кэш возвращал бы stale артефакт.

**Independent Test**: После US1 hit-состояния, изменить файл `user_service/src/main.ts` (append). Запустить `ycsf build`. Ожидать: `user_service` — miss (builder вызван), fingerprint изменился, новый blob создан; другие apps (если есть) — hit.

**Acceptance Scenarios**:

1. **Given** закэшированный `user_service`, **When** файл `user_service/src/app.controller.ts` изменён, **When** `ycsf build`, **Then** `user_service` — `cache miss — source changed`, builder вызван, fingerprint отличается от предыдущего.
2. **Given** проект с 2 apps (A: `user_service`, B: `frontend` без depends_on), **When** изменён только файл в `frontend`, **When** `ycsf build`, **Then** `frontend` — miss, `user_service` — hit (изолированная инвалидация).
3. **Given** файл вне `source_path` (e.g. `README.md` в корне) изменён, **When** `ycsf build`, **Then** все apps — hit (внешние файлы не входят в fingerprint).

---

### User Story 3 — Изменение `build_config.yaml` / `buildEnv` инвалидирует кэш (Priority: P1)

Разработчик меняет `user_service/build_config.yaml` (`build_config.entry` или `build_env` значение) или меняет значение ENV-переменной, на которую ссылается `{{$ENV}}`. Кэш инвалидируется.

**Why this priority**: Fingerprint должен включать builder inputs; иначе stale bundle (например, `NPM_TOKEN` изменился, но кэш вернул старый tar с прошлым token).

**Independent Test**: После hit, поменять `build_config.yaml` (literal: `build_config.minify: true → false`). Build → miss. Затем вернуть файл, но поменять ENV-переменную (`process.env.MY_ENV=old→new`), build → miss. Проверить reason `build_config_changed` / `build_env_changed`.

**Acceptance Scenarios**:

1. **Given** закэшированный `analytics`, **When** `analytics/build_config.yaml` поле `build_config.dockerfile` изменено, **When** `ycsf build`, **Then** `analytics` — miss, reason `build_config_changed`.
2. **Given** закэшированный `user_service` с `build_env: { NPM_TOKEN: "{{$NPM_TOKEN}}" }`, ENV=`token1`, **When** ENV меняется на `token2` и `ycsf build`, **Then** miss, reason `build_env_changed`, fingerprint отличается.
3. **Given** закэшированный app, **When** `build_config.yaml` не менялся и ENV не менялся, **When** `ycsf build`, **Then** hit (нет ложной инвалидации).

---

### User Story 4 — `depends_on` transitive инвалидация (Priority: P1)

Проект: `user_service` (root), `analytics` depends_on `user_service`, `frontend` depends_on `user_service`. Изменение `user_service` инвалидирует и `user_service`, и `analytics`/`frontend` (даже если их файлы не менялись). Изменение `analytics` не инвалидирует `user_service`.

**Why this priority**: §39: «dependency graph через `depends_on` учитывается». Без этого — консистентность монорепо нарушена.

**Independent Test**: Фикстура: 3 apps с цепочкой. Закэшировать все (build miss → hit). Изменить файл в `user_service`, build → `user_service` miss, `analytics` miss (dependency_changed), `frontend` miss. Проверить `effectiveFingerprint` у dependents изменился. Затем хитовый build (без изменений) → все hit.

**Acceptance Scenarios**:

1. **Given** закэшированы `user_service` (fp1) и `analytics` (depends_on [user_service], fpA включает fp1), **When** файл в `user_service` изменён, **When** `ycsf build`, **Then** `user_service` — miss `source_changed`, `analytics` — miss `dependency_changed`, builder `analytics` вызван несмотря на неизменные файлы `analytics`.
2. **Given** тот же проект, **When** изменён только файл в `analytics`, **When** `ycsf build`, **Then** `analytics` — miss, `user_service` — hit (инвалидация не идёт вверх).
3. **Given** `A → B → C` (C depends_on B depends_on A), **When** A изменён, **When** `ycsf build`, **Then** A, B, C — все miss (транзитивно).
4. **Given** `--target analytics` после изменения `user_service`, **When** `ycsf build --target analytics`, **Then** `analytics` — miss `dependency_changed` (зависимость учтена даже при таргете, по последнему кэшированному fp `user_service`).

---

### User Story 5 — `ycsf plan` / `apply` используют кэш в build-фазе (Priority: P1)

Разработчик запускает `ycsf plan` (build+materialize+terraform plan). Build-фаза кэшируется; materialize и terraform plan всегда выполняются (не кэшируются).

**Why this priority**: §30 pipeline: `plan`/`apply` включают `build`. Инкрементальность должна работать внутри pipeline, иначе `plan` всегда медленный.

**Independent Test**: Mock `terraform` binary (exit 0). Закэшированный проект → `ycsf plan` → build hits, materialize вызван, terraform plan вызван. Изменить source → `ycsf plan` → build miss, остальные шаги тоже вызваны. Проверить order: build cache check → materialize → terraform.

**Acceptance Scenarios**:

1. **Given** закэшированный проект, mock terraform, **When** `ycsf plan`, **Then** build — hits, materialize — вызван, `terraform plan` — вызван, exit 0.
2. **Given** проект с изменением в одном app, mock terraform, **When** `ycsf apply`, **Then** changed app — miss + build, unchanged — hit, затем materialize → terraform apply, exit 0.
3. **Given** `ycsf plan --no-cache`, **When** выполняется, **Then** build — все miss (кэш игнорируется), materialize/plan — как обычно.

---

### User Story 6 — `--no-cache` / `--force` / `--cache-dir` (Priority: P2)

Разработчик хочет принудительно пересобрать без кэша (`--no-cache`) или изолировать кэш для CI (`--cache-dir /tmp/ycsf-cache`).

**Why this priority**: Явный disable (Constitution V) и тестируемость (кастомный cache dir — для параллельных тестов). Часто используется реже, чем hit/miss.

**Independent Test**: После hit, `ycsf build --no-cache` → все miss, builder вызван, manifest перезаписан. С `--cache-dir /tmp/custom` → blobs создаются в custom, а не в `.ycsf/cache`. Без флага снова — hit по дефолту.

**Acceptance Scenarios**:

1. **Given** закэшированный проект, **When** `ycsf build --no-cache`, **Then** все apps — miss `no_cache`, builders вызваны, blobs перезаписаны, exit 0, stderr содержит `cache miss — --no-cache`.
2. **Given** `ycsf build --force` (alias), **When** выполняется, **Then** поведение идентично `--no-cache`.
3. **Given** `ycsf build --cache-dir /tmp/ycsf-test-cache`, **When** выполняется, **Then** cache читается/пишется в `/tmp/ycsf-test-cache`, `.ycsf/cache/` не трогается; hit/miss работает изолированно.
4. **Given** `--no-cache` + `--cache-dir` оба указаны, **When** `ycsf build --no-cache --cache-dir /tmp/x`, **Then** кэш игнорируется (custom dir не читается).
5. **Given** `--json` + `--no-cache`, **When** `ycsf build --json --no-cache`, **Then** JSON summary содержит `cache.misses == N`, `reason: "no_cache"`.

---

### User Story 7 — Observability: hit/miss логи и `--json` summary (Priority: P2)

Разработчик/CI хочет видеть, что кэш работает: human-readable логи и машиночитаемый JSON.

**Why this priority**: Без observability кэш — чёрный ящик; debug «почему rebuild?» невозможен.

**Independent Test**: Запустить `ycsf build` (miss) → проверить stderr строки `cache miss ...`. Повторно `ycsf build` (hit) → `cache hit ...`. С `--json` → проверить `summary.cache.{hits,misses,entries[].reason}`.

**Acceptance Scenarios**:

1. **Given** проект с 2 apps, оба закэшированы, **When** `ycsf build`, **Then** stderr содержит 2 строки `cache hit` с appId и 8-char fingerprint prefix.
2. **Given** 1 app изменён, **When** `ycsf build`, **Then** stderr: `cache miss  analytics ... — source changed` или `dependency changed` и т.д.; fingerprint отличается.
3. **Given** `ycsf build --json` после hit, **When** выполняется, **Then** stdout JSON `summary.cache.hits == 2`, `entries[0].reason == "hit"`, stderr чистый (нет progress строк).
4. **Given** `ycsf plan --json` с hit, **When** выполняется, **Then** JSON содержит `cache` summary (из build фазы) + terraform stdout в summary как в 021.

---

### User Story 8 — Corrupted cache self-heal (Priority: P2)

Кэш повреждён: `manifest.json` — невалидный JSON, или `blobs/<fp>/` удалён вручную, или запись без `artifact.json`.

**Why this priority**: Fail-safe (D-7). Cache corruption не должна ломать сборку.

**Independent Test**: После успешного build, повредить manifest (записать `{ broken`), запустить `ycsf build` → warning `CACHE_CORRUPTED`, miss, rebuild, manifest восстановлен. Удалить blobs dir, запустить → `CACHE_BLOB_MISSING`, miss, rebuild.

**Acceptance Scenarios**:

1. **Given** `/.ycsf/cache/manifest.json` содержит невалидный JSON, **When** `ycsf build`, **Then** stderr warning `CACHE_CORRUPTED` или `cache corrupted`, exit 0 после rebuild, manifest перезаписан валидным JSON.
2. **Given** manifest содержит запись с `effectiveFingerprint=abc`, но `blobs/abc/` отсутствует, **When** `ycsf build`, **Then** miss `blob_missing`, warning `CACHE_BLOB_MISSING`, builder вызван.
3. **Given** `manifest.json` имеет `version: 999`, **When** `ycsf build`, **Then** warning `unsupported cache version`, treat as miss all, rebuild.
4. **Given** I/O error при чтении кэша (permission), **When** `ycsf build`, **Then** warning, treat as miss, exit 0 после rebuild (fail-safe).

---

### User Story 9 — Builder обновление инвалидирует кэш (Priority: P3)

Разработчик обновил `@ycforge/builder-nestjs-function` с `1.0.0` → `1.1.0` (npm update). Следующий `ycsf build` пересобирает все apps, использующие этот builder.

**Why this priority**: Корректность fingerprint; реже встречается, чем file change.

**Independent Test**: Замокать `package.json` версию builder-пакета (или подменить packageName resolution). Закэшировать, затем изменить версию, build → miss `builder_changed`.

**Acceptance Scenarios**:

1. **Given** закэшированный проект с builder `nestjs-function@1.0.0`, **When** версия пакета меняется на `1.1.0`, **When** `ycsf build`, **Then** все apps с этим builder — miss `builder_changed`.
2. **Given** проект с 2 builders (`nestjs-function` и `docker`), **When** обновлён только `docker`, **When** `ycsf build`, **Then** только `docker`-apps — miss, `nestjs-function`-apps — hit.

---

### Edge Cases

- **Пустой проект (0 apps)**: кэш не создаётся или manifest остаётся с `entries: {}`; `ycsf build` → exit 0, `summary.cache.hits==0 misses==0`.
- **Новый app добавлен в `apps.yaml`**: отсутствует в manifest → miss `no_entry`, blob создаётся, manifest дополняется.
- **App удалён из `apps.yaml`**: запись остаётся в manifest (orphan) — не ошибка; следующий полный build не трогает её. Ручная очистка — `rm -rf .ycsf/cache`.
- **Переименован app via `.ycsf/moved.yaml`**: новый appId — miss `no_entry`; старая запись — orphan (как выше).
- **`source_path` → несуществующая директория**: fingerprint `filesHash` считается для пустой директории? Но `prepareBuildEnv` и builder могут упасть. Cache → miss, builder вызывается, ошибка `CLI_BUILD_FAILED` fail-fast как в 021. Cache не скрывает.
- **Симлинк в `source_path`**: v1 — не поддерживается; чтение → I/O error → miss (fail-safe). Документировать ограничение.
- **Очень большой файл (>100MB)**: хеширование читает потоком (stream), не целиком в память; тест — не OOM.
- **Быстрое последовательное изменение (mtime same second)**: fingerprint по content, не mtime — корректен.
- **Конкурентный `ycsf build`**: last-write-wins; не крашит сборку; второй запуск увидит manifest первого.
- **`--target` + depends_on**: dependency fingerprint берётся из manifest (последний кэш), не пересчитывается из FS не-таргет apps; если manifest отсутствует для зависимости → `dependency_changed` miss для target.
- **Cache write failure (disk full, EACCES)**: warning `CACHE_WRITE_FAILED`, build exit 0 (артефакты уже в `.ycsf/artifacts/`).
- **Empty `source_path` dir**: `filesHash = sha256('')` → hit если остаётся пустым.
- **`build_config.yaml` отсутствует → `build_config = {}`** — fingerprint стабилен.
- **Fingerprint collision (sha256)**: вероятность пренебрежима; spec не требует handling.

---

## Requirements

### Functional Requirements

**Cache location & lifecycle**

- **FR-001**: System MUST хранить кэш под `<projectRoot>/.ycsf/cache/` (default) с файлами `manifest.json` (`version: 1`) и `blobs/<effectiveFingerprint>/` (snapshot `outputDir` + `artifact.json`). `/.ycsf/cache/` MUST быть добавлен в `.gitignore`.
- **FR-002**: System MUST создавать `/.ycsf/cache/` лениво (на первом успешном build); отсутствие директории — не ошибка.
- **FR-003**: System MUST атомарно обновлять `manifest.json` (write to `manifest.json.tmp` + `rename`). Blob запись — атомарное копирование `artifacts/<appId>/` → `blobs/<fp>/` после успешного `Builder.build()`.
- **FR-004**: System MUST считать `manifest.json` с `version !== 1` как cache reset (treat all as miss, warning `CACHE_VERSION_MISMATCH`); запись нового manifest с `version: 1`.

**Fingerprint**

- **FR-005**: System MUST вычислять `ownFingerprint(app)` как `sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder }))` (hex 64). `filesHash` — sha256 от сортированного списка `relativePath + '\0' + sha256(fileContent)` всех файлов под `source_path` (recurse, fixed excludes: `.git`, `node_modules`, `.ycsf/cache`, `.ycsf/artifacts`, `infra`). Порядок сортировки — лексикографический по POSIX relativePath.
- **FR-006**: System MUST включать в fingerprint **разрешённые** `buildEnv` значения (после `prepareBuildEnv`), не сырые `{{$ENV}}` шаблоны.
- **FR-007**: System MUST включать в fingerprint каноническую сериализацию `build_config` (sorted keys) и строку `builderId@packageVersion` (packageVersion из установленного plugin-пакета; fallback — только `builderId` если версию определить невозможно).
- **FR-008**: System MUST вычислять `effectiveFingerprint(app) = sha256(ownFingerprint + '|' + sortedJoin(dependsOnEffectiveFingerprints))` в `topologicalOrder` из `ProjectModel.depends_on_graph`. Для `--target` — зависимости вне target берутся из manifest (последний кэш) или считаются изменившимися если записи нет.
- **FR-009**: System MUST считать fingerprint стабильным между машинами: только relativePath (POSIX), не absolute; content hash, не mtime; детерминированный JSON.

**Invalidation**

- **FR-010**: System MUST считать app **hit** только если: manifest содержит запись с `effectiveFingerprint == вычисленному` И blob `blobs/<effectiveFingerprint>/artifact.json` и файлы существуют.
- **FR-011**: System MUST считать любое несовпадение `effectiveFingerprint` → miss с `reason` по первопричине: `source_changed` (filesHash diff) > `build_config_changed` > `build_env_changed` > `builder_changed` > `dependency_changed` > `no_entry` (в порядке детекции; достаточно одной причины в логе).
- **FR-012**: System MUST транзитивно инвалидировать dependents: изменение `effectiveFingerprint` зависимости → dependent miss (через S-2 формулу). Прямой miss зависимости в текущем запуске также → dependent miss.
- **FR-013**: System MUST инвалидировать blob-missing / corrupted blob как `blob_missing` / `corrupted` miss с self-heal (удаление stale manifest entry).

**Build integration**

- **FR-014**: System MUST интегрировать кэш в `buildApps` (`packages/pilot/src/build/index.ts`): до вызова `Builder.build()` — проверить кэш; при hit — скопировать `blobs/<fp>/` → `artifacts/<appId>/` и восстановить `Artifact` из `artifact.json` (без вызова builder), `BuiltArtifact` всё равно возвращается; при miss — вызвать builder, затем сохранить blob.
- **FR-015**: System MUST вычислять fingerprint в `topologicalOrder`; builder вызовы также в `topologicalOrder` (зависимости строятся раньше dependents, кэш не нарушает порядок).
- **FR-016**: System MUST сохранять кэш после каждого успешного app-build (не батчем в конце) — чтобы частично закэшировать даже при падении следующего app.
- **FR-017**: System MUST оставить `materialize`/`plan`/`apply` без кэша Terraform-генерации: они вызывают `buildApps` (с кэшем) и затем всегда `dispatch`/`writeGeneratedTerraform`/`terraform`.

**CLI flags**

- **FR-018**: `ycsf build|plan|apply` MUST поддерживать `--no-cache` (bypass read и write кэша; treat all as miss, но после успешного build — перезаписать manifest/blobs). `--force` MUST быть alias того же поведения.
- **FR-019**: `ycsf build|plan|apply` MUST поддерживать `--cache-dir <path>` (override root; default `.ycsf/cache`). Относительный путь резолвится от `projectRoot`.
- **FR-020**: Флаги MUST быть explicit (Constitution V): отсутствие флагов → кэш включён; нет env-переменной и нет `.ycsf` config для включения/выключения.
- **FR-021**: `--target <app>` + кэш MUST учитывать `effectiveFingerprint` зависимостей (S-2) даже когда зависимость не входит в target set.

**Observability**

- **FR-022**: System MUST выводить per-app cache строку в stderr в human-readable mode: `cache hit|miss  <appId>  (<8-char fp>) — <reason>`. Строки выводятся до/вместо `Building app …`.
- **FR-023**: System MUST в `--json` mode НЕ выводить cache строки в stderr и MUST включать в `CLIResult.summary.cache: { hits, misses, entries: { appId, hit, fingerprint, reason } }`.
- **FR-024**: System MUST выводить warning в stderr при `CACHE_CORRUPTED` / `CACHE_BLOB_MISSING` / `CACHE_WRITE_FAILED` / `CACHE_VERSION_MISMATCH`, но НЕ менять exit code (0 при успешном build).

**Fail-safe vs fail-fast**

- **FR-025**: System MUST treat corrupted manifest / missing blob / I/O error при чтении кэша как **miss** (fail-safe, self-heal), не как `CLI_BUILD_FAILED` (exit 0 если build успешен).
- **FR-026**: System MUST treat I/O error при записи кэша как warning `CACHE_WRITE_FAILED`, не как ошибку сборки (exit 0, артефакты в `.ycsf/artifacts/` уже валидны; следующий запуск — miss).
- **FR-027**: System MUST сохранять fail-fast semantics spec 011/021: `PML_DEPENDS_CYCLE` / `PML_*` / `CLI_BUILD_FAILED` / `BRG_*` прерывают pipeline до/без кэша.

**Contract & versioning**

- **FR-028**: Cache format MUST иметь `version: 1` в `manifest.json` (Constitution III); breaking change → major + migration guide (как `@ycforge/pilot/contracts`).
- **FR-029**: `Artifact` контракт (spec 002) MUST NOT изменяться для кэша (fingerprint — C-внутренний). Cache blob хранит `Artifact` как есть.

**Diagnostics**

- **FR-030**: System MUST использовать diagnostic codes семейства `CACHE_*` для cache warnings: `CACHE_CORRUPTED`, `CACHE_BLOB_MISSING`, `CACHE_WRITE_FAILED`, `CACHE_VERSION_MISMATCH` — как warnings (не в `errors`/`diagnostics` массиве `--json`, а в stderr / `summary.cache.entries[].reason`).

### Key Entities

- **CacheManifest**: `/.ycsf/cache/manifest.json` — `{ version: 1, entries: Map<appId, { fingerprint: string (own), effectiveFingerprint: string, artifactType: string, createdAt: string (ISO), dependsOnFingerprints: string[] }> }`. Versioned (Constitution III).
- **CacheBlob**: `/.ycsf/cache/blobs/<effectiveFingerprint>/` — директория: `artifact.json` (`{ type: string, value: unknown }`) + snapshot файлов `outputDir` (рекурсивная копия). Content-addressed ключ — effectiveFingerprint.
- **OwnFingerprint**: `sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder }))` — 64-char hex. Компоненты — S-2.
- **EffectiveFingerprint**: `sha256(ownFingerprint + '|' + sortedJoin(dependsOnEffectiveFingerprints))` — транзитивный ключ для инвалидации.
- **CacheEntry**: запись в manifest для одного app + наличие blob. Hit iff `effectiveFingerprint` совпадает и blob валиден.
- **CacheReason**: `hit | no_entry | source_changed | build_config_changed | build_env_changed | builder_changed | dependency_changed | no_cache | blob_missing | corrupted` — для логов и `summary.cache.entries[].reason`.
- **BuildAppsWithCache**: расширение `buildApps` (spec 021) с фазами: `loadProjectModel → prepareBuildEnv → loadRegistry → validateBuilders → computeFingerprints(topo) → cacheLookup → builders(only misses) → manifest+blob update`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Повторный `ycsf build` без изменений на reference-проекте (3 apps) — 0 builder вызовов, `summary.cache.hits==3 misses==0`, wall time < 300ms (vs >2s при полной сборке), `artifacts/` восстановлены из blobs.
- **SC-002**: Изменение одного файла в `user_service/src/*.ts` → следующий `ycsf build`: `user_service` miss `source_changed`, dependents (`analytics`, `frontend` если depends_on user_service) miss `dependency_changed`, остальные — hit. Fingerprint `user_service` изменился; builder `analytics` вызван.
- **SC-003**: Изменение `build_config.yaml` или ENV (`{{$TOKEN}}`) → miss `build_config_changed` / `build_env_changed` для соответствующего app; без изменений — hit.
- **SC-004**: `ycsf build --no-cache` / `--force` → все apps miss `no_cache`, builders вызваны, manifest перезаписан; без флага следующий build → hit.
- **SC-005**: `ycsf build --cache-dir /tmp/custom` → blobs в `/tmp/custom`, `.ycsf/cache/` не трогается; повтор с тем же `--cache-dir` → hit.
- **SC-006**: `ycsf plan`/`apply` с mock terraform на закэшированном проекте: build hits, `materialize` и `terraform plan/apply` всегда вызваны, exit 0, порядок `build → materialize → terraform` сохранён.
- **SC-007**: Human-readable: `ycsf build` выводит per-app `cache hit|miss` строки с 8-char fingerprint; `ycsf build --json` включает `summary.cache` с `hits/misses/entries[].reason` и не выводит cache строки в stderr.
- **SC-008**: Corrupted manifest (`{broken`) или удалённый `blobs/<fp>/` → `ycsf build` выводит warning `CACHE_CORRUPTED`/`CACHE_BLOB_MISSING`, rebuild miss, exit 0, manifest восстановлен.
- **SC-009**: Обновление builder-пакета (`@ycforge/builder-nestjs-function@1.0.0→1.1.0`) → все apps с этим builder — miss `builder_changed`.
- **SC-010**: 100% FR-001..FR-030 покрыты тестами (Constitution II: каждый FR → ≥1 тест, RED → GREEN). `typecheck`/`lint` пакета — чисто. Cache I/O покрыт unit-тестами с temp FS (не требует сети/Terraform).

---

## Assumptions

- **Node 22 + ESM**: `sha256` via `node:crypto`, FS via `node:fs/promises`, `fs.copy` для blob snapshot (как в существующем `buildApps`).
- **Default cache location фиксирован**: `.ycsf/cache` (не конфигурируется через `.ycsf/*.yaml` в v1); override только через `--cache-dir`.
- **Cache включён по умолчанию**: opt-out через `--no-cache`/`--force`; нет необходимости в `ycsf config` файле.
- **Fixed exclude list для filesHash**: `.git`, `node_modules`, `.ycsf/cache`, `.ycsf/artifacts`, `infra` — достаточно для v1; пользовательский ignore — future.
- **Симлинки не поддерживаются как source inputs**: symlink → miss (fail-safe); документировать как limitation.
- **Blob snapshot — полная копия `outputDir`**: builder пишет детерминированно в `outputDir`; копия блоба — рекурсивный `cp`.
- **Атомарность через rename**: `manifest.json.tmp` + `rename` достаточно для crash-safety на POSIX (раздел fail-safe).
- **Cache не shared**: локальный FS; CI может кэшировать `.ycsf/cache/` через CI cache action, но это вне scope (эффект — hit между job-ами если ключ — restore of `.ycsf/cache/`).
- **Builder packageVersion берётся из `package.json` ближайшего установленного пакета**: если пакет не найден (edge — pnpm symlink) → degraded fingerprint без версии (не блокирует build).
- **`effectiveFingerprint` включает только прямых зависимостей**: транзитивность достигается рекурсией (т.к. зависит от effective зависимостей).
- **`ycsf destroy --cleanup` не трогает cache**: cache — не Terraform output.
- **No LRU/eviction в v1**: last-build-wins; диск не переполняется в типичном проекте (blobs — зипы по ~MB).
- **Fingerprint — hex lowercase sha256 (64 chars)**: в логах — первые 8 chars.

---

## Dependencies

| Dep | Что даёт | Статус |
|-----|----------|--------|
| 021 `ycsf-cli` | `buildApps` orchestrator (`packages/pilot/src/build/index.ts`), `ycsf build/materialize/plan/apply` pipeline, `--target`/`--project-dir`/`--json` флаги, exit codes 0/1/2 | ✅ Converged |
| 011 `project-model` | `.ycsf/apps.yaml` loading, `depends_on` граф (DAG, `topologicalOrder`, `PML_DEPENDS_*`), `build_config.yaml` model | ✅ |
| 013 `builder-registry` | `loadRegistry` + `validateBuilders`, builder packageName → module + `package.json` version | ✅ |
| 012 `build-env` | `prepareBuildEnv` (разрешение `{{$ENV}}` → `resolvedEnv`) — вход для fingerprint | ✅ (merged in 011) |
| 002 `pilot-contracts` | `Builder`, `Artifact`, `BuildContext`, `ProjectModel` (не меняются) | ✅ |
| Core: `node:crypto`, `node:fs` | sha256, file I/O | built-in |

Без 021 нет `buildApps` для оборачивания; без 011 нет `depends_on_graph` для транзитивной инвалидации. 022 — **чистый orchestrator-оптимизационный слой** поверх 021 (не меняет builder/materializer контракты).

---

## Open Questions

- **Q-1 — `.gitignore` patterns для fingerprint**: v1 использует fixed exclude list. Нужен ли в будущем `.ycsfignore` (аналог `.dockerignore`) для указания ignores per-app? → **Решение**: Out of scope v1; фиксированный список покрывает 95% кейсов (§39 не требует конфигурации). Future spec оценит.
- **Q-2 — Cache key для `openapi` app (B-as-builder)**: `openapi` app читает OpenAPI specs из других apps (B). Должен ли fingerprint `openapi` включать хэши всех `user_service`/`analytics` specs (через `depends_on`)? → **Решение**: Да, через `effectiveFingerprint` — `openapi` должен `depends_on` на все apps, чей OpenAPI он агрегирует (рекомендация в доке); иначе пользователь сам указывает. Отдельный cross-app content tracking — future.
- **Q-3 — Большие `source_path` (>1GB, e.g. `frontend` с `node_modules` рядом)**: fixed exclude `node_modules` исключает, но пользовательский `dist/` внутри source_path хешируется. Нужна ли опция exclude? → **Решение**: Out of scope; пользователь не должен класть build outputs в source_path (convention).
- **Q-4 — Нужна ли команда `ycsf cache clean`?** → **Решение**: Out of scope v1; `rm -rf .ycsf/cache` достаточно; future добавит `ycsf cache prune` если потребуется LRU.

Все вопросы — **не блокируют** реализацию v1; ответы зафиксированы как решения/assumptions.

---

## References

- IDEA.md §39: Incremental builds — content-addressed кэш, fingerprint source, skip build if fingerprint unchanged, depends_on graph invalidation
- IDEA.md §20: Project C — Build/Deployment Orchestrator, CLI commands
- IDEA.md §30: B+C+Terraform production pipeline (build → materialize → terraform)
- IDEA.md §5–§6: `.ycsf/apps.yaml`, `build_config.yaml`, `source_path`, `builder`, `build_env`
- IDEA.md §21: Builder registry (`builders.yaml` explicit mapping)
- IDEA.md §4, §17: Project layout, resources ownership
- Constitution I: A/B/C/Terraform separation (cache — C orchestration, не builder, не Terraform)
- Constitution II: Spec-first, Test-first (каждый FR → тест, RED→GREEN)
- Constitution III: Contracts versioned (`version: 1`, `@ycforge/pilot/contracts` semver, `manifest.json version: 1`)
- Constitution IV: Terraform stays real Terraform (cache не кэширует `.tf.json`, не моделирует provider schema)
- Constitution V: Explicit over magic (fixed excludes, `--no-cache`/`--force` explicit, fail-safe на corrupted cache, fail-fast на project model)
- Constitution VI: Ownership apps=managed (кэш per-app)
- Spec 011: project-model — `ProjectModel`, `DependsOnGraph.topologicalOrder`, `PML_DEPENDS_*`, `build_config.yaml` model
- Spec 013: builder-registry — `loadRegistry`, `validateBuilders`, plugin packageVersion
- Spec 021: ycsf-cli — `buildApps` (`packages/pilot/src/build/index.ts`), `ycsf build/materialize/plan/apply/destroy`, flags `--target`/`--project-dir`/`--json`, exit codes, `CLI_*`
- Spec 002: pilot-contracts — `Builder`, `Artifact`, `BuildContext`
- `packages/pilot/src/build/index.ts:1` — `buildApps` orchestrator (точка интеграции кэша)
- `packages/pilot/src/cli/build.ts:1` — `buildAction` (CLI flags → `buildApps`)
- `.gitignore:48` — существующая запись `.ycsf/artifacts/` (рядом добавится `.ycsf/cache/`)

---

## Next Steps

1. `/speckit.plan` — technical design: `src/cache/` module (`fingerprint.ts` — `filesHash` + `ownFingerprint` + `effectiveFingerprint`, `manifest.ts` — `CacheManifest` I/O с version 1, `blobs.ts` — copy snapshot, `cache.ts` — `checkCache`/`saveCache`), интеграция в `buildApps` (топо-порядок, hit/miss ветвление, `onCacheProgress` callback), CLI flags (`--no-cache`/`--force`/`--cache-dir`) в `src/cli/{build,plan,apply}.ts`, observability (stderr строки + `--json summary.cache`), `.gitignore` update, contracts (`contracts/cache.ts` — `CacheManifest`, `CacheReason`).
2. `/speckit.tasks` — разбивка на задачи с test-first (RED → GREEN) по US-1..US-9 и FR-001..FR-030.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — код, тесты, typecheck/lint.

---

## Checklist (для `/speckit.analyze`)

- [ ] Каждый FR имеет ≥1 acceptance scenario в User Stories (traceability)
- [ ] Fingerprint детерминирован (sorted, relativePath, content hash, resolved ENV)
- [ ] Transitive инвалидация по `depends_on` определена через effectiveFingerprint
- [ ] Cache location + manifest version + blob store определены
- [ ] CLI flags (`--no-cache`/`--force`/`--cache-dir`) определены, default — enabled
- [ ] Observability (hit/miss строки + `--json`) определена
- [ ] Fail-safe (corrupted cache → warning + miss) vs fail-fast (project model) разграничены
- [ ] Constitution I–VI не нарушены (C owns cache, не builder/Terraform)
- [ ] Out of scope явно отложен (remote cache, materialize cache, LRU, locking)
- [ ] `materialize`/`plan`/`apply` взаимодействие определено (build cached, остальное — всегда)
