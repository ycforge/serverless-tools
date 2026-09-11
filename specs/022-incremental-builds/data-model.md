# Data Model: incremental-builds (spec 022)

**Spec**: [specs/022-incremental-builds/spec.md](./spec.md) | **Branch**: `022-incremental-builds` | **Date**: 2026-09-11

Сущности content-addressed кэша артефактов (§39). Кэш — C-internal optimization (не меняет `Artifact` контракт spec 002).

---

## 1. Структура cache модуля

```text
packages/pilot/src/cache/
├── fingerprint.ts    # filesHash(), ownFingerprint(), effectiveFingerprint(), canonicalJson()
├── manifest.ts       # CacheManifest I/O: loadManifest(), saveManifest() (atomic), version guard
├── blobs.ts          # Blob I/O: saveBlob(), restoreBlob(), hasValidBlob()
└── index.ts          # CacheStore facade: checkCache(), saveCache(), CacheReason, CacheEntry, CacheSummary
```

Дополнительно:

```text
packages/pilot/src/contracts/cache.ts   # CacheManifest, CacheEntry, CacheReason (type-only, @ycforge/pilot/contracts)
packages/pilot/src/build/index.ts       # UPDATE: fingerprint compute topo → cacheLookup → builders(only misses)
packages/pilot/src/cli/{build,plan,apply}.ts  # UPDATE: --no-cache/--force/--cache-dir → buildApps
```

---

## 2. Типы

### 2.1 CacheManifest (versioned file `/.ycsf/cache/manifest.json`)

```ts
/** Content-addressed cache manifest (S-1, FR-001/FR-028, Constitution III). */
export interface CacheManifest {
  /** Format version — must be 1. Mismatch → reset with warning. */
  readonly version: 1;
  /** Current entry per app (last-build-wins, no history). */
  readonly entries: Readonly<Record<string, CacheEntry>>;
}

export interface CacheEntry {
  /** App ID as in .ycsf/apps.yaml (key in entries map). */
  readonly appId: string;
  /** Own fingerprint: sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder })) — 64-char hex. */
  readonly fingerprint: string;
  /** Effective fingerprint: sha256(ownFingerprint + '|' + sortedJoin(depEffectiveFingerprints)) — 64-char hex. Blob key. */
  readonly effectiveFingerprint: string;
  /** Artifact type of last build (e.g. "ycforge:function"), for observability. */
  readonly artifactType: string;
  /** ISO timestamp of last successful build for this app. */
  readonly createdAt: string;
  /** Effective fingerprints of direct depends_on neighbours at build time (for debug). */
  readonly dependsOnFingerprints: readonly string[];
}
```

**Validation**:
- `version !== 1` → `CACHE_VERSION_MISMATCH` warning, treat as empty manifest (all miss).
- Corrupted JSON / I/O error → `CACHE_CORRUPTED` warning, treat as empty (FR-025).
- Missing `entries[appId]` → `no_entry` miss.
- `effectiveFingerprint` в entries сравнивается с вычисленным сейчас; mismatch → miss (FR-010/FR-011).

### 2.2 CacheBlob (content-addressed `/.ycsf/cache/blobs/<effectiveFingerprint>/`)

```ts
/** Blob layout on disk (S-1, D-8, FR-003). */
export interface CacheBlobMeta {
  /** Absolute path: <projectRoot>/.ycsf/cache/blobs/<effectiveFingerprint>/ */
  readonly dir: string;
  /** artifact.json content: { type: string, value: unknown } */
  readonly artifact: Artifact;
  /** OutputDir snapshot: recursive copy of builder's outputDir files into blobs/<fp>/files/ subtree (or flat copy). */
}
```

**On-disk**:
```text
.ycsf/cache/
├── manifest.json
└── blobs/
    └── <effectiveFingerprint>/   # 64-char hex
        ├── artifact.json         # { type, value }
        └── files/                # snapshot of .ycsf/artifacts/<appId>/ content (builders' outputDir)
```

**Validation**:
- Missing `artifact.json` или `files/` нечитаем → `blob_missing` / `corrupted` miss + `CACHE_BLOB_MISSING` warning + self-heal (delete stale entry, FR-013).

### 2.3 OwnFingerprint (S-2, FR-005..009)

```ts
/** 64-char lowercase hex sha256. In logs — first 8 chars. */

/** Own fingerprint components (all contribute to cache key). */
export interface OwnFingerprintInputs {
  /** sha256(sorted list: relativePath + '\0' + sha256(fileContent) + '\0') for all files under source_path. */
  readonly filesHash: string;
  /** Canonical JSON of build_config (opaque, sorted keys). {} if build_config.yaml absent. */
  readonly buildConfig: unknown;
  /** Resolved buildEnv Record<string,string> (after prepareBuildEnv, sorted keys). */
  readonly buildEnv: Readonly<Record<string, string>>;
  /** `${builderId}@${packageVersion}` or plain builderId if version unknown. */
  readonly builder: string;
}

// ownFingerprint = sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder }))

function canonicalJson(obj: unknown): string;
// JSON.stringify with recursive sorted keys, 0 spaces, deterministic.
```

