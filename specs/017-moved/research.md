# Research: moved — `.ycsf/moved.yaml`, Terraform `moved` blocks

## Decisions & Rationale

### 1. Terraform JSON-синтаксис для `moved`-блоков: `{"moved": [...]}` с from/to как строками

**Decision**: Emitted `.tf.json` имеет единственный top-level блок `moved` — JSON-массив объектов `{ "from": "<addr>", "to": "<addr>" }`, где оба значения — **строки** (квотированные адреса). Компактная single-object форма `{"moved": {"from": ..., "to": ...}}` допустима в Terraform, но we emit array-форму всегда (general form, как рекомендует HashiCorp при систематической генерации). Serialization — существующий `serializeJson` из 014 (sorted keys), **без изменений serialize 014**.

```json
{
  "moved": [
    { "from": "yandex_function.users", "to": "yandex_function.accounts" },
    { "from": "yandex_function.user_service", "to": "yandex_function.accounts" }
  ]
}
```

**Rationale**:
- HashiCorp JSON Configuration Syntax (`terraform/language/syntax/json`): each top-level object property is a top-level block type. `moved` — block type **без лейблов**, multiple blocks allowed → массив элементов. Внутри каждого элемента `from`/`to` — **references/addresses**; в JSON-синтаксисе expressions-based values, являющиеся references, сериализуются как **строки без окружающих кавычек-символов** (то же правило, что `provider`/`depends_on` meta-arguments в `resource`/`data`, и `type` в `connection`) — строка интерпретируется буквально, не как string template (special mapping). Нативный `moved { from = x; to = y }` с unquoted-адресами в JSON становится `{"from": "x", "to": "y"}`.
- `from` и `to` отличаются от выражений (`${...}`) — это адреса (ReferencedAddress), поэтому JSON-строка трактуется literally. Проверено по `terraform/language/block/moved`: аргументы `from`/`to` имеют тип `reference`/`string`.
- Sorted keys: `"from" < "to"` лексикографически → существующий `serializeJson` (recursive sorted-key replacer, 014) производит `{"from": ..., "to": ...}` автоматически, byte-identical между запусками (SC-001).
- **Per-module constraint**: `moved`-блоки живут в том модуле, к ресурсам которого относятся (root module для generated resources). Адреса в `moved` могут ссылаться на child modules (`module.foo.aws_instance.x`), но наш scope — root-module `type.name` (currentResources из dispatch 014 — top-level resources). Никаких ограничений "moved только в своём собственном модуле другого вида" для нашего случая нет. Поскольку generated `.tf.json` лежат все в одном `infraDir` (module directory), один файл `moved.ycsf.tf.json` с корневыми адресами — корректная позиция.
- **Terraform-side conflict**: если `from`-адрес всё ещё объявлен в конфигурации (совпадает с текущим ресурсом другого app), Terraform на этапе `terraform plan`/`validate` сообщает ambiguity — это зона deep-Terraform-валидации (Constitution IV), не MOV_* код 017 (кодов закрытый список). Данное пересечение «исторический адрес == current адрес другого ресурса» документировано как open seam (см. plan.md Risks); 017 не добавляет код для него (не нарушаем спек Error Codes).

**Alternatives Considered**:
- Компактная single-object форма `{"moved": {"from": ..., "to": ...}}` при единственном блоке: отвергнуто — унифицированный array-выход проще тестировать и детерминированно сравнивать; HashiCorp рекомендует general (array) form при систематической конвертации.
- Собственная сериализация в 017 (свой JSON-writer или заголовок с version): отвергнуто spec (частный Scope: «017 не вводит собственную сериализацию», «не меняет serialize 014»). Вместо этого тонкий wrapper `buildMovedFile`, вызывающий существующий `serializeJson` из `src/materialize/serialize.ts` без правок последнего.
- Эмиттить `moved` в per-app файл каждого ресурса: отвергнуто — `moved`-цепочки пересекают app-границы (история `user_service` + `accounts` в одной цепочке); отдельный модульный файл чище и симметричен `00-ycsf-outputs.tf.json`.

### 2. Алгоритм построения цепочек: граф предшествования с ≤1 входящим и ≤1 исходящим ребром на узел

