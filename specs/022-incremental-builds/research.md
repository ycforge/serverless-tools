# Research: incremental-builds (spec 022)

**Spec**: [specs/022-incremental-builds/spec.md](./spec.md) | **Branch**: `022-incremental-builds` | **Date**: 2026-09-11

Решения технических неопределённостей, выявленных в Technical Context. Каждый раздел — Decision / Rationale / Alternatives.

---

## R-1 — Fingerprint: filesHash стратегия (content, not mtime)

**Decision**: `filesHash` = `sha256(sortedList(relativePath + '\0' + sha256(fileContent) + '\0'))`, где `relativePath` — POSIX путь относительно `projectRoot`, список сортируется лексикографически. Exclude: `.git/`, `node_modules/`, `.ycsf/cache/`, `.ycsf/artifacts/`, `infra/*.ycsf.tf.json` + временные файлы (fixed list, не конфигурируется v1). Симлинк — следование отключено: read error → miss (fail-safe). Пустой `source_path` → `sha256('')`. Чтение файлов — stream (`createReadStream` + `createHash`) для больших файлов (>100MB edge case, не OOM).

**Rationale**: §39 требует skip iff source не менялся. `mtime` ненадёжен (быстрые изменения same second, CI restore). Content hash детерминирован и стабилен между машинами (relativePath POSIX, не absolute). Sorted list исключает FS readdir порядок. Fixed excludes покрывают 95% volatile/voluminous dirs (Q-1). Spec S-2 прямо фиксирует этот алгоритм — alternative `.gitignore`-based ignore в v1 отклонён как магический (Constitution V).

**Alternatives**:
1. `mtime + size` — быстрее, но ложные hits при rollback содержимого.
2. `git ls-files` hash — зависимость от git, не работает вне репо.
3. Пользовательский `.ycsfignore` — future (Q-1), v1 explicit fixed list.

**Влияние**: `src/cache/fingerprint.ts:filesHash()`, `forEachFile(sourcePath, excludes)` helper.

---

## R-2 — canonicalJson для buildConfig + ownFingerprint состав

**Decision**: `ownFingerprint = sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder }))` — 64-char hex. `canonicalJson(obj)` = `JSON.stringify(obj, sortedKeysReplacer, 0)` без пробелов, ключи рекурсивно отсортированы. `buildConfig` — raw `build_config` из `build_config.yaml` (opaque, но детерминированная сериализация). `buildEnv` — resolved `Record<string,string>` после `prepareBuildEnv` (S-2 FR-006). `builder` — `${builderId}@${packageVersion}` (packageVersion из `loadRegistry` records → `package.json` lookup; fallback — только `builderId`).

**Rationale**: Любой builder input должен инвалидировать (D-3). `buildEnv` resolved (не template `{{$ENV}}`) — иначе `NPM_TOKEN=token2` не инвалидирует. `builderId@version` ловит bundler fix (US9). Canonical JSON гарантирует стабильность между Node versions / key order. Spec S-2 определяет 4 компонента exhaustively.

**Alternatives**:
1. Хэшировать только filesHash — пропустит ENV/builder изменения → stale artifact.
2. Включать `resources.yaml`/`extensions.yaml` — вне scope per-app source-addressed (spec Out of Scope).
3. `yaml.stringify` вместо JSON — менее детерминирован, требует yaml dep.

**Влияние**: `src/cache/fingerprint.ts:ownFingerprint()`, `canonicalJson()`.

---

## R-3 — effectiveFingerprint и transitive инвалидация

**Decision**: `effectiveFingerprint(app) = sha256(ownFingerprint(app) + '|' + sortedJoin(dependsOnEffectiveFingerprints))`, где `sortedJoin` — лексикографически отсортированный `effectiveFingerprint` каждого прямого `depends_on` соседа. Вычисление — в `topologicalOrder` из `ProjectModel.depends_on_graph` (spec 011). Для `--target` — зависимости вне target берутся из последнего manifest (если есть запись) иначе `dependency_changed` miss (S-2 FR-008, FR-021).