**Rules**:
- `relativePath` POSIX от `projectRoot`, исключая `.git/`, `node_modules/`, `.ycsf/cache/`, `.ycsf/artifacts/`, `infra` (fixed list v1).
- Symlink → read error → miss (fail-safe, not stored).
- Empty source_path → `filesHash = sha256('')` (stable).
- `buildEnv` — resolved values (по `prepareBuildEnv`), не `{{$ENV}}` template.

### 2.4 EffectiveFingerprint (S-2, FR-008, D-4)

```ts
/** Transitive fingerprint: own + direct dependencies' effective fingerprints. */
function effectiveFingerprint(
  ownFingerprint: string,
  dependsOnEffectiveFingerprints: readonly string[]  // already computed in topo order
): string;
// = sha256(ownFingerprint + '|' + sortedJoin(dependsOnEffectiveFingerprints))
// sortedJoin = dependsOnEffectiveFingerprints.slice().sort().join('|')
// if [] → returns ownFingerprint

/** Compute order: topologicalOrder from ProjectModel.depends_on_graph (spec 011).
 *  For --target: deps outside target set taken from manifest or treated as changed if absent. */
```

**Invariants**:
- `depends_on` цикл → `PML_DEPENDS_CYCLE` fail-fast до fingerprint (spec 011, FR-027) — cache не оценивается.
- Deterministic across machines (relativePath, content hash, canonical JSON).

### 2.5 CacheReason (S-6, FR-011, FR-023)

```ts
export type CacheReason =
  | 'hit'
  | 'no_entry'
  | 'source_changed'
  | 'build_config_changed'
  | 'build_env_changed'
  | 'builder_changed'
  | 'dependency_changed'
  | 'no_cache'
  | 'blob_missing'
  | 'corrupted';

/** Per-app cache result for observability (S-6). */
export interface CacheCheckResult {
  readonly appId: string;
  readonly hit: boolean;
  readonly fingerprint: string;       // effectiveFingerprint (64 hex)
  readonly reason: CacheReason;
  readonly blobPath?: string;         // present on hit
}
```

**Detection order** для `reason` на miss (S-6, FR-011): `no_cache` (--no-cache) > `no_entry` > `blob_missing`/`corrupted` > `source_changed` > `build_config_changed` > `build_env_changed` > `builder_changed` > `dependency_changed`. Достаточно одной причины в логе (первая).

### 2.6 BuildAppsWithCache (S-4, FR-014..016)

```ts
/** Extended options (FR-019..020, S-5). */
export interface BuildAppsOptions {
  readonly target?: string;
  readonly onAppProgress?: (appId: string) => void;          // existing 021
  // NEW (022):
  readonly noCache?: boolean;                                // --no-cache / --force
  readonly cacheDir?: string;                                // --cache-dir <path> (default ".ycsf/cache" relative to projectRoot)
  readonly onCacheProgress?: (result: CacheCheckResult) => void; // per-app hit/miss for CLI stderr + --json
}

/** Extended summary for --json (S-6, FR-023). */
export interface CacheSummary {
  readonly hits: number;
  readonly misses: number;
  readonly entries: readonly CacheCheckResult[];
}
```

---

## 3. State transitions: cache lookup per app (topo order)

```text
computeEffective(app) → loadManifest() → check entry + hasValidBlob()
───────────────────────────────────────────────────────────────────────
noCache flag? ─── yes ──→ reason: no_cache ──→ MISS → builder → saveBlob+manifest
     │ no
manifest missing / version!==1 / corrupted? ──→ warning CACHE_* ──→ MISS (all apps)
     │ valid
entry missing? ──→ reason: no_entry ──→ MISS
     │ present
blob missing/corrupted? ──→ warning CACHE_BLOB_MISSING ──→ reason: blob_missing ──→ MISS (+ delete entry self-heal)
     │ blob valid
effectiveFingerprint !== entry.effectiveFingerprint? ──→ compare components → reason: source_changed | build_config_changed | build_env_changed | builder_changed | dependency_changed ──→ MISS
     │ equal
effective unchanged but dep had miss in THIS run? ──→ (effectiveFingerprint already differs via dep hash, so ↑ already miss)
     │ not miss
HIT ──→ restoreBlob(blobs/<fp>/ → artifacts/<appId>/) → return Artifact from blob (no builder call)
```

**Invariant**: Cache **never** masks `PML_DEPENDS_CYCLE` / `PML_*` / `CLI_BUILD_FAILED` — они fail-fast до или вместо cache (FR-027).

---

## 4. Cache write flow (FR-003, FR-016)

```text
builder.build(context) success
  ├─ 1. ensureDir(.ycsf/artifacts/<appId>/)  [already done by builder via outputDir]
  ├─ 2. saveBlob: cp(artifacts/<appId>/ → blobs/<effectiveFingerprint>/) + write artifact.json
  │     └─ I/O error → warning CACHE_WRITE_FAILED, treat as success (artifacts already valid) FR-026
  └─ 3. saveManifest: read current manifest → update entries[appId] → writeFile(manifest.json.tmp) → rename(manifest.json)
        └─ I/O error → warning CACHE_WRITE_FAILED, exit 0 (FR-026)
```