**Decision**: Цепочки строятся на детерминированном графе, индуцированном записями `moves`:
- ключ узла = пара `{idl, idt}` (serialized, напр. `${idl}\u0000${idt}` или JSON);
- `outEdge: Map<key, MoveEntry>` (по `from`), `inEdge: Map<key, MoveEntry>` (по `to`);
- после фазы validation (grammar/no-op/type-change/duplicate/contradiction) каждый узел имеет **≤1 исходящее** (одинаковый `from` запрещён — MOV_CONTRADICTORY/MOV_DUPLICATE) и **≤1 входящее** ребро (одинаковый `to` запрещён);
- **Chain**: от каждого стартового узла (`from`, не имеющий входящего ребра) обход по `outEdge` до узла без исходящего. Это максимальная последовательность с `prev.to === next.from` (точное совпадение пары — FR-009).
- **MOV_CYCLE**: циклы — компоненты, не достижимые из стартовых узлов (все узлы цикла имеют входящее ребро). Детект: узел с исходящим ребром, не посещённый обходами от стартов, идём по `outEdge`; возврат в уже посещённый узел текущего обхода = цикл. Одно `MOV_CYCLE` на цикл (составлен из адресов цикла), не на entry.
- **Порядки**:
  - *диагностики* — по spec Edge Cases: пер-entry ошибки в порядке файла (структурные/валидные), затем chain-level в порядке первого появления entry цепочки в файле (для циклов — по первому появлению узла);
  - *compiled `moved`* — FR-016/US9 AC4: порядок **не зависит от порядка записей файла**. Канонический ключ цепочки = стартовый (самый старый) узел: `start.idl` лексикографически, затем `start.idt`; внутри цепочки — хронологически (старый адрес раньше, FR-012/US3 AC1). Вход-детерминирован: один и тот же набор цепочек → один и тот же порядок вывода, независимо от file order.

**Rationale**:
- FR-006/FR-007 (contradiction/duplicate) дают нам `indexed` граф с degree≤1 — цепочки строятся тривиальным walk, а циклы — это в точности компоненты без стартового узла. Это делает комбинаторику детейрминированной и простой.
- Диагностический порядок (file order) и выходной порядок `moved` (canonical по старту) — **разные** порядке: Edge Cases фиксируют порядок диагностик, FR-016/US9 AC4 фиксируют независимость `moved` от порядка записей. Их смешение было бы ошибкой (порядок `moved` по file-order ломал бы FR-016).
- Fallback для contradictions: если validation уже нашёл ошибки, граф строится по first-wins map (первое вхождение `from`/`to` побеждает), чтобы chain-level ошибки (MOV_CYCLE/MOV_TARGET_UNRESOLVED/MOV_DANGLING) тоже собирались детерминированно (collect-all, всё равно результат invalid). Это не влияет на compiled output (при любых ошибках all-or-nothing → `moved` не компилируется).
- Неполная история (US3 AC3): пропущенный промежуточный шаг → цепочка просто короче; это не ошибка (ошибка только неразрешимый терминал).

**Alternatives Considered**:
- Chain building по «жадному последовательному слиянию» (merge entries в порядке файла): отвергнуто — результат слипался бы с порядком записей, нарушая FR-016; property-based обход с degree≤1 честнее.
- Рекурсивный DFS с поиском в глубину без явных стартов: отвергнуто — циклы и пути неразличимы без понятия "стартового узла"; явный walk от indegree-0-узлов даёт максимальные цепочки by construction.
- Использовать только `idt` (без idl) как ключ узла: отвергнуто spec Assumption — связывание по **обеим** компонентам пары `{idl, idt}` (в момент времени resource имеет ровно одну идентичность; частичное совпадение — неточность истории). Ключ узла = полная пара.

### 3. Терминал/current resolution: exact pair-match; single + dangling; два цепочек к одному current — невозможно по contradiction

**Decision**: `currentResources` индексируются в `Map<endpointKey, currentEndpoint>` (exact pair `{idl, idt}`). Для каждой цепочки:
- терминал (`to` последнего entry) ищется в Map по точному совпадению пары (FR-010);
- совпадение → цепочка **live**, её current-ресурс даёт `to` для всех компилируемых `moved`;
- НЕ совпадение → **одно** `MOV_TARGET_UNRESOLVED` (message: терминал + доступные текущие идентичности, алфавитно) **и по одному** `MOV_DANGLING` на каждый entry этой цепочки (US6 AC2: N+1 диагностик для N-entry цепочки);
- **first-wins / duplicates в currentResources**: guard подразумевается инвариантом dispatch 014 (уникальный `resource.name` внутри типа → уникальный `type.name` → уникальный idt; idl = domain.name уникален). Если вход всё же содержит дубликат пары — детерминированный Map first-wins (не печатаем новый MOV_* код: список кодов закрыт spec). Дубликат в current — зона проекции 014/021 (open seam).
- **Один current-identity заявлен двумя цепочками → contradiction**: невозможно. Совпадение терминала цепочки с current-парой означает identical `to` endpoint двух entries с разными `from` → `MOV_CONTRADICTORY` уже на фазе validation (same to, different from, FR-006b). Дополнительная проверка не нужна — contradiction detection **гарантирует** 1:1 «текущая идентичность ↔ живая цепочка».

**Rationale**:
- FR-010 точно задаёт правило совпадения — пара целиком, а не компонентно (spec Assumption: частичное совпадение = несоответствие). Terminal match по exact pair защищает от ложных «переименований» при совпадении только idl или только idt.
- Разделение `MOV_TARGET_UNRESOLVED` (терминал) и `MOV_DANGLING` (каждый entry цепочки) даёт usable диагностику для 020 check/021: пользователь видит и «куда не дошло», и «вся история висит» (spec Assumption).
- Вывод «two chains → один current» сам по себе является следствием contradiction-check (same `to`) — это демонстрирует достаточность фазы validation и не добавляет новый код.

**Alternatives Considered**:
- Строить индекс по одному idt (без idl): отвергнуто — семантика `to`-эмиссии требует exact-pair текущей идентичности; частичный match был бы silent magic (Constitution V).
- Проверять только терминалы, не «достаточность» currentResources (что любая current-пара покрыта цепочкой): отвергнуто — `moved` нужен только для migrated resources; current-пара без истории — обычный (не переименованный) ресурс, не ошибка.
- Treat unresolved terminal как warning + skip: отвергнуто FR-010/US6 (ошибка, not silent skip).

### 4. Семантика idl-only шагов и правильная эмиссия `moved` внутри цепочки

**Decision**: `moved`-блок эмитится по **адресам** (idt), а не по entry:
- Пусть узлы цепочки `n0..nk` (n0 = from(первого), nk = terminal). Исторические адреса — значения `n0.idt .. n(k-1).idt`.
- Эмитится `{from: a, to: current.idt}` для каждого **дистинктного** исторического адреса `a`, где `a !== current.idt` (терминальный адрес == current → skip; FR-012 «кроме терминала, равного текущему»). Смежные одинаковые адреса (идл-only шаг: `to.idt === from.idt`) дедуплицируются.
- `to` **каждого** emitted `moved` = текущий адрес из currentResources (не stepwise адрес из истории!). Наблюдаемый инвариант для 021 (spec Scope).
- Одиночная idl-only миграция: адрес не менялся → дистинктный исторический адрес == current → `moved === []` (US7 AC1/FR-011).
- Цепочка с idl-only шагом внутри: idl-only шаг не добавляет нового адреса (последовательность адресов смежна-одинакова) → мoved эмитится только для реально сменившихся адресов (US7 AC2: `users→accounts` (идл-only, адрес X), `accounts→reports` (X→Y), current `reports/Y` → один блок `{from: X, to: Y}`).

Проверка на US3 (all адреса меняются): `users→user_service→accounts`, current `accounts` → адреса `yandex_function.users`, `yandex_function.user_service` (оба ≠ current) → два блока, оба с `to = yandex_function.accounts`, в хронологическом порядке. ✓

**Rationale**:
- Почему address-based, а не entry-based: FR-012 говорит «для каждого исторического Terraform-адреса», а история адресов — это последовательность значений `idt` вдоль цепочки, где idl-only шаг не создаёт нового значения. Подсчёт по entry дал бы ложный no-op блок (`{from: X, to: X}`) именно при том условии, что FR-011 запрещает.
- Смежные дубликаты дедуплицируются одним правилом (skip `n_i.idt === n_{i-1}.idt` при i>0), без отдельного сета — в clean-графе (degree≤1, без циклов/contradiction) одинаковый адрес в цепочке возможен только смежно (идл-only).
- `to = current.idt` из currentResources, а не из истории: это гарантирует, что emitted `moved` всегда «доезжает» до текущего состояния (FR-012/US2 AC2), что и есть цель `moved`-семантики Terraform.

**Alternatives Considered**:
- Эмиттить блок на каждый entry (включая idl-only): отвергнуто — давал бы `{from:X,to:X}` no-op (FR-011 прямо запрещает).
- Эмиттить `to` = stepwise адрес: отвергнуто — чуть-чуть «правильного» выглядит для промежуточных шагов, но ломает инвариант «все блоки доезжают до current» и US3 AC1 (два блока с одинаковым to=current).
- Отдельный код ошибки для idl-only no-op: отвергнуто — idl-only валиден и полезен для цепочек (Constitution VI); это валидный результат `kind:'ok'`, `moved === []`, не ошибка (spec Error Codes: «кода для успешного no-op idl-only нет»).

### 5. Границы чистого transform: `buildMoves` + `buildMovedFile`; fs только в loader, yaml только в parse-gate

**Decision**:
- `buildMoves(currentResources: readonly MoveEndpoint[], moves: MovesYaml): BuildMovesResult` — **чистая функция без I/O** (FR-014): validate (collect-all, all-or-nothing) → chain/cycle → terminal resolution → compile. `TerraformMoved` из contract 002 (не переопределяется).
- Выход `TerraformMoved[]` → `.tf.json` делается **тонким wrapper-ом `buildMovedFile(moved: readonly TerraformMoved[]): GeneratedTfFile | null`** в `src/moves/build.ts`:
  - использует существующий `serializeJson` из `src/materialize/serialize.ts` (sorted keys) и тип `GeneratedTfFile` из contracts;
  - filename `moved.ycsf.tf.json` (собственность C, matches glob `*.ycsf.tf.json` в `write.ts` 014 — свежий stale-cleanup работает без правок);
  - `null` при `moved.length === 0` — файл не пишется (симметрия с outputs: файл генерируется только если есть содержимое; stale-cleanup 014 сам удалит старый файл при последующем пустом прогоне);
  - **не валидирует адреса повторно**: grammar уже проверен (MOV_INVALID) на фазах loader/buildMoves, а currentResources.idt прошли MTL_INVALID_TERRAFORM_ADDRESS в dispatch 014.
- `src/materialize/serialize.ts` **не изменяется** (spec Assumption): wrapper вызывает `serializeJson` как есть. Зона «dispatch → buildMoves → buildMovedFile → append к files → writeGeneratedTerraform» — оркестрация 021.
- Loader `loadMoves(rootDir)` — единственный модуль с fs (`existsSync`/`readFileSync`, ENOENT → ok с `moves: []`); `yaml` (parseDocument) — только в `src/moves/moves-yaml.ts`; contracts (`.ts`) — zero-dep (`zero-dependency.test.ts`).

**Rationale**:
- Spec Scope предельно конкретен: 017 «не вводит собственную сериализацию» и «не меняет serialize 014». Единственный механизм, удовлетворяющий обоим — wrapper, который делегирует существующему `serializeJson`. Placement wrapper-а в `src/moves/` (а не добавление функции в `serialize.ts`) буквально не трогает файлы 014.
- `GeneratedTfFile | null` (empty) — детерминизм и чистота: пустые moves не порождают пустой файл; переиспользуемый `writeGeneratedTerraform` 014 уже умеет удалять stale `*.ycsf.tf.json`.
- Loader-паттерн копирует 015/013: parse-gate (parseDocument+uniqueKeys) в своём модуле с MOV-кодами, fs в loader, contracts zero-dep, error-factory (mov/diag).
- Все входы/выходы не мутируются (readonly); `buildMoves` возвращает новые объекты (immutability, FR-014/US6-детерминизм повторных вызовов).

**Alternatives Considered**:
- Добавить `serializeMoved` в `src/materialize/serialize.ts` (рэножимый генерализованный serializer): отвергнуто — «017 не меняет serialize 014» (и по духу: 014 serializer остаётся untouched; 021 использует wrapper).
- `buildMoves` сам возвращает `GeneratedTfFile` (Content-строку): отвергнуто — BuildMovesResult по spec возвращает `TerraformMoved[]` (форма для 020 check и 021); сериализация — отдельная забота wrapper-а.
- Файл всегда (даже при `moved: []`): отвергнуто — `{"moved": []}` шум; несовместимо с «optional и тихий» (US9).

### 6. Layout исходников: `src/moves/` + `src/contracts/moves.ts`; package.json/tsup.config.ts без изменений

**Decision**:
```text
packages/pilot/
├── package.json                     # UNCHANGED (yaml уже зависимость; новых пакетов нет)
├── tsup.config.ts                   # UNCHANGED (index + contracts entries уже эмитятся)
└── src/
    ├── index.ts                     # UPDATE: export loadMoves, buildMoves, buildMovedFile
    ├── contracts/
    │   ├── moves.ts                 # NEW: type-only + MOV_* constants (zero-dep; зеркало contracts/moves.json)
    │   └── index.ts                 # UPDATE: re-export moves contracts
    └── moves/                       # NEW: runtime (loader + parse-gate + validate + chain + resolve + build)
        ├── moves-yaml.ts            #   parseMovesYaml: parseDocument(uniqueKeys:true) + version short-circuit + structure (POST-MOV; diag)
        ├── loader.ts                #   loadMoves: existsSync/readFileSync; ENOENT → ok {version:1, moves:[]}
        ├── validate.ts              #   пер-entry validation: grammar(IVALID)/no-op/TYPE_CHANGE/DUPLICATE/CONTRADICTORY (collect-all)
        ├── chain.ts                 #   outEdge/inEdge, стартовые узлы, walk → цепи; MOV_CYCLE; terminal lookup → live/dangling+unresolved
        ├── build.ts                 #   buildMoves: validate → chain/resolve → compile TerraformMoved[]; + buildMovedFile wrapper (serializeJson 014)
        ├── errors.ts                #   mov() factory (MovesDiagnostic) + re-export diag для loader
        └── index.ts                 #   внутренний barrel: loadMoves, buildMoves, buildMovedFile
```
- Tests: `packages/pilot/test/unit/moves-yaml.spec.ts`, `test/unit/validate.spec.ts`, `test/unit/chain.spec.ts`, `test/unit/build-moves.spec.ts`, `test/moves/quickstart.spec.ts` (интеграционные сценарии) + fixture helpers `test/helpers/moves-fixtures.ts` (по образцу `extensions-fixtures.ts`/`materialize-fixtures.ts`); loader I/O — `mkdtemp` (temp-project helper).
- Types + MOV_* в `src/contracts/moves.ts`, зеркало — `contracts/moves.json`; runtime API из `src/index.ts` (паттерн loadExtensions/applyExtensions/loadProjectModel).

**Rationale**:
- Модуль `src/moves/` изолирует новый runtime-слой по образцу `src/extensions/` (015), `src/materialize/` (014): parse-gate и loader отдельно от чистого transform, contracts zero-dep, error-factory отдельно.
- contracts/moves.ts — type-only + pure constants: единственная точка публичного API для 020/021/плагинов; I/O и yaml никогда в contracts.

**Alternatives Considered**:
- Разместить parse-gate в `src/model/parse.ts` (обобщить parseYaml): отвергнуто — parseYaml хардкодит PML_* коды и ProjectModelDiagnostic (то же обоснование, что research 3 в 015).
- Всё в одном `src/moves.ts`: отвергнуто — house-style: один чистый файл на ответственность, тесты unit per module.
- Изменить package.json/tsup: отвергнуто — новых зависимостей нет; существующие entry-точки покрывают новые модули.

## Performance Considerations

- Validation: O(n) по записям (Map-based lookup на contradictions/duplicates) + O(1) regex на endpoint. `validateAddress` per-entry — две regex на idt + две на idl.
- Chain/cycle: O(nodes) walk (каждый узел посещается в обходах от стартов + в cycle-проходах максимум один раз; degree≤1).
- Resolution: O(chains * available-current sorting) — сортировка current идентичностей только при ошибке MOV_TARGET_UNRESOLVED (алфавитный детерминированный список) — по образцу 015 availableIdls.
- Compile: O(total emitted moved) = O(nodes в live-цепочках), детерминированный порядок.
- `buildMoves`/`buildMovedFile` — чистые, без I/O; единственный file access — `loadMoves` (существование/чтение `.ycsf/moved.yaml`).

## Dependencies to Add

None. `yaml` уже в `packages/pilot`; `node:fs`/`node:path` — Node builtins; `src/contracts/` остаётся dependency-free; новых npm-пакетов нет.