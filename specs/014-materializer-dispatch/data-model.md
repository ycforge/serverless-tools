# Data Model: materializer-dispatch — два фазма, MTL диагностики, `.tf.json`

## Entities

### ArtifactDescriptor
Плоский дескриптор входного artifact для dispatch. Строится из `ProjectModel.apps` (spec 011): один app → один descriptor (FR-001, Assumption «one artifact per app»).

```typescript
interface ArtifactDescriptor {
  readonly id: string;    // = app.app_id (уникальный идентификатор app)
  readonly name: string;  // = app.app_id (human-readable имя; источник filename)
  readonly type: string;  // = app.builder id (ключ из builders.yaml; ключ dispatch)
}
```

Инварианты:
- `type` — app builder id (напр. `nestjs-function`), НЕ full `package-scope:kind` art­i­fact type (spec: dispatch оперирует type descriptor, type = builder key).
- `id === name === app.app_id` (spec FR-001).
- App ids уникальны по construction (spec 011) → filename `<app_id>.ycsf.tf.json` уникален.

### MaterializerMatch
Результат Phase 1 для одного artifact: единственный supplier или диагностика(и).

```typescript
type MaterializerMatch =
  | { readonly ok: true; readonly materializerId: string }
  | { readonly ok: false; readonly errors: readonly DispatchDiagnostic[] }; // MTL_COLLISION | MTL_UNHANDLED_ARTIFACT
```

- `ok` — ровно 1 supporter (spec 002 `supports === true`).
- 2+ supporters → `MTL_COLLISION` (в сообщении — оба (все) materializer ids; Constitution V).
- 0 supporters → `MTL_UNHANDLED_ARTIFACT` (artifact type + список зарегистрированных materializer ids; Constitution V: error, не warning).

collision/unhandled описывают ОДИН artifact; все match-ы собираются в Phase 1 (collect-all) → все selection errors для invalid-результата (FR-017).

### SelectedMaterialization / DispatchedResource
Внутренняя запись результата materialize (spec Key Entities «DispatchedResource», не public API).

```typescript
interface DispatchedResource {
  readonly resource: TerraformResource; // spec 002
  readonly appId: string;               // app_id → filename
  readonly materializerId: string;      // registry entry id (для диагностик)
}
```

### MaterializeResult
Union-результат одного вызова `materialize` (внутренний, Phase 2).

```typescript
type MaterializeResult =
  | { readonly kind: 'ok'; readonly resource: DispatchedResource }
  | { readonly kind: 'failed'; readonly error: DispatchDiagnostic }; // MTL_MATERIALIZE_FAILED
```

### GeneratedTfFile
Сериализованный `.tf.json` файл — часть публичного `DispatchResultOk.generatedFiles` (spec Dispatch API).

```typescript
interface GeneratedTfFile {
  readonly filename: string; // '<app_id>.ycsf.tf.json' | '00-ycsf-outputs.tf.json'
  readonly content: string;  // валидный Terraform JSON (детерминированный, sorted keys)
}
```

### DispatchResult / DispatchOptions / DispatchDiagnostic
Публичный API (spec Dispatch API, Key Entities).

```typescript
interface DispatchOptions {
  readonly infraDir?: string; // default 'infra' (зарезервирован для API; I/O исполняет write)
}

type DispatchResult =
  | { readonly kind: 'ok';
      readonly resources: readonly TerraformResource[]; // в deterministic порядке (FR-014)
      readonly generatedFiles: readonly GeneratedTfFile[]; }
  | { readonly kind: 'invalid';
      readonly errors: readonly DispatchDiagnostic[]; }; // selection (все) ИЛИ materialize (один, abort-on-first)

interface DispatchDiagnostic {
  readonly code: string;   // MTL_* (см. MTL catalog)
  readonly message: string;
  readonly artifactId?: string;      // app_id (для unhandled/materialize-failed)
  readonly materializerIds?: string[]; // для MTL_COLLISION; [id] для MTL_UNHANDLED_ARTIFACT
  readonly materializerId?: string;  // единственный id для materialize-failed
  readonly type?: string;            // MTL_INVALID_TERRAFORM_ADDRESS / MTL_COLLISION: data
  readonly name?: string;            // MTL_INVALID_TERRAFORM_ADDRESS: data
  readonly outputName?: string;      // MTL_OUTPUT_NAME_COLLISION: дублируемое имя
  readonly filename?: string;        // MTL_FILENAME_COLLISION: вычисленный filename
}
```

