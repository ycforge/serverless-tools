# Data Model: extensions — `.ycsf/extensions.yaml`, IDL-индекс, deep merge, EXT диагностики

## Entities

### ExtensionRule
Одно правило расширения: IDL-таргет + patch-дерево.

```typescript
interface ExtensionRule {
  readonly target: string;                                     // IDL `domain.name` (§16)
  readonly patch: Record<string, unknown>;                    // JSON-дерево (YAML-tree), применяется к configuration
}
```

Инварианты:
- `target` — ровно два сегмента `[a-z][a-z0-9_]*.[a-z][a-z0-9_]*` (грамматика сегментов spec-002 `ResourceReference`; нижний регистр, подчёркивание допустимо, дефис нет). 1 или 3+ сегмента, пустой сегмент, не-lowercase, дефис/слэш → `EXT_INVALID` (loader) / не резолвится (apply).
- `patch` — plain-object mapping (YAML-таблица). Скаляр/list/null → `EXT_INVALID` (FR-004). `patch: {}` валиден (no-op, US8 AC1).
- Значения в `patch` C НЕ валидирует против provider schema (FR-015, Constitution IV); проверяется только типа-структура, необходимая для merge.

### ExtensionsYaml
Содержимое `.ycsf/extensions.yaml` (Constitution III — `version: 1`).

```typescript
interface ExtensionsYaml {
  readonly version: 1;                                  // константа 1
  readonly extensions: readonly ExtensionRule[];        // пустой [] валиден (identity no-op, US8 AC2)
}
```

Инварианты:
- `version` обязателен и равен `1`; иначе `EXT_VERSION` (Loader).
- Ровно два top-level ключа: `version`, `extensions`; неизвестный ключ → `EXT_INVALID` (research 7, Constitution V).
- `extensions` обязателен и является массивом правил; отсутствие/не-список → `EXT_INVALID` (FR-004).
- Каждое правило — mapping ровно с ключами `target` и `patch`; лишние/отсутствующие ключи → `EXT_INVALID` (FR-004).
- Duplicate YAML-keys в любом mapping (включая вложенные в `patch`) → `EXT_INVALID` (parse-gate `uniqueKeys`, research 3).

### IDL (logical identity, §16)
Стабильный логический идентификатор ресурса `domain.name`: `functions.user_service`, `gateways.openapi`. В отличие от IDT (`yandex_function.user_service`) устойчив к rename (Constitution VI: name сегмент = `resource.name`). Грамматика: два сегмента `[a-z][a-z0-9_]*`; первый сегмент (domain) — из side-table C, второй (name) — `resource.name`.

### IDL_DOMAIN_BY_TF_TYPE
Нормативная C-owned side-table «Terraform resource type → IDL domain» (`src/extensions/idl.ts`, research 1):

| Terraform resource type | IDL domain |
|-------------------------|------------|
| `yandex_function`       | `functions` |
| `yandex_api_gateway`    | `gateways` |

- Аддитивно расширяется будущими спеками (019); ресурсы с типом вне таблицы **не IDL-адресуемы** (в индекс не попадают; сами по себе — не ошибка, FR-006).
- Таблица 1:1 → IDL уникален по construction (один app → один resource, `resource.name` уникален в пределах типа). Нарушение — defensive `EXT_INVALID` «duplicate IDL <idl> in generated model» (непроизводимо на текущем dispatch).

### IdlIndex
Детерминированный индекс IDL → resource, строящийся в validation-фазе `applyExtensions` (FR-006).

```typescript
interface IdlIndex {
  readonly byIdl: ReadonlyMap<string, TerraformResource>;  // idl → resource (по construction — 1:1)
  readonly availableIdls: readonly string[];               // алфавитный сортированный список всех IDL (для диагностик FR-007)
}
```

- Строится только из ресурсов с типом из `IDL_DOMAIN_BY_TF_TYPE`: `idl = domain + '.' + resource.name`.
- `availableIdls` — для message-а `EXT_UNRESOLVED_TARGET` (детерминированный алфавитный порядок, FR-007/US3 AC1).

### IDLError
Запись неразрешённого target (внутреннее представление diagnostic-данных, порождает `EXT_UNRESOLVED_TARGET`).

```typescript
interface IDLError {
  readonly target: string;                 // неразрешённый target из файла
  readonly availableIdls: readonly string[]; // доступные IDL в алфавитном порядке
}
```

- Покрывает и грамматически валидный, но несуществующий домен (`containers.user_service` при отсутствии домена) — resolution-level ошибка, НЕ структурная (spec Scope 2; conservative к росту таблицы 019).

### ExtensionsDiagnostic
Диагностика resolution/validation фазы `applyExtensions` (spec Key Entities). Отдельный тип от `ProjectModelDiagnostic` (поля локации опциональны; у resolution-ошибок файл/строки нет — transform не знает файла).

```typescript
interface ExtensionsDiagnostic {
  readonly code: string;                     // EXT_* (constants, Constitution V)
  readonly message: string;
  readonly target?: string;                  // EXT_UNRESOLVED_TARGET / EXT_DUPLICATE_TARGET: проблемный target
  readonly file?: string;                    // не заполняется в apply (чистый transform); заполняет loader
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
  readonly availableIdls?: readonly string[]; // EXT_UNRESOLVED_TARGET: доступные IDL (алфавитно)
}
```

Структурные diagnostics loader-а (EXT_VERSION/EXT_INVALID) переиспользуют `ProjectModelDiagnostic` из 011 (HR: research 3/5 — единый shape и `diag()`).

### ExtensionsLoadResult / ParseResult
Результат loader-а (паттерн spec 011 `loadProjectModel`).

```typescript
type ExtensionsLoadResult =
  | { readonly kind: 'ok'; readonly data: ExtensionsYaml }
  | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] };  // collect-all (FR-004)

type ParseExtensionsYamlResult =                              // внутренний (extensions-yaml.ts)
  | { readonly kind: 'ok'; readonly data: ExtensionsYaml }
  | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] };
```

- Отсутствующий файл → **throw** `Error('missing .ycsf/extensions.yaml (EXT_MISSING_FILE)')` (FR-002, паттерн `BRG_MISSING_FILE`/011). Наличие файла решает оркестратор 021; проект без extensions loader не вызывает.
- Дубликаты `target` НЕ проверяются в loader (FR-005: зона validation `applyExtensions`; единая точка входа для 020 check).

### ApplyExtensionsResult
Результат pure transform (spec Dispatch API / Key Entities).

```typescript
type ApplyExtensionsResult =
  | { readonly kind: 'ok'; readonly resources: readonly TerraformResource[] }   // patched, immutable
  | { readonly kind: 'invalid'; readonly errors: readonly ExtensionsDiagnostic[] }; // collect-all, no patch applied
```

Инварианты:
- `invalid` атомарен: при любой ошибке validation **ни один patch не применён** (all-or-nothing, FR-007/US3 AC2/US4 AC2).
- `ok.resources` — новый массив; `kind`/`type`/`name` каждого ресурса сохранены (FR-012); у таргетированных изменён только `configuration` (deep merge); нетаргетированные переиспользуются по ссылке (research 6).

### DeepMerge
Семантика (не сущность; §25.2, FR-008):

```
deepMerge(base, patch):
  if isPlainObject(base) && isPlainObject(patch):
      result = {}
      for key in keys(base):           # ключи base сохраняются, пока не заменены/подмержены patch
          result[key] = key in patch ? deepMerge(base[key], patch[key]) : base[key]
      for key in keys(patch):          # новые ключи patch добавляются
          if key not in result: result[key] = deepMerge(undefined→base отсутствует, patch[key])
      return result                    # isPlainObject(undefined)=false → вернёт patch значение
  else:
      return patch                     # array/scalar/null из patch → REPLACE; base не plain-object → REPLACE
```

Точное правило (spec Scope 3): **рекурсия тогда и только тогда, когда ОБА значения — plain objects; во всех остальных случаях значение из patch заменяет base.** non-mutating: входы `readonly`, общие поддеревья base переиспользуются по ссылке.

## Relationships

```
ExtensionsYaml (версионированный .ycsf-контракт, III)
 └── ExtensionRule {target → IDL, patch → JSON-дерево}
      target ──(IDL grammar)──► IDL {domain.name}  [loader: EXT_INVALID при нарушении]
                                    │
TerraformResource[] (output dispatch 014)
 └── IdlIndex: idl = IDL_DOMAIN_BY_TF_TYPE[type].name  [только ресурсы из side-table; FR-006]
      │   availableIdls: алфавитно
      ├── target === idl (ровно один ресурс)           [FR-007]
      │    0 совпадений          → EXT_UNRESOLVED_TARGET (target + availableIdls)
      │    2+ правила с тем же target → EXT_DUPLICATE_TARGET (validation, FR-005)
      │    duplicate idl в индексе → EXT_INVALID (defensive)
      └── patch ──(deepMerge)──► resource.configuration (только configuration; kind/type/name не меняются)
            └── результат ──(serialize 014, без изменений)──► <app_id>.ycsf.tf.json
```

- `TerraformResource` (002) и dispatch/serialize (014) **не изменяются**: никаких новых полей (`idl?` отвергнуто spec-решением), никаких правок сигнатур. 015 — аддитивный чистый transform.
- Врезка «dispatch → applyExtensions → serialize» и передача extensions в пайплайн — оркестрация 021 (вне scope).
- `{{$ENV}}`/`${...}` строки в значениях patch проходят байт-в-байт (FR-010/FR-011): никакой интерполяции/валидации.

## Apply Flow (State Transitions)

```
applyExtensions(resources, extensionsYaml):

 VALIDATION-фаза (collect-all, all-or-nothing; research 5):
   index = {}; available []; seen = Set<idl>
   for resource in resources:                                [порядок входа сохраняется — не важен для валидации]
      domain = IDL_DOMAIN_BY_TF_TYPE[resource.type]
      if domain === undefined: continue                        [не IDL-адресуем; не ошибка (FR-006)]
      idl = `${domain}.${resource.name}`
      if seen.has(idl): errors.push(EXT_INVALID: duplicate IDL <idl> in generated model)  [defensive]
      else: index.set(idl, resource); seen.add(idl); available.push(idl)
   available.sort()                                           [алфавитный детерминированный список]

   duplicates = targets встречающиеся >1 раза (в порядке первого появления)  → EXT_DUPLICATE_TARGET
   for rule in extensions (в порядке файла):
      if duplicates.has(rule.target): continue                [не дублировать сообщение]
      if !index.has(rule.target):
          errors.push(EXT_UNRESOLVED_TARGET(rule.target, available))
      else if !isPlainObject(index.get(rule.target).configuration):
          errors.push(EXT_INVALID: configuration of <target> is not a JSON object)  [defensive]

   if errors.length > 0 → return { kind:'invalid', errors: [duplicates..., unresolved..., defensive...] }
                                             (НИ один patch не применён — all-or-nothing)

 APPLY-фаза (детерминированная, FR-009):
   result = []; dirty = Set<idl>
   for rule in extensions (в порядке файла):                   [каждый target ровно один раз гарантирован FR-005]
      if dirty.has(rule.target): continue                       [недостижимо после валидации; defensive]
      resource = index.get(rule.target)
      result.push({ kind: resource.kind, type: resource.type,
                    name: resource.name,
                    configuration: deepMerge(resource.configuration, rule.patch) })
      dirty.add(rule.target)
   for resource in resources:                                   [непосещённые idl и не-адресуемые — как были]
      if !dirty.has(idl(resource)): result.push(resource)       [нетаргетированные — по ссылке (research 6)]
   return { kind:'ok', resources: result }

loadExtensions(rootDir):                                        [Loader, FR-002/FR-003/FR-004]
   if !existsSync(.ycsf/extensions.yaml) → throw Error('missing .ycsf/extensions.yaml (EXT_MISSING_FILE)')
   text = readFileSync(...); parseExtensionsYaml(text, file)
   [parse: parseDocument(uniqueKeys:true) → EXT_INVALID (syntax/dup-keys)
          version !== 1 → EXT_VERSION (research 3)]
   [structure: extensions список; правило {target, patch}; target IDL-grammar; patch plain-object → EXT_INVALID]
   return { kind:'ok', data } | { kind:'invalid', errors: ALL }
```

## Validation Rules

| Stage | Entity | Rule | Code |
|-------|--------|------|------|
| load | file | `.ycsf/extensions.yaml` отсутствует при вызове `loadExtensions` | **throw** `Error` `EXT_MISSING_FILE` (FR-002) |
| load | file | YAML-синтаксис (parseDocument errors) | `EXT_INVALID` (line/column) (FR-004) |
| load | file | duplicate YAML-keys (uniqueKeys: true), в любом mapping в т.ч. вложенном в `patch` | `EXT_INVALID` (FR-004) |
| load | file | отсутствует или `version !== 1` | `EXT_VERSION` (FR-003) |
| load | file | неизвестный top-level ключ, кроме `version`/`extensions` | `EXT_INVALID` (research 7) |
| load | file | `extensions` отсутствует или не массив | `EXT_INVALID` (FR-004) |
| load | rule | элемент не mapping | `EXT_INVALID` (FR-004) |
| load | rule | правило с ключами ≠ {`target`,`patch`} (лишние/отсутствующие) | `EXT_INVALID` (FR-004) |
| load | target | не строка, либо нарушение IDL-грамматики (не два сегмента `[a-z][a-z0-9_]*`) | `EXT_INVALID` (FR-004/US7 AC3) |
| load | patch | не plain-object mapping (скаляр/list/null) | `EXT_INVALID` (FR-004/US7 AC3) |
| validate | index | два ресурса с одним IDL (нарушение инварианта 014) | `EXT_INVALID` defensive «duplicate IDL <idl> in generated model» |
| validate | rule | target объявлен >1 раза в файле | `EXT_DUPLICATE_TARGET` (FR-005; порядок появления) |
| validate | rule | target не совпадает ни с одним IDL (в т.ч. грамматически валидный, но несуществующий домен) | `EXT_UNRESOLVED_TARGET` (target + availableIdls алфавитно) (FR-007) |
| validate | resource | configuration таргетированного ресурса не plain-object | `EXT_INVALID` defensive (spec Edge Case) |
| apply | (любая ошибка validation) | ни один patch не применяется | all-or-nothing (FR-007/US3 AC2/US4 AC2) |
| apply | rule | apply в порядке файла; каждый target ровно один раз | FR-009 (гарант — FR-005) |
| apply | resource | kind/type/name сохраняются; меняется только configuration | FR-012 |
| apply | resource | массив в patch → replace; null/scalar → replace; новые ключи добавляются; non-mutating | FR-008/§25.2 |
| apply | value | `${...}` и `{{$ENV}}` строки байт-в-байт, без обработки/валидации | FR-010/FR-011 |

Кода `EXT_MERGE_ERROR` **нет** (осознанно): merge total на JSON-дереве (spec Error Codes).

## EXT_* Error Code Catalog

| Code | Когда | Stage | Диагностика несёт |
|------|-------|-------|-------------------|
| `EXT_MISSING_FILE` | `.ycsf/extensions.yaml` отсутствует при вызове `loadExtensions` (throw, паттерн `BRG_MISSING_FILE`) | Load | throw-`Error`, код в message |
| `EXT_VERSION` | отсутствует/не `1` `version` (Constitution III) | Load | file, field `version`, message |
| `EXT_INVALID` | структура (syntax/dup-keys/форма/грамматика/безопасные checks): YAML-ошибки, unknown keys, no/не-список `extensions`, правило не mapping, ключи правила, target не IDL-грамматика, patch не mapping; defensive: duplicate IDL в индексе, configuration таргетированного ресурса не object | Load + Validate | file/line/column/field (loader) или message (apply) |
| `EXT_UNRESOLVED_TARGET` | target не резолвится ни к одному generated resource (включая несуществующий домен); message = target + availableIdls алфавитно | Validate (applyExtensions / 020 check) | target, availableIdls |
| `EXT_DUPLICATE_TARGET` | один target объявлен >1 раза (fail-fast, Constitution V) | Validate (applyExtensions) | target |

Константы — в `src/contracts/extensions.ts`, сравниваются через константы (Constitution V); зеркало — `contracts/extensions.json`.

## Decisions (cross-ref research)

- Hardcoded C-owned `IDL_DOMAIN_BY_TF_TYPE` в `src/extensions/idl.ts`; аддитивный рост 019 — research 1.
- Deep merge: `isPlainObject`-guard на обоих значениях, иначе replace; non-mutating — research 2.
- Свой `parseExtensionsYaml` (паттерн 013), `diag()`-factory переиспользован — research 3.
- Дубликат target → `EXT_DUPLICATE_TARGET`, не sequential merge — research 4.
- Validate-first collect-all, all-or-nothing; duplicates по появлению, unresolved в порядке файла — research 5.
- `applyExtensions` immutable: новый массив, новые объекты таргетированных, ссылки — research 6.
- Unknown keys → `EXT_INVALID` — research 7.
- `patch` не mapping → `EXT_INVALID` — research 8.
- Типы + `EXT_*` в `src/contracts/extensions.ts` + `contracts/extensions.json`; runtime в `src/extensions/` — research 9.