**Rationale**: §39 + D-4: изменение `user_service` должно инвалидировать `analytics depends_on user_service` даже если файлы `analytics` не менялись. Включение эффективных хэшей зависимостей делает инвалидацию транзитивной за один хэш-join (рекурсия: B зависит от A effective → C зависит от B effective → C индиректно включает A). `sortedJoin` делает порядок зависимостей неважным. Topological order гарантирует зависимости уже вычислены при обработке dependent.

**Alternatives**:
1. Инвалидировать только при miss зависимости *в текущем запуске* — не ловит изменения из предыдущего запуска (зависимость уже пересобралась, dependent остался stale).
2. Хранить timestamp вместо hash — ненадёжно (clock skew).
3. Хэшировать весь source зависимостей рекурсивно — дублирует work уже посчитанного effective.

**Влияние**: `src/cache/fingerprint.ts:effectiveFingerprint()`, `src/build/index.ts` — compute loop topo.

---

## R-4 — CacheManifest формат и версионирование (version: 1)

**Decision**: `/.ycsf/cache/manifest.json: { version: 1, entries: { <appId>: { fingerprint, effectiveFingerprint, artifactType, createdAt, dependsOnFingerprints } } }` — last-build-wins, без истории. `version !== 1` → treat all miss + warning `CACHE_VERSION_MISMATCH` + запись нового manifest `version: 1` после успешного build (FR-004). Атомарное обновление: `writeFile(manifest.json.tmp) + rename(manifest.json)` (POSIX atomic, FR-003). Чтение — `try/read/parse` с fail-safe: corrupted JSON / I/O error → warning `CACHE_CORRUPTED`, treat as miss (D-7 FR-025).

**Rationale**: Constitution III: все `.ycsf/*.yaml` имеют `version: 1` + semver contracts; cache manifest — аналогично версионируемый формат (S-1 D-2). Last-build-wins минимизирует размер/IO; истории не нужна (single current fingerprint per app). Atomic rename — crash-safety без file lock (spec Concurrency: last-write-wins v1).

**Alternatives**:
1. `package.json` version вместо manifest version — смешивает concerns.
2. SQLite/Binary — over-eng для local FS cache; JSON inspectable.
3. Per-app manifest files (`cache/<appId>.json`) — больше I/O, нет atomic all-apps update; single manifest проще.

**Влияние**: `src/cache/manifest.ts`, `contracts/cache-manifest.json`.

---

## R-5 — Blob store: snapshot outputDir + artifact.json

**Decision**: `/.ycsf/cache/blobs/<effectiveFingerprint>/` содержит `artifact.json` (`{ type, value }` как `Artifact`) + рекурсивная копия файлов из `outputDir` (то что builder записал, S-1 D-8). Hit: `blobs/<fp>/` → `artifacts/<appId>/` (copy + `Artifact` из json). Miss: `artifacts/<appId>/` → `blobs/<fp>/` после успешного `builder.build()` (FR-003). Blob missing/corrupted (нет `artifact.json` или файлов) → `CACHE_BLOB_MISSING` warning + self-heal (delete stale manifest entry, miss).

**Rationale**: D-8: некоторые builders пишут артефакт как файлы в `outputDir` (zip bundle, docker tar, vite dist), `Artifact.value` — лишь путь/мета; кэш только JSON дал бы broken materialize. Snapshot `outputDir` делает hit эквивалентным miss+build для `materialize`. Content-addressed ключ `effectiveFingerprint` даёт dedup + deterministic lookup.

**Alternatives**:
1. Только `artifact.json` — сломает file-based builders.
2. Compress blob (tar.gz) — усложняет restore, нет значимой экономии для zip уже сжатых.
3. Symlink вместо copy — fragile across FS, Windows issues.

**Влияние**: `src/cache/blobs.ts:saveBlob()`, `restoreBlob()`, `hasValidBlob()`.