Per-app save (не батчем) — partial cache даже при падении следующего app (FR-016).

---

## 5. CLI integration (S-4, FR-018..023)

### 5.1 Build pipeline с кэшем

```text
buildApps(rootDir, options?)
│
├─ 1. loadProjectModel(rootDir) → PML errors → return invalid (fail-fast, no cache I/O)
├─ 2. prepareBuildEnv for appsToBuild → PML_ENV_* → return invalid (fail-fast)
├─ 3. loadRegistry → BRG_* → return invalid (fail-fast)
├─ 4. validateBuilders → BRG_UNKNOWN_BUILDER → return invalid (fail-fast)
├─ 5. if noCache → skip fingerprint+cache, all miss
│     else:
│     ├─ 5a. computeOwnFingerprint for each app in topologicalOrder
│     │       ├─ filesHash(source_path) — sorted relativePath + sha256(content)
│     │       ├─ canonicalJson(buildConfig) — from build_configs
│     │       ├─ resolvedEnv — from prepareBuildEnv
│     │       └─ builderId@packageVersion — from registry packageName → package.json
│     ├─ 5b. computeEffectiveFingerprint topo (own + sorted dep effects)
│     ├─ 5c. loadManifest(cacheDir) — fail-safe on corruption/version
│     └─ 5d. cacheLookup(app) → CacheCheckResult (hit/miss + reason)
├─ 6. For each app in topologicalOrder:
│     ├─ onCacheProgress(result) → CLI stderr or summary entry
│     ├─ hit → restoreBlob(blobs/<fp>/ → artifacts/<appId>/) → push BuiltArtifact
│     └─ miss → onAppProgress(appId) → builder.build() → saveBlob+manifest → push BuiltArtifact
│
└─ 7. Return { kind:'ok', artifacts, cache: CacheSummary }
```

### 5.2 Commands affected

| Command | Cache | Notes |
|---------|-------|-------|
| `ycsf build` | ✅ read+write | `buildApps` directly |
| `ycsf plan` | ✅ via build phase | `buildApps` → materialize → terraform |
| `ycsf apply` | ✅ via build phase | same as plan + terraform apply |
| `ycsf materialize` | ❌ | always dispatch (S-4) |
| `ycsf destroy` | ❌ | never reads/writes cache |
| `ycsf check` | ❌ | pure validation |

### 5.3 Flags mapping

| Flag | build | plan | apply | materialize | check | destroy |
|------|-------|------|-------|-------------|-------|---------|
| `--no-cache` | ✅ | ✅ | ✅ | — | — | — |
| `--force` (alias) | ✅ | ✅ | ✅ | — | — | — |
| `--cache-dir <path>` | ✅ | ✅ | ✅ | — | — | — |
| `--target` | ✅ | — | — | ✅ | — | — |
| `--json` | ✅ (summary.cache) | ✅ | ✅ | — | — | — |

---

## 6. Validation rules

| Rule | Source | Enforcement |
|------|--------|-------------|
| Fingerprint 64-char hex, lower-case sha256 | S-2 FR-005/009 | regex `^[a-f0-9]{64}$`, logs show first 8 |
| Manifest version must be 1 | FR-004 FR-028 | `CACHE_VERSION_MISMATCH` warning, reset |
| Blob must contain artifact.json + files snapshot | FR-010 | `hasValidBlob()` check; missing → `blob_missing` miss |
| Effective includes direct depends_on only (transitive via recursion) | FR-008 D-4 | topo + sortedJoin |
| Cache enabled by default, no env/config toggle | FR-020 D-5 | only `--no-cache`/`--force` disable |
| `--target` deps considered even outside target set | FR-021 S-2 | manifest last-entry or miss if absent |

---

## 7. Invariants

```text
invariants:
  Cache owns C orchestration (Constitution I):
    → Cache logic in src/cache/ + buildApps wrapper only
    → Builder stateless, no cache knowledge

  Content-addressed (S-1, D-2):
    → Blob key = effectiveFingerprint (hex sha256)
    → Manifest entries — last-build-wins per app

  Transitive invalidation (D-4, FR-012):
    → effective = sha256(own | sorted(depEffects)) in topologicalOrder
    → Change in dependency → dependent miss even if its files unchanged

  Fail-safe vs fail-fast (D-7, FR-025..027):
    → Corrupted manifest/blob → warning + miss, exit 0 if build ok
    → Invalid project model / builder error → fail-fast exit 1/2 before cache

  Blob = artifact.json + outputDir snapshot (D-8):
    → Hit fully equivalent to miss+build for downstream materialize

  Deterministic fingerprint (FR-009):
    → relativePath POSIX, content hash not mtime, canonical JSON sorted keys
    → Stable across machines/CI
```