Инварианты:
- `invalid` бывает двух форм: **все selection errors** (Phase 1, collect-all, `materialize` не вызывался) ИЛИ **один `MTL_MATERIALIZE_FAILED`** (Phase 2, abort-on-first). Обе формы — атомарный invalid без частичного `resources`.
- `ok.resources` — Phase-2 результаты в deterministic порядке (совпадает с порядком `generatedFiles` по приоритету приложений).

### OutputBuilder (коллектор outputs)
Спецификация 002 `OutputBuilder`; реализация — в `src/materialize/context.ts`.

```typescript
interface OutputCollection {
  readonly declared: ReadonlyMap<string, { value: string; description?: string }>; // insertion order
  readonly duplicateNames: readonly string[]; // → MTL_OUTPUT_NAME_COLLISION
}
```

- `declare(name, {value, description?})`: первый declare принимается; повторный (тот же name) → фиксируется duplicate, ошибка накапливается и сериализуется как `MTL_OUTPUT_NAME_COLLISION` (Constitution V: collision = error, не merge).
- `value` — raw Terraform expression БЕЗ `${...}`; обёртка `${...}` — обязанность C при сериализации (spec 002).

## Relationships

```
App (ProjectModel, 011)
 └── ArtifactDescriptor {id: app_id, name: app_id, type: builder}   [FR-001]
      └── PluginRegistry.records (013)                             [supports iteration]
           materializer entries (kind: 'materializer')
      └── MaterializerMatch (select) → SelectedMaterializer
           └── materialize() → TerraformResource                    [Phase 2, FR-005]
                ├── resource.type ═ address ═ type.name             [serialize]
                ├── resource.name ───────────────► {resource:{type:{name:conf}}}  [FR-007]
                └── OutputBuilder.declare(...) ──► 00-ycsf-outputs.tf.json       [FR-012]

GeneratedTfFile ──(writeGeneratedTerraform, I/O)──► infra/<filename> (только *.ycsf.tf.json)
```

- `ProjectModel.depends_on_graph` (011) → порядок artifacts через `deterministicOrder(projectModel)` (A5): alphabetical pre-sort `app_id`, затем topological consumption по `depends_on_graph.adjacency`; порядок матчит US-4 (research 2 / A5).
- Registry records (013) iterated в insertion order → deterministic список materializer-ов (research 2).
- `PluginEntry.module: unknown` → shape-guard сужает до `Materializer` (research 4).

## Dispatch Flow (State Transitions)

```
dispatch(projectModel, registry, options?)

 Phase 1 — SELECT (all-or-nothing, FR-017):
   orderedAppIds = deterministicOrder(projectModel)              [FR-014; alpha pre-sort + topo по adjacency (A5)]
   for artifact in artifacts(orderedAppIds):
     supporters = []                                                      [FR-002]
     for entry in registry.records.values() where kind==='materializer':
        if isMaterializerShape(entry.module) && module.supports(artifact, ctx):
            supporters.push(entry.id)
     if supporters.length === 0        → MTL_UNHANDLED_ARTIFACT (artifactId, type, registered ids)
     if supporters.length  > 1         → MTL_COLLISION (type, all ids)
     else                              → ok match (materializerId)
     (supports: sync, pure, I/O-free — selection не может «упасть»; research 3)
   if ANY selection error → return { kind:'invalid', errors: ALL selection errors }
                                            (materialize НЕ вызывается ни для одного artifact)

 Phase 2 — MATERIALIZE (abort-on-first, FR-006):
   outputBuilder = new OutputBuilder()                                    [context per dispatch call]
   for artifact in artifacts(orderedAppIds):                             [тот же порядок]
     ctx = { output: outputBuilder }                                      [spec 002, не расширяется]
     try: resource = await module.materialize(artifact, ctx)
          results.push({resource, appId, materializerId})
     catch e: return { kind:'invalid', errors:[ MTL_MATERIALIZE_FAILED(artifactId, materializerId, e.message) ] }
                                            (abort; предыдущие результаты НЕ возвращаются)

 SERIALIZE (in-memory, не I/O):
   files = []
   for {resource, appId} in results:
      assertAddressValid(resource.type) && assertAddressValid(resource.name)  [MTL_INVALID_TERRAFORM_ADDRESS]
      filename = `${appId}.ycsf.tf.json`;  assertFilenameUnique(filename)     [MTL_FILENAME_COLLISION]
      files.push({filename, content: serializeResource(resource)})            [FR-007, sorted keys]
   if outputBuilder.duplicateNames → return MTL_OUTPUT_NAME_COLLISION          [FR-013]
   if outputBuilder.declared.size > 0:
      files.push({filename: '00-ycsf-outputs.tf.json',
                  content: serializeOutputs(outputBuilder.declared)})          [FR-012]
   return { kind:'ok', resources, generatedFiles: files }

writeGeneratedTerraform(infraDir, files)  [pure I/O, FR-015/016]
   mkdir -p infraDir
   for file in files: writeFile(join(infraDir, file.filename), file.content)
   for existing in readdir(infraDir) where isOwned(existing):      [glob *.ycsf.tf.json]
        if existing ∉ files.filenames → unlink(existing)           [stale cleanup]
   (user *.tf никогда не читается/не пишется)
```