---

## R-6 — Build integration: hit/miss ветвление в buildApps

**Decision**: Кэш применяется исключительно в `buildApps` (`packages/pilot/src/build/index.ts`, S-4 D-1) с фазами: `loadProjectModel → prepareBuildEnv → loadRegistry → validateBuilders → computeFingerprints(topo) → cacheLookup(hasValidBlob) → builders(only misses, topo) → saveBlob+manifest(после каждого успеха, FR-016)` → return `BuiltArtifact[]`. `onCacheProgress?: (appId, hit, fingerprint, reason)` callback для observability; `onAppProgress` (021) остаётся для builder invocations. `materialize`/`plan`/`apply` не меняются — они вызывают `buildApps` и получают актуальные artifacts прозрачно (S-4). `BuildAppsOptions` расширяется: `noCache?: boolean` (`--no-cache`/`--force`), `cacheDir?: string` (`--cache-dir`), `onCacheProgress?`.

**Rationale**: Constitution I: C owns orchestration, builder не знает о кэше (D-1). Единственная точка ветвления — `buildApps` — сохраняет `topologicalOrder` (зависимости раньше dependents, FR-015) и не дублирует логику между build/plan/apply. Сохранение после каждого app (FR-016) частично кэширует даже при падении следующего app. `--target` — fingerprint только для target+deps closure (S-4).

**Alternatives**:
1. Cache в каждом builder — дублирование + нет transitive invalidation (builder не знает граф).
2. Cache в CLI layer — `buildApps` bypassed при прямом вызове как library; теряется.
3. Batch save в конце — теряется partial cache при mid-build failure.

**Влияние**: `src/build/index.ts`, `src/contracts/build.ts:BuildAppsOptions`, `src/cli/build|plan|apply.ts`.

---

## R-7 — CLI flags: --no-cache / --force / --cache-dir

**Decision**: `ycsf build|plan|apply` добавляют `--no-cache` (bypass read+write, treat all miss, перезапись после успеха), `--force` alias того же, `--cache-dir <path>` override default `.ycsf/cache` (relative → resolve от `projectRoot` vs `process.cwd()` per spec FR-019? spec says projectRoot). Default — cache enabled (opt-out, D-5). `--no-cache` + `--cache-dir` — допустимо, `cacheDir` игнорируется при `noCache`. Неизвестный флаг → commander error exit 2 (как в 021). Нет env/config для cache toggle (Constitution V).

**Rationale**: D-5: инкрементальность — expected optimization, opt-in требовал бы помнить флаг. Explicit disable via flag — Constitution V. Два alias для DX (`--force` знаком из npm/docker). `--cache-dir` для тестов/CI с эфемерным FS (SC-005).

**Влияние**: `src/cli/build.ts`, `plan.ts`, `apply.ts`, `contracts/incremental-builds.json`.

---

## R-8 — Observability и fail-safe vs fail-fast

**Decision**: Human-readable (default, stderr): per-app `  • cache hit  user_service  (a1b2c3d4) — skipped build` / `  • cache miss  analytics  (e5f6g7h8) — source changed` / `  ! cache corrupted for analytics (e5f6g7h8) — rebuilding` (S-6). Structured (`--json`): `summary.cache: { hits, misses, entries: { appId, hit, fingerprint, reason } }`, `reason` enum `hit | no_entry | source_changed | build_config_changed | build_env_changed | builder_changed | dependency_changed | no_cache | blob_missing | corrupted` (FR-023). `--json` suppresses cache строки в stderr (чистый JSON stdout, 021 FR-005). Diagnostics codes `CACHE_CORRUPTED`, `CACHE_BLOB_MISSING`, `CACHE_WRITE_FAILED`, `CACHE_VERSION_MISMATCH` — warnings (stderr), не в `diagnostics` массиве, exit 0 если build успешен (D-7 FR-024..026). Invalid project model / `CLI_BUILD_FAILED` / `BRG_*` / `PML_DEPENDS_CYCLE` — fail-fast exit 1/2 до/без cache (FR-027).

**Rationale**: Кэш observervable: пользователь должен понять почему rebuild случилось (D-6). Human-readable — grep-stable; JSON — для CI assertions (`cache.misses == 0`). Fail-safe: cache — optimization, не correctness gate; flaky FS не должна ломать сборку (Constitution V limited).

**Alternatives**:
1. Только global hit rate — недостаточно для debug per-app reason.
2. Fail-fast на corrupted manifest — сделал бы I/O glitch фатальным (плохой DX).
3. CACHE_* в diagnostics массив — смешает warnings с errors; spec FR-030 — в stderr/reason.

---

## R-9 — Builder packageVersion resolution

**Decision**: `builder` строка для fingerprint — `${builderId}@${packageVersion}`, где `packageVersion` берётся из `package.json` установленного plugin-пакета (через `loadRegistry` records → `createRequire`/`readFileSync` ближайшего `package.json` рядом с resolved module). Если версию определить не удалось (pnpm symlink edge, missing file) → fallback только `builderId` (degraded, no warning per spec S-2), fingerprint всё равно валиден но не ловит builder update до следующей успешной resolution.

**Rationale**: Обновление builder-пакета должно инвалидировать (US9 S-2). Registry уже знает `packageName` каждого builder (`.ycsf/builders.yaml`), но не version; lookup `package.json` — единственный source. Degraded fallback сохраняет build работоспособность.

**Alternatives**:
1. Хранить version в `.ycsf/builders.yaml` — требует ручного обновления, stale.
2. Hash builder module content — heavy, включает недетерминированный bundler output path.

---

## R-10 — .gitignore и atomic I/O детали

**Decision**: Добавить `.ycsf/cache/` в корневой `.gitignore` рядом с `.ycsf/artifacts/` (FR-001). Обе — локальные регенеративные директории, не коммитятся, Terraform их не видит. Blob copy — `cp -r` via `node:fs/promises cp` с `recursive: true` + `force`. Manifest — `writeFile(tmp) + rename`. Конкурентный `ycsf build` — last-write-wins, без file locking v1 (spec Concurrency).

**Rationale**: Консистентность с 021: `.ycsf/artifacts/` уже gitignored; cache — аналогичный lifecycle. Atomic rename достаточно для crash-safety на POSIX local FS.

---

## Все NEEDS CLARIFICATION решены

| # | Неопределённость | Решение |
|---|-----------------|---------|
| 1 | filesHash алгоритм и excludes | R-1: sorted relativePath+sha256(content), fixed excludes |
| 2 | ownFingerprint состав (4 компонента) | R-2: filesHash+buildConfig+resolved buildEnv+builder@version |
| 3 | Transitive инвалидация | R-3: effectiveFingerprint = sha256(own|sortedJoin(depEffects)) topo |
| 4 | Manifest формат и версионирование | R-4: JSON version:1, last-build-wins, atomic rename, fail-safe |
| 5 | Blob snapshot layout | R-5: artifact.json + outputDir copy, content-addressed |
| 6 | Integration точка | R-6: buildApps topo compute → cacheLookup → per-app save |
| 7 | CLI flags | R-7: --no-cache/--force/--cache-dir, explicit opt-out |
| 8 | Observability & fail-safe | R-8: per-app stderr + summary.cache, CACHE_* warnings not errors |
| 9 | Builder version lookup | R-9: package.json via registry packageName, fallback builderId |
| 10 | Gitignore + atomic I/O | R-10: .ycsf/cache/ gitignored, cp+rename |

## Constitution Check (re-check after research)

Все gates из plan.md остаются PASS. Research не вводит новых нарушений: cache — C-level optimization (I), no Artifact contract change (III), no Terraform schema modeling (IV), explicit flags/fixed excludes/fail-safe разграничение (V) сохранены. `Builder` остаётся stateless — research подтверждает shape в R-2/R-6.

