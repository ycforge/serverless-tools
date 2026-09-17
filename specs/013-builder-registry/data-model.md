# Data Model: builder-registry — `.ycsf/builders.yaml`, плагины, валидация модели

## Entities

### BuildersYaml
Содержимое `.ycsf/builders.yaml` после структурного парсинга (до загрузки модулей).

```typescript
interface BuildersYaml {
  version: 1;                           // обязательно (FR-002)
  builders: Record<string, string>;        // identifier → package specifier (FR-004)
  materializers: Record<string, string>;   // identifier → package specifier (FR-004)
}
```

Инварианты:
- `version === 1` (Constitution III).
- ключи: непустая строка `[\w-]+` (letter/digit/underscore/hyphen; `builder`/`materializer` identifier).
- значения: непустая строка (import specifier — package name в проде, путь к fixture в тестах; research 4).
- `builders` и `materializers` — **не пересекаются** по ключам (FR-003, Constitution V).
- дубликат ключа в пределах раздела — error (FR-003, uniqueKeys).
- пустые `builders`/`materializers` (или файл только с `version: 1`) — валидно, пустой registry.

### PluginKind
Литеральный тип результата shape-детекции (spec Key Entities).

```typescript
type PluginKind = 'builder' | 'materializer';
```

### PluginEntry
Одна успешно загруженная и распознанная запись registry (spec Key Entities).

```typescript
interface PluginEntry {
  id: string;                     // identifier (builders.yaml key)
  packageName: string;            // import specifier (npm package path/name)
  kind: PluginKind;               // builder | materializer (detected by shape)
  module: unknown;                // loaded module (exports Builder or Materializer, spec 002)
}
```

Инвариант: `kind` установлен в результате shape-детекции (research 2); module — объект, несущий `build` (builder) или `supports`+`materialize` (materializer).

### PluginRegistry
Иммутабельный результат загрузки (spec Key Entities, FR-015, research 6).

```typescript
interface PluginRegistry {
  records: ReadonlyMap<string, PluginEntry>;   // key = identifier → entry
}
```

- Один identifier → ровно одна запись (ключ уникален в рамках registry; builders↔materializers коллизия исключена на структурном pass).
- Иммутабелен после построения (research 6). Загруженные module handles закэшированы (ESM module caching).
- Содержит только успешно распознанные entries; failed записи НЕ попадают сюда — они уходят в `errors` (ниже).

### PluginLoadError
Ошибка загрузки одного plugin (spec Key Entities).

```typescript
interface PluginLoadError {
  id: string;           // identifier
  packageName: string;  // import specifier, который не удалось загрузить
  code: 'BRG_PACKAGE_NOT_FOUND' | 'BRG_NOT_A_PLUGIN' | 'BRG_LOAD_ERROR';
  message: string;
}
```

### PluginRegistryLoadResult
Результат `loadRegistry` (research 3/6).

```typescript
type PluginRegistryLoadResult =
  | { kind: 'ok'; registry: PluginRegistry }
  | { kind: 'invalid'; errors: readonly RegistryError[] };
```

- `invalid` — либо структурные ошибки `builders.yaml` (BRG_VERSION/BRG_DUPLICATE_KEY/BRG_KEY_COLLISION/BRG_INVALID/BRG_MISSING_FILE), либо plugin-load errors (BRG_*), либо и то и другое. Полная загрузка плагинов происходит только если структурный pass успешен (SC-004).
- FR-015 (partial load): всегда пытаемся загрузить ВСЕ распознаваемые entries; неудача одного не мешает другим; непустой `errors` ⇒ `invalid` (fail-fast, не warning).

### BuilderRegistryValidationResult
Результат `validateBuilders(projectModel, registry)` (spec Key Entities, FR-013, research 8).

```typescript
type BuilderRegistryValidationResult =
  | { kind: 'ok' }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };   // BRG_UNKNOWN_BUILDER на каждый unknown builder
```

Инвариант: collect-all — одна ошибка на каждый `App.builder`, отсутствующий в `registry.records`.

### RegistryError / PluginDiagnostic
См. «Диагностика» ниже. Reuse `ProjectModelDiagnostic` для `validateBuilders` (research 8); структурные/load-диагностики registry используют тот же shape (code/message/file/[app/field/line/column]).

## Relationships

```
ProjectModel (spec 011)
└── apps: Map<app_id, App>
       App.builder ────────────► PluginRegistry.records (по identifier)   [validateBuilders: BRG_UNKNOWN_BUILDER при отсутствии]

builders.yaml
└── builders / materializers map ──(structure)──► PluginRegistry.records
       key = identifier; value = packageName; kind = shape-detected на loaded module
```

- `builders:` entries ⇒ `kind: 'builder'`; `materializers:` entries ⇒ `kind: 'materializer'`. Распознавание может переопределить ожидаемый раздел? — НЕТ: раздел задаёт **semantic intent** (builder vs materializer), shape-детекция **подтверждает** соответствие контракту (spec 002). Если раздел `builders:` даёт entry, чей module имеет materializer shape, это по-прежнему **builder entry** (идентификатор регистрируется как builder); shape-несоответствия контракту (нет ни `build`, ни `supports`+`materialize`) → `BRG_NOT_A_PLUGIN`. Раздел не «вызывает» kind из shape; см. note ниже.

> **Note (kind determination)**: spec FR-007/FR-008 — «распознавание: если export имеет build → kind: 'builder'». Раздел (`builders:` vs `materializers:`) уже фиксирует регистр; shape-детекция подтверждает, что загруженный модуль действительно plugin, и позволяет разделить `BRG_NOT_A_PLUGIN`. Внутри одного раздела kind не варьируется (все `builders:` = builder). Это согласуется с data-model как с semantic mapping: identifier→plugin, с (необязательной, но валидируемой) shape-проверкой. Итоговый `PluginEntry.kind` берётся из раздела; `BRG_NOT_A_PLUGIN` — если module не несёт ожидаемого builder- или materializer-shape вообще.

## Load Flow (State Transitions)

```
loadRegistry(rootDir)  [async]
  → read .ycsf/builders.yaml         (MUST exist → BRG_MISSING_FILE)
      → parse (yaml, uniqueKeys:true) → BRG_DUPLICATE_KEY / BRG_INVALID (syntax)
      → check version:1              → BRG_VERSION
      → extract builders/materializers → BRG_INVALID / BRG_KEY_COLLISION (cross-section) / BRG_DUPLICATE_KEY
        (структурный pass; любой error ⇒ return invalid ДО загрузки модулей, SC-004)
  → for each entry: await import(packageName)
      ├─ resolved → shape-detect (research 2)
      │    ├─ builder/materializer shape → PluginEntry (kind='builder'|'materializer')
      │    └─ neither                       → BRG_NOT_A_PLUGIN
      └─ rejected
           ├─ ERR_MODULE_NOT_FOUND → BRG_PACKAGE_NOT_FOUND
           └─ other (syntax/runtime)       → BRG_LOAD_ERROR
      (partial: collect all; каждый entry независим)
  → if errors non-empty → { kind:'invalid', errors }; else { kind:'ok', registry }

validateBuilders(projectModel, registry)  [sync]
  → for each App in projectModel.apps
       see if App.builder ∈ registry.records
       └─ missing → BRG_UNKNOWN_BUILDER (app_id, unknown id, list of available builders)
  → if any → { kind:'invalid', errors }; else { kind:'ok' }
```

## Validation Rules

| Stage | Entity | Rule | Error code |
|-------|--------|------|------------|
| structural | builders.yaml | файл существует | `BRG_MISSING_FILE` |
| structural | builders.yaml | YAML парсится (uniqueKeys) | `BRG_DUPLICATE_KEY` / `BRG_INVALID` |
| structural | builders.yaml | top-level имеет `version === 1` | `BRG_VERSION` |
| structural | builders.yaml | top-level shape: mapping с `builders`/`materializers` (оба опциональны, могут отсутствовать) | `BRG_INVALID` |
| structural | builders.yaml | ключ непустой строкой `\w+` | `BRG_INVALID` |
| structural | builders.yaml | дубликат ключа в пределах `builders` или `materializers` | `BRG_DUPLICATE_KEY` |
| structural | builders.yaml | пересечение ключей builders↔materializers | `BRG_KEY_COLLISION` |
| structural | builders.yaml | значение — непустая строка (import specifier) | `BRG_INVALID` |
| load | import | модуль не найден / не resolvable | `BRG_PACKAGE_NOT_FOUND` |
| load | import | модуль загружен, но ошибка при оценке (syntax/runtime) | `BRG_LOAD_ERROR` |
| load | shape | module не несёт ни `Builder`, ни `Materializer` shape | `BRG_NOT_A_PLUGIN` |
| load | shape | module несёт оба shape (builder+materializer) | (none) — builder wins (research 2); documented |
| validate | app | `App.builder` отсутствует в registry | `BRG_UNKNOWN_BUILDER` (app, unknown id, available builders; collect-all) |

## Decisions (cross-ref research)

- Dynamic `import()`, error classification via `error.code` — research 1.
- Default **or** named export; builder-priority on both-shape ambiguity — research 2.
- `loadRegistry` async, `validateBuilders` sync — research 3.
- Test fixtures = temp `.mjs`/`.cjs` files as import specifiers — research 4.
- BRG_* in new `contracts/plugin-registry.json` catalog — research 5.
- Immutable registry (ReadonlyMap + freeze) — research 6.
- Duplicate-key semantics reuse `uniqueKeys: true` — research 7.
- `validateBuilders` reuses `ProjectModelDiagnostic` — research 8.