## Validation Rules

| Stage | Entity | Rule | Code |
|-------|--------|------|------|
| select | artifact | 0 supporters | `MTL_UNHANDLED_ARTIFACT` (artifactId, artifact type, registered materializer ids) |
| select | artifact | 2+ supporters | `MTL_COLLISION` (artifact type, все materializer ids) |
| select | all artifacts | ≥1 selection error ⇒ invalid; `materialize` не вызывается (all-or-nothing) | (FR-017; результат `invalid`) |
| materialize | artifact | materializer threw/rejected | `MTL_MATERIALIZE_FAILED` (artifactId, materializerId, original message); abort-on-first |
| serialize | resource | `type`/`name` не ([`a-zA-Z_`][`a-zA-Z0-9_`]*) | `MTL_INVALID_TERRAFORM_ADDRESS` |
| serialize | filename | два artifacts → одинаковый filename (оборонительно) | `MTL_FILENAME_COLLISION` |
| serialize | outputs | duplicate output name через `declare` | `MTL_OUTPUT_NAME_COLLISION` |
| write | file | запись/перезапись только `*.ycsf.tf.json`; `*.tf` не трогаются | — (FR-015) |
| write | stale | `*.ycsf.tf.json` вне текущего набоа удаляется | — (FR-016) |

## MTL_* Error Code Catalog

| Code | Когда | Диагностика несёт |
|------|-------|-------------------|
| `MTL_COLLISION` | 2+ materializers заявляют `supports` для одного artifact type | artifact type, все materializer ids (есть `materializerIds`) |
| `MTL_UNHANDLED_ARTIFACT` | 0 supporters | artifact id, artifact type, список registered materializer ids |
| `MTL_MATERIALIZE_FAILED` | materializer бросил при `materialize()` | artifact id, materializer id, original message |
| `MTL_FILENAME_COLLISION` | два resources вычислили одинаковый filename | оба filename (artifact ids) |
| `MTL_INVALID_TERRAFORM_ADDRESS` | `type` или `name` не соответствуют grammar `[a-zA-Z_][a-zA-Z0-9_]*` | type, name, invalid char (из type/name) |
| `MTL_OUTPUT_NAME_COLLISION` | Задекларирован один и тот же output name дважды | output name, artifact ids |

Константы — в `src/contracts/materialize.ts`, сравниваются через константы (Constitution V); зеркало — `contracts/materialize.json`.

## Decisions (cross-ref research)

- Two-phase all-or-nothing (не stream) — research 1.
- Determinism: sorted JSON keys + artifact полный deterministic order + materializer insertion order — research 2.
- `supports` sequential, pure, I/O-free; selection не может «упасть» — research 3.
- Materializer identity = `PluginEntry.id`; tf address = `type.name`; shape-guard `unknown` → Materializer — research 4.
- JSON: `JSON.stringify(value, replacer, 2)` sorted keys; file per app + outputs file; opaque `configuration` без schema validation — research 5.
- Filename `<app_id>.ycsf.tf.json`; ownership glob `*.ycsf.tf.json`; write+stale-cleanup без manifest — research 6.
- Throw/reject → `MTL_MATERIALIZE_FAILED`, abort-on-first, без partial resources — research 7.
- Context = spec 002 `{ output }`, не расширяется; env → 021 — research 8.
- Без version-маркера в `.tf.json` (Terraform JSON exact) — research 9.
- `MTL_*` в `src/contracts/materialize.ts` + `contracts/materialize.json`; runtime в `src/materialize/` (fs только в write.ts) — research 10.