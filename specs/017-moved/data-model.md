# Data Model: moved — `.ycsf/moved.yaml`, chain resolution, MOV_* диагностики, компиляция `TerraformMoved[]`

## Entities

### MoveEndpoint
Одна сторона миграции — пара логической идентичности и Terraform-адреса (spec Key Entities, §16 IDL/IDT).

```typescript
interface MoveEndpoint {
  readonly idl: string;  // двухсегментный [a-z][a-z0-9_]*.[a-z][a-z0-9_]* (domain.name)
  readonly idt: string;  // Terraform-адрес type.name: [a-zA-Z_][a-zA-Z0-9_]*.[a-zA-Z_][a-zA-Z0-9_]*
}
```

Инварианты:
- `idl` — ровно два сегмента `[a-z][a-z0-9_]*` (нижний регистр; подчёркивание допустимо; дефис нет). Нарушение → `MOV_INVALID`. (используется двухсегментная форма IDL по spec 015 / §16).
- `idt` — ровно два сегмента `type.name`, каждый `[a-zA-Z_][a-zA-Z0-9_]*` (pattern spec 014 `MTL_INVALID_TERRAFORM_ADDRESS`). Нарушение → `MOV_INVALID`. Формы с индексом (`x[0]`, `x["k"]`) не в scope.

### MoveEntry
Одна запись миграции в `.ycsf/moved.yaml` (spec Key Entities).

```typescript
interface MoveEntry {
  readonly from: MoveEndpoint;
  readonly to: MoveEndpoint;
}
```

Инварианты:
- `from` и `to` — mapping точно с ключами `idl`/`idt`; лишние/отсутствующие ключи, не-строки, нарушение грамматики → `MOV_INVALID`.
- `from` полностью == `to` (no-op move) → `MOV_INVALID` (FR-004).
- Смена Terraform resource type (первый сегмент `from.idt` ≠ первый сегмент `to.idt`) → `MOV_TYPE_CHANGE` (FR-005; fail-fast, NOT safe rename).
- Полный дубликат (одинаковые from и to) → `MOV_DUPLICATE` (FR-007).
- Одинаковый `from` при разном `to`, или одинаковый `to` при разном `from` → `MOV_CONTRADICTORY` (FR-006; same-to-same-from только через MOV_DUPLICATE).

### MovesYaml
Содержимое `.ycsf/moved.yaml` (Constitution III — `version: 1`).

```typescript
interface MovesYaml {
  readonly version: 1;
  readonly moves: readonly MoveEntry[];
}
```

Инварианты:
- `version` обязателен и равен `1`; иначе `MOV_VERSION` (Loader; short-circuit single).
- Ровно два top-level ключа: `version`, `moves`; неизвестный ключ → `MOV_INVALID` (Constitution V, research 7 паттерн 015).
- `moves` обязателен и является списком; отсутствие/иной тип → `MOV_INVALID` (FR-004).
- Каждый элемент — mapping ровно с ключами `from`/`to`; лишние/отсутствующие → `MOV_INVALID`.
- Duplicate YAML-keys в любом mapping (включая вложенные `from`/`to` — `{idl: X, idl: Y}`) → `MOV_INVALID` (parse-gate `uniqueKeys`).
- `moves: []` — валидно (нет миграций → `moved === []`).
- Файл отсутствует → НЕ ошибка: loader возвращает `{version: 1, moves: []}` (FR-002; файл optional по IDEA §35; `EXT_MISSING_FILE`-аналога нет сознательно).

### Chain
Максимальная последовательность миграций с `prev.to === next.from` (обе компоненты, FR-009), плюс состояние по отношению к `currentResources`.

```typescript
interface Chain {
  readonly entries: readonly MoveEntry[];   // хронологически: самый старый первый
  readonly terminal: MoveEndpoint;          // to последнего entry
  readonly start: MoveEndpoint;             // from первого entry (стартовый узел, indegree 0)
  readonly current?: MoveEndpoint;          // заполняется если live (терминал == current из currentResources)
}
```

Инварианты:
- Каждая цепочка — максимальный walk от узла без входящего ребра до узла без исходящего (degree≤1 после validation; research 2).
- **Живая (live)** — если terminal совпадает с парой `{idl, idt}` одного из `currentResources` (точное совпадение, FR-010). Тогда `current` = этот resource.
- Набор цепочек детерминирован: один и тот же набор записей → один и тот же набор цепочек независимо от порядка записей в файле (FR-016).
- Канонический порядок цепочек для compiled `moved`: по `start.idl`, затем `start.idt` (weak reverse-chronological; не зависит от file order). Диагностический порядок chain-level ошибок — по первому появлению entry цепочки в файле (spec Edge Cases).

### CurrentResources
Вход `readonly MoveEndpoint[]` — текущее логическое отображение из current project model (spec Key Entities). Явная истина для `to`; строится оркестратором 021 из dispatch 014 (IDL по соглашению `domain.name`, IDT из `TerraformResource{type,name}`). `moved.yaml` — только история (IDEA §35).

### TerraformMoved
`{ kind: 'moved'; from: string; to: string }` — contract 002 (`packages/pilot/src/contracts/terraform.ts`). Переиспользуется как есть; НЕ переопределяется (FR-015). Выход компиляции: `readonly TerraformMoved[]`.

### MovesDiagnostic
Диагностика load/validation ценой `buildMoves` (spec Key Entities).

```typescript
interface MovesDiagnostic {
  readonly code: string;                     // MOV_* (constants, Constitution V)
  readonly message: string;
  readonly entry?: number;                   // 0-based индекс записи в moves (для пер-entry ошибок)
  readonly endpoint?: MoveEndpoint;          // проблемный endpoint (для grammar/no-op/др.)
  readonly field?: string;                   // 'from.idl' | 'from.idt' | 'to.idl' | 'to.idt' | 'moves' | 'version'
  readonly file?: string;                    // заполняется loader-ом (структурные)
  readonly line?: number;
  readonly column?: number;
  readonly available?: readonly string[];    // MOV_TARGET_UNRESOLVED: доступные текущие идентичности (алфавитно)
}
```

Структурные диагностики loader-а (`MOV_VERSION`/`MOV_INVALID`) переиспользуют `ProjectModelDiagnostic` из 011 (`src/model/errors.ts` `diag`): file/line/column/field — сообщения как в регистре-паттерне. Семантические (`MOV_DUPLICATE`/`MOV_TYPE_CHANGE`/`MOV_CONTRADICTORY`/`MOV_CYCLE`/`MOV_TARGET_UNRESOLVED`/`MOV_DANGLING`) — `MovesDiagnostic` (entry/endpoint/available; без file — чистый transform файла не знает).

### MovesLoadResult / BuildMovesResult
Результаты loader-а и чистого transform (spec FR-015/017 API).

```typescript
type MovesLoadResult =
  | { readonly kind: 'ok'; readonly data: MovesYaml }
  | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] };   // collect-all (FR-004)

type BuildMovesResult =
  | { readonly kind: 'ok'; readonly moved: readonly TerraformMoved[] }
  | { readonly kind: 'invalid'; readonly errors: readonly MovesDiagnostic[] };
```

Инварианты:
- `buildMoves` invalid атомарен: при любой ошибке validation **ни один `moved` не компилируется** (all-or-nothing, FR-013/US4 AC2/US6 AC2).
- `buildMoves` — чистый transform без I/O (FR-014); входы `readonly`, не мутируются; выход — новый массив объектов.
- `loadMoves` без файла → `kind:'ok'`, `data.moves === []` (FR-002; отсутствие файла — валидное состояние).

### GeneratedTfFile (reused, 014)
`{ filename, content }` — результат `buildMovedFile(moved)`: `filename = 'moved.ycsf.tf.json'`, `content = serializeJson({ moved: [...] })` (sorted keys). `null` при пустом `moved`. Fileset/ownership/cleanup — существующий `writeGeneratedTerraform` (014), без правок.

## Relationships

```
.ycsf/moved.yaml (версионированный .ycsf-контракт, III; optional, FR-002)
 └── MovesYaml {version:1, moves[]}
      └── MoveEntry {from, to} ──(pair)──► MoveEndpoint {idl, idt}
            ├── validation (load): grammar/no-op/структура → MOV_INVALID; version → MOV_VERSION
            ├── validation (buildMoves): type-change → MOV_TYPE_CHANGE
            │                               duplicate     → MOV_DUPLICATE
            │                               contradiction → MOV_CONTRADICTORY
            └── chain building (FR-009): prev.to === next.from (полная пара)
                  ├── cycle (a→b, b→a) → MOV_CYCLE
                  └── terminal lookup в currentResources (exact pair, FR-010)
                        ├── live  → compile: {from: исторический адрес, to: current.idt}
                        └── dead  → MOV_TARGET_UNRESOLVED (терминал) + MOV_DANGLING (каждый entry)

currentResources (из dispatch 014; вход buildMoves, строит 021)
 └── Map<{idl,idt}, endpoint>; unique by construction (resource.name unique per type 014)
      └── терминал live-цепочки === ровно одна текущая пара (1:1 гарантирован MOV_CONTRADICTORY)

compiled TerraformMoved[] → buildMovedFile → GeneratedTfFile(moved.ycsf.tf.json)
 └── serializeJson (014, sorted keys; unchanged) → содержимое `{"moved": [...]}`
 └── writeGeneratedTerraform (014, unchanged) — запись + stale cleanup `*.ycsf.tf.json`
```

- Contract 002 (`TerraformMoved`), dispatch/serialize (014), write (014) **не изменяются**. 017 — аддитивный чистый transform + loader + validation.
- Врезка «dispatch → buildMoves → buildMovedFile → append» и решение вызывать `loadMoves` — оркестрация 021 (вне scope). Seam для 020 check: `loadMoves` + `buildMoves` композиция = встроенная validation-функция.

## Load Flow (State Transitions)

```
loadMoves(rootDir):                                          [Loader, FR-001/002/003/004]
   if !existsSync(.ycsf/moved.yaml) → { kind:'ok', data: {version:1, moves:[]} }   [FR-002]
   text = readFileSync(...)      [любая не-ENOENT ошибка fs → rethrow: catastrophic I/O]
   parseMovesYaml(text, '.ycsf/moved.yaml'):
     [parse: parseDocument(uniqueKeys:true) → MOV_INVALID (syntax/dup-keys, line/column)]
     [version: !== 1 → MOV_VERSION (short-circuit, single) ]
     [structure (collect-all):
        top-level keys == {version, moves} → иначе MOV_INVALID
        moves массив → иначе MOV_INVALID
        каждый элемент mapping {from,to} → иначе MOV_INVALID per element
        from/to mapping {idl,idt}; idl/idt строки + grammar → MOV_INVALID per element
        from === to (no-op) → MOV_INVALID per element]
   return { kind:'ok', data } | { kind:'invalid', errors: ALL }
```

## BuildMoves Flow (State Transitions)

```
buildMoves(currentResources, moves):
   assert: moves это parsed MovesYaml (массив moves, version===1) — иначе throw (defensive, Constitution V)

 VALIDATION-фаза (collect-all, all-or-nothing; research 5/2/3):
   # 1. пер-entry (file order):
   for entry i in moves:
     if grammar(idl/idt) нарушена → MOV_INVALID(entry i, field)          [defensive: loader уже проверил]
     elif from === to полностью → MOV_INVALID(entry i, no-op)
     elif type-change (from.idt.type ≠ to.idt.type) → MOV_TYPE_CHANGE(entry i)
   # 2. cross-entry (file order; first-wins maps):
   for entry i in moves:
     if seenFrom has entry.from с другим entry.to → MOV_CONTRADICTORY(entry i)   [FR-006a]
     if seenTo has entry.to с другим entry.from → MOV_CONTRADICTORY(entry i)      [FR-006b]
     if (from, to) целиком уже видели → MOV_DUPLICATE(entry i)                    [FR-007]
     else: seenFrom/seenTo/seenBoth обновляются
   # 3. chains + cycles (research 2), на first-wins графе:
   outEdge/inEdge из moves (first-wins token если validation уже ошибся)
   старты = узлы в outEdge без inEdge (порядок: по первому появлению entry в файле)
   walk от каждого старта → цепочки (хронологически)
   циклы = узлы с outEdge, не посещённые: walk по outEdge, возврат в стек → MOV_CYCLE (один на цикл)
   # 4. terminal resolution (research 3):
   currentIndex = Map<endpointKey, endpoint> (first-wins при дегенеративном дубликате входа)
   for цепочка (диагностический порядок: по первому появлению entry в файле):
     if terminal не в currentIndex:
        for entry in цепочка: MOV_DANGLING(entry)                        [FR-010b]
        MOV_TARGET_UNRESOLVED(terminal + available: current идентичности алфавитно) [FR-010a]

   if errors.length > 0 → { kind:'invalid', errors: [пер-entry..., cross-entry..., cycle..., target...] }
                            (НИ один moved не компилирован — all-or-nothing, FR-013)

 COMPILE-фаза (детерминированная, только live-цепочки; research 2/4; FR-012/016):
   цепочки упорядочены по (start.idl, start.idt)
   for цепочка live:
     nodes = [n0=from(первый), n1=to(первый)=from(второй), ..., nk=terminal]
     prevIdt = undefined
     for i in 0..k-1:                                        [исторические адреса, кроме терминала]
        a = nodes[i].idt
        if a === prevIdt: continue                            [идл-only: адрес не менялся → skip]
        prevIdt = a
        if a === current.idt: continue                        [терминальный/текущий адрес → skip, FR-012]
        moved.push({ kind:'moved', from: a, to: current.idt }) [to = ТЕКУЩИЙ адрес из currentResources]
   return { kind:'ok', moved }
```

Порядок диагностик (spec Edge Cases): (1) пер-entry в порядке файла, (2) cross-entry в порядке файла, (3) cycle/chain-level в порядке появления entry цепочки в файле. Порядок `moved` — канонический (research 2/4), НЕ порядок файла (FR-016).

## Validation Rules

| Stage | Entity | Rule | Code |
|-------|--------|------|------|
| load | file | отсутствует `.ycsf/moved.yaml` при `loadMoves` | `ok` с `moves: []` (FR-002) |
| load | file | YAML-синтаксис / duplicate keys (uniqueKeys) в любом mapping (в т.ч. вложенном `from`/`to`) | `MOV_INVALID` (line/column) (FR-004) |
| load | file | отсутствует или `version !== 1` | `MOV_VERSION` (FR-003) |
| load | file | неизвестный top-level ключ, кроме `version`/`moves` | `MOV_INVALID` (research 6, Constitution V) |
| load | file | `moves` отсутствует или не массив | `MOV_INVALID` (FR-004) |
| load | entry | element не mapping | `MOV_INVALID` (FR-004) |
| load | entry | ключи ≠ {`from`,`to`} (лишние/отсутствующие) | `MOV_INVALID` (FR-004) |
| load | from/to | не mapping | `MOV_INVALID` (FR-004) |
| load | idl | не строка / не два сегмента `[a-z][a-z0-9_]*` | `MOV_INVALID` (FR-004) |
| load | idt | не строка / не два сегмента `[a-zA-Z_][a-zA-Z0-9_]*` | `MOV_INVALID` (FR-004/014 pattern) |
| load | entry | `from` полностью == `to` (no-op) | `MOV_INVALID` (FR-004/US8 AC4) |
| validate | entry | первый сегмент `from.idt` ≠ первому сегменту `to.idt` (type-change) | `MOV_TYPE_CHANGE` (FR-005/US4) |
| validate | entry | полный дубликат (одинаковые from+to) | `MOV_DUPLICATE` (FR-007/Edge Cases) |
| validate | entry | одинаковый `from` при разном `to` (или `to` при разном `from`) | `MOV_CONTRADICTORY` (FR-006/US5) |
| validate | chain | цикл в графе (`a→b`, `b→a`) | `MOV_CYCLE` (FR-008/Edge Cases) |
| validate | chain | терминал не совпадает ни с одним current ресурсом (exact pair) | `MOV_TARGET_UNRESOLVED` (терминал + available алфавитно) (FR-010/US6) |
| validate | entry | entry цепочки с неразрешённым терминалом | `MOV_DANGLING` (FR-010/US6) |
| compile | (любая ошибка validation) | ни один moved не компилируется | all-or-nothing (FR-013) |
| compile | chain | только live-цепочки; `from` = исторический адрес, `to` = current.idt; хронологический порядок | FR-012 |
| compile | address | адрес, равный терминальному/текущему, или idl-only (смежные одинаковые адреса) → нет блока | FR-011/FR-012 |

Кода для «успешного no-op idl-only» нет (валидный `kind:'ok'`, `moved === []`); кода для missing-file нет (`ok` с `moves: []`) — spec Error Codes.

## MOV_* Error Code Catalog

| Code | Когда | Stage | Диагностика несёт |
|------|-------|-------|-------------------|
| `MOV_VERSION` | отсутствует/не `1` `version` (Constitution III) | Load | file, field `version`, message |
| `MOV_INVALID` | структура (syntax/dup-keys/форма/грамматика/no-op) | Load + Validate | file/line/column/field (loader) или entry/endpoint/field (buildMoves) |
| `MOV_DUPLICATE` | полный дубликат миграции (одинаковые from и to) | Validate | entry |
| `MOV_TYPE_CHANGE` | смена Terraform resource type между `from.idt` и `to.idt` (не безопасный rename; fail-fast) | Validate | entry |
| `MOV_CONTRADICTORY` | одинаковый `from` при разном `to`, или одинаковый `to` при разном `from` (collision, нет silent merge) | Validate | entry |
| `MOV_CYCLE` | цикл в графе миграций (`a→b`, `b→a`) | Validate (chain) | адреса цикла (message), опционально entry первого включения |
| `MOV_TARGET_UNRESOLVED` | терминал цепочки не соответствует ни одному current resource | Validate (buildMoves / 020 check) | endpoint-терминал + available (current идентичности, алфавитно) |
| `MOV_DANGLING` | entry цепочки, чей терминал не current (история «висит») | Validate (buildMoves) | entry |

Константы — в `src/contracts/moves.ts` (Constitution V); зеркало — `contracts/moves.json` (`#/errorCodes`).

## Decisions (cross-ref research)

- `.tf.json` shape: `{"moved":[...]}` (массив объектов `{from,to}`, адреса — строки); serializeJson 014 без изменений — research 1.
- Chain-алгоритм: outEdge/inEdge degree≤1 walk от indegree-0 стартов; циклы = компоненты без старта → один MOV_CYCLE на цикл; порядок `moved` канонический (start.idl/start.idt), диагностик — file order — research 2.
- Terminal resolution: exact-pair Map; MOV_TARGET_UNRESOLVED на терминале + MOV_DANGLING на каждом entry; «два цепи → один current» = contradiction (same to), отдельный код не нужен — research 3.
- idl-only и `moved`: эмиссия по дистинктным историческим адресам (дедуп смежных), `to` = current.idt всегда — research 4.
- Границы: `buildMoves` чистый; wrapper `buildMovedFile` (serializeJson 014, filename `moved.ycsf.tf.json`, null при пустом); fs только в loader, yaml только в parse-gate; call-site 021 — research 5.
- Layout: `src/moves/{moves-yaml,loader,validate,chain,build,errors,index}.ts` + `src/contracts/moves.ts` zero-dep; package.json/tsup unchanged — research 6.