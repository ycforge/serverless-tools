# Spec 017: moved — `.ycsf/moved.yaml`, Terraform `moved` blocks

## Metadata

- **Spec ID**: 017
- **Title**: Moved — `.ycsf/moved.yaml`, пользовательские Terraform `moved`-блоки для миграций ресурсов
- **Status**: 🚧 In Progress
- **Dependencies**: 014 (materializer-dispatch ✅)
- **IDEA.md sections**: §34 (Resource naming and stability), §35 (`.ycsf/moved.yaml`), §16 (IDL / IDT / IDR — определения терминов)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)
- **Branch**: `017-moved`

---

## Problem Statement

Сгенерированные C Terraform-адреса ресурсов должны быть стабильными (IDEA §34): `functions.user_service` → `yandex_function.user_service`. Когда приложение переименовывается (или меняется его Terraform-адрес), C не должен превращать rename в случайную замену ресурса — иначе Terraform в `plan` увидит «destroy старого + create нового» и потеряет реальный облачный ресурс (IDR), хотя ресурс тот же.

Terraform решает эту проблему собственным блоком `moved { from = <addr>; to = <addr> }`, который транслируется в операцию переноса в state, а не в recreate. Но `moved` знает только Terraform-адреса (IDT), а у C и пользователя есть ещё логическая идентичность (IDL), устойчивая к rename (Constitution VI). Нужен декларативный источник истории миграций, из которого C компилирует корректные Terraform `moved`-блоки.

IDEA §35 предлагает optional `.ycsf/moved.yaml`: файл хранит **исторические** migration записей логических идентичностей и Terraform-адресов. C вычисляет **текущее** логическое отображение из текущей project model, а `moved.yaml` — исторический источник. C компилирует соответствующие Terraform `moved`-блоки, корректно учитывая цепочки (chains) миграций.

Spec 017 реализует этот слой как **чистый transform между dispatch (014) и serialization (014)**: формат файла + loader + resolution/validation + компиляция `TerraformMoved[]` (контракт 002). Это IN-SCOPE. Вне scope — CLI-оркестрация (021), `ycsf check` (020), история-компакция, интерпретация provider-level state migrations.

Файл `.ycsf/moved.yaml` — **необязательный** компонент проекта (проект без миграций его не заводит). Ключевой инвариант: `moved.yaml` описывает только историю миграций generated resources; C не интерпретирует и не выполняет провайдер-специфичные переносы state (это зона Terraform).

---

## Scope (In Scope)

### 1. Формат `.ycsf/moved.yaml` (`version: 1`)

Канонический формат (соответствует §34–35 и каноническому reference-проекту `user_service` / `analytics` / `frontend` / `openapi`):

```yaml
version: 1
moves:
  - from:
      idl: functions.users
      idt: yandex_function.users
    to:
      idl: functions.user_service
      idt: yandex_function.user_service
```

- `version` обязателен и равен `1` (Constitution III: каждый `.ycsf/*.yaml` несёт `version: 1`); иначе `MOV_VERSION`.
- `moves` обязателен и является списком; отсутствие/иной тип → `MOV_INVALID`.
- Каждая запись — mapping ровно с двумя ключами `from` и `to`; каждый из них — mapping ровно с двумя ключами `idl` (строка, IDL-грамматика) и `idt` (строка, Terraform-адрес). Лишние/отсутствующие ключи, `idl`/`idt` не строки или с нарушением грамматики → `MOV_INVALID`.
- `from` и `to` не могут быть полностью идентичны (no-op move) → `MOV_INVALID`.
- Дубликаты YAML-ключей внутри любого mapping → `MOV_INVALID` (parse-gate с `uniqueKeys`, паттерн spec 011/014 `parseYaml`).
- Повтор одной и той же миграции целиком (одинаковые `from` и `to`) → `MOV_DUPLICATE` (redundant; fail-fast, Constitution V).

**IDL-грамматика** (segments — по соглашению двухсегменной IDL из spec 015 / §16): ровно два сегмента `domain.name`, каждый `[a-z][a-z0-9_]*` (нижний регистр, подчёркивание допустимо, дефис — нет). Примеры: `functions.user_service`, `functions.accounts`.

**IDT-грамматика** (Terraform-адрес): ровно два сегмента `type.name`, каждый `[a-zA-Z_][a-zA-Z0-9_]*` (pattern spec 014 `MTL_INVALID_TERRAFORM_ADDRESS`). Примеры: `yandex_function.user_service`, `yandex_function.accounts`.

### 2. Модель истории и цепочек (chains)

Каждая миграция считывается как «resource с идентичностью `from` → resource с идентичностью `to`». Идентичность — пара `{idl, idt}`, у которой **одна или обе** стороны могут меняться (IDEA §35):

- **Только idt меняется** (rename Terraform-адреса): `from{idl: functions.users, idt: yandex_function.users} → to{idl: functions.users, idt: yandex_function.user_api}`;
- **Только idl меняется** (логический rename без смены адреса): `from{idl: functions.users, idt: yandex_function.users} → to{idl: functions.accounts, idt: yandex_function.users}` — `to.idt` совпадает с `from.idt`;
- **Обе меняются** (полный rename): `functions.users / yandex_function.users → functions.user_service / yandex_function.user_service`.

**Цепочка (chain)** — максимальная последовательность миграций, где каждая следующая наследует идентичность предыдущей: `prev.to === next.from` (совпадение **обеих** компонент `idl` и `idt`). На промежуточном временном шаге resource имеет ровно одну идентичность `{idl, idt}`, поэтому связывание требует полного совпадения пары.

Пример §35 (цепочка из двух шагов):

```yaml
moves:
  - from: {idl: functions.users, idt: yandex_function.users}
    to:   {idl: functions.user_service, idt: yandex_function.user_service}
  - from: {idl: functions.user_service, idt: yandex_function.user_service}
    to:   {idl: functions.accounts, idt: yandex_function.accounts}
```

При текущей модели, где `functions.accounts` → `yandex_function.accounts`, C компилирует оба исторических адреса:

```
moved { from = yandex_function.users;       to = yandex_function.accounts }
moved { from = yandex_function.user_service; to = yandex_function.accounts }
```

**Терминал цепочки** — `to` последней миграции в цепочке. Цепочка **live (живая)**, если её терминал соответствует текущему resource (по паре `{idl, idt}`).

**Цикл в графе миграций** (например, `a→b`, `b→a`) — невалиден, детектируется как `MOV_CYCLE` (история не может «вращаться»; отсутствие прогресса к текущему состоянию — ошибка, не silent).

### 3. Текущее отображение (источник «current»)

C вычисляет current logical mapping **из текущей project model**, а не из `moved.yaml`. Вход компилятора — набор текущих ресурсов, каждый с парой `{idl, idt}` (для managed apps — из dispatch 014: IDL по соглашению `domain.name`, IDT — из `TerraformResource{type,name}`). `moved.yaml` — только история.

Врезка «project model → currentResources`» и «result → `.tf.json`» — оркестрация 021 (вне scope). Spec 017 определяет `buildMoves` как чистую функцию над входными `currentResources` + `moves`, возвращающую `TerraformMoved[]` (контракт 002), — зеркально тому, как spec 015 определял `applyExtensions`.

### 4. `buildMoves` — компиляция из истории в `TerraformMoved[]` (для 020 `ycsf check`)

```typescript
interface MoveEndpoint {
  readonly idl: string;
  readonly idt: string;
}

interface MoveEntry {
  readonly from: MoveEndpoint;
  readonly to: MoveEndpoint;
}

interface MovesYaml {
  readonly version: 1;
  readonly moves: readonly MoveEntry[];
}

type BuildMovesResult =
  | { readonly kind: 'ok'; readonly moved: readonly TerraformMoved[] }
  | { readonly kind: 'invalid'; readonly errors: readonly MovesDiagnostic[] };
```

Функция `buildMoves(currentResources: readonly MoveEndpoint[], moves: MovesYaml): BuildMovesResult`.

Двухфазная семантика (паттерн фазы 1 spec 014 / spec 015):

- **Фаза validation (collect-all, all-or-nothing)**: проверяются move validity, type-change, противоречия, цепи/циклы, resolvability терминалов к текущим ресурсам. Если есть хотя бы одна ошибка → `kind:'invalid'` со ВСЕМИ собранными ошибками; **ни один `moved` не компилируется**.
- **Фаза compile (детерминированная)**: для каждой live-цепочки от текущего ресурса в обратном порядке по истории эмитится `TerraformMoved{from: <старый idt>, to: <текущий idt>}` для каждого исторического адреса (кроме терминала, совпадающего с текущим).

Тип `TerraformMoved` — из контракта 002 (`packages/pilot/src/contracts/terraform.ts`, `{kind:'moved'; from: string; to: string}`), не переопределяется заново.

### 5. `loadMoves` — loader (паттерн spec 011/014; moved.yaml OPTIONAL)

```typescript
type MovesLoadResult =
  | { readonly kind: 'ok'; readonly data: MovesYaml }
  | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] };
```

Функция `loadMoves(rootDir: string): MovesLoadResult`.

- Файла нет → **ok** с `data = {version: 1, moves: []}` (в отличие от extensions 015: `moved.yaml` опционален, отсутствие — валидное состояние «нет миграций», НЕ ошибка; решение вызывать loader вообще — за оркестратором 021).
- Структурные ошибки (версия, форма, YAML-синтаксис, duplicate YAML-keys) → `kind:'invalid'` со **всеми** собранными diagnostics (collect-all); тип — переиспользуемый `ProjectModelDiagnostic` (паттерн registry `diag`).

### 6. Интеграция с 014 и 002

- Вход `buildMoves` = current `{idl, idt}` пары managed resources (из dispatch 014) + `MovesYaml`; выход = `TerraformMoved[]`, который сериализуется serializer-ом 014 как блоки `moved` (`.tf.json`: `{"moved": [...]}`). 017 не вводит собственную сериализацию.
- **017 не меняет ни contract 002 (`TerraformMoved` уже существует), ни dispatch/serialize 014**: чистый transform + loader + resolution/validation.
- Точка врезки «dispatch → buildMoves → serialize», а также передача `moved.yaml` в пайплайн — **оркестрация CLI 021** (вне scope). Наблюдаемый инвариант для 021: каждый скомпилированный `moved` имеет `from` = исторический Terraform-адрес, `to` = текущий адрес ресурса из project model.

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| CLI-оркестрация, вызов `buildMoves` из пайплайна | врезка — зона 021; spec 017 определяет формат + чистый transform | 021 |
| Команда `ycsf check` (020) | validation-функция есть (`buildMoves`); команда/проводка — 020 | 020 |
| История-компакция / удаление записей | IDEA §35: «Не требуется удалять/compact history в MVP» | — |
| Интерпретация провайдер-специфичных переносов state (`terraform state mv` и т.п.) | C не выполняет provider-level state migrations; Terraform владеет `moved`-семантикой | Terraform |
| Cross-check IDL-домен ↔ IDT-тип через side-table | требовало бы table из spec 015 (зависимость 017 — только 014); тип-чека по адресу (FR-005) автономен | — |
| Изменения dispatch/serialize (014) или contract 002 | 017 аддитивен; врезка — оркестрация 021 | 021 |
| Where/как строятся current `{idl, idt}` для managed apps | из dispatch 014; передача в buildMoves — оркестрация 021 | 021 |

---

## User Scenarios & Testing

### User Story 1 — DevOps переименовал Terraform-адрес функции (только idt) (Priority: P1)

Приложение `user_service` (logical `functions.users`) переименовано, Terraform-адрес сменился с `yandex_function.users` на `yandex_function.user_api`; logical identity не менялась. DevOps записывает миграцию в `moved.yaml`. C компилирует один `moved`-блок, Terraform перенесёт resource в state, а не пересоздаст.

**Why this priority**: Основной happy path §35 («Также возможно изменение только Terraform address»). Без него rename = рискованный destroy+create.

**Independent Test**: current resources `[{idl:'functions.users', idt:'yandex_function.user_api'}]`, moves `[{from:{idl:'functions.users', idt:'yandex_function.users'}, to:{idl:'functions.users', idt:'yandex_function.user_api'}}]` → `kind:'ok'`, `moved` содержит ровно один блок `{from:'yandex_function.users', to:'yandex_function.user_api'}`.

**Acceptance Scenarios**:

1. **Given** current resource `functions.users / yandex_function.user_api` и одна миграция `from{idl:functions.users, idt:yandex_function.users} → to{idl:functions.users, idt:yandex_function.user_api}`, **When** buildMoves, **Then** `result.kind === 'ok'`; `moved` равен `[{kind:'moved', from:'yandex_function.users', to:'yandex_function.user_api'}]`.
2. **Given** тот же результат, **When** результат сериализован serializer-ом 014, **Then** `.tf.json` содержит блок `{"moved":[{"from":"yandex_function.users","to":"yandex_function.user_api"}]}` (валидный, keys отсортированы).

---

### User Story 2 — DevOps полностью переименовал функцию (idl + idt) (Priority: P1)

Logical `functions.users` и адрес `yandex_function.users` переименованы в `functions.user_service` / `yandex_function.user_service` (канонический пример §34–35). C компилирует `moved`, сохраняя облачный resource.

**Why this priority**: Полный rename — центральный кейс стабильности адресов (§34).

**Independent Test**: current `[{idl:'functions.user_service', idt:'yandex_function.user_service'}]`, moves `[{from:{idl:'functions.users', idt:'yandex_function.users'}, to:{idl:'functions.user_service', idt:'yandex_function.user_service'}}]` → `{from:'yandex_function.users', to:'yandex_function.user_service'}`.

**Acceptance Scenarios**:

1. **Given** текущий `functions.user_service / yandex_function.user_service` и миграция `from{idl:functions.users, idt:yandex_function.users} → to{idl:functions.user_service, idt:yandex_function.user_service}`, **When** buildMoves, **Then** `kind==='ok'`; `moved[0]` = `{from:'yandex_function.users', to:'yandex_function.user_service'}`.
2. **Given** тот же input, **When** buildMoves, **Then** `to` в блоке равен **текущему** адресу `yandex_function.user_service` из project model (не из истории).

---

### User Story 3 — DevOps учитывает цепочку миграций (multi-hop) (Priority: P1)

Функция мигрировала дважды: `users → user_service → accounts`. Текущая модель знает только финальное имя `accounts`. C должен корректно «собрать» всю историю и скомпилировать `moved` для **обоих** исторических адресов (IDEA §35: «Для цепочки migration C должен корректно учитывать history»).

**Why this priority**: Цепочки — явное требование §35; наивная реализация (только последний шаг) потеряла бы первый адрес.

**Independent Test**: current `[{idl:'functions.accounts', idt:'yandex_function.accounts'}]`, две миграции из §35 → два `moved`-блока с текущим `to`.

**Acceptance Scenarios**:

1. **Given** текущий `functions.accounts / yandex_function.accounts` и цепочка `users→user_service` + `user_service→accounts`, **When** buildMoves, **Then** `kind==='ok'`; `moved` = `[{from:'yandex_function.users', to:'yandex_function.accounts'}, {from:'yandex_function.user_service', to:'yandex_function.accounts'}]` (порядок — по хронологии, старый адрес раньше).
2. **Given** цепочка из 3 шагов `a→b→c→d` и текущий `d`, **When** buildMoves, **Then** эмитится `moved` для адресов `a`, `b`, `c` (каждый с `to = d`).
3. **Given** только последний шаг цепочки в истории (промежуточный отсутствует), но терминал соответствует текущему resource, **When** buildMoves, **Then** компилируется то, что присутствует (никакой ошибки; история необязательно полная).

---

### User Story 4 — Смена типа Terraform-ресурса — НЕ безопасный rename (Priority: P1)

DevOps пытается «переименовать» `functions.users / yandex_function.users` в `containers.users / yandex_container.users`. Это разные типы ресурсов; IDEA §35: смена типа не должна автоматически трактоваться как безопасный rename/move — потенциально другой resource и требует recreation/explicit semantics. C — fail-fast ошибка.

**Why this priority**: Fail-fast над «магией» (Constitution V); авто-safe трактовка была бы опасной — Terraform `moved` между разными типами не корректен.

**Independent Test**: moves c `from.idt = yandex_function.users`, `to.idt = yandex_container.users` → invalid, `MOV_TYPE_CHANGE`.

**Acceptance Scenarios**:

1. **Given** миграция, где Terraform resource type у `from.idt` и `to.idt` различается (`yandex_function` → `yandex_container`), **When** buildMoves, **Then** `kind==='invalid'`; errors содержит `MOV_TYPE_CHANGE`.
2. **Given** та же ситуация + ещё один валидный `moved`-совместимый шаг в файле, **When** buildMoves, **Then** НИ один `moved` не скомпилирован (all-or-nothing); валидный шаг не влияет на результат.

---

### User Story 5 — Противоречивые bindings → ошибка (Priority: P1)

Одна логическая идентичность не может мигрировать в два разных места, и одна текущая идентичность не может иметь две разные истории. Противоречие — ошибка, не silent merge (Constitution V).

**Why this priority**: Эксплицитность и детерминизм (один from → ровно один to); устранение скрытой зависимости от порядка записей.

**Independent Test**: две миграции с одинаковым `from`, но разным `to` → `MOV_CONTRADICTORY`; две с одинаковым `to`, но разным `from` → `MOV_CONTRADICTORY`.

**Acceptance Scenarios**:

1. **Given** две миграции `{from: {idl:functions.users, idt:yandex_function.users}}` с `to` `functions.accounts` и `functions.analytics` соответственно, **When** buildMoves, **Then** `kind==='invalid'`; errors содержит `MOV_CONTRADICTORY`.
2. **Given** две миграции с одинаковым `to` `{idl:functions.accounts, idt:yandex_function.accounts}`, но разными `from`, **When** buildMoves, **Then** `kind==='invalid'`; errors содержит `MOV_CONTRADICTORY`.

---

### User Story 6 — Target не соответствует текущему ресурсу / dangling migration (Priority: P1)

История заканчивается на идентичности, которой нет в текущей model. Это либо опечатка в `to`, либо устаревшая история: цепочка «повисает» (dangling) — её терминал не соответствует ни одному текущему resource. C — ошибка, не silent skip.

**Why this priority**: C обязан валидировать связь истории с текущей моделью (перечислено в §35); молчаливый пропуск скрывал бы потерю ресурса.

**Independent Test**: current `[{idl:'functions.user_service', idt:'yandex_function.user_service'}]`, миграция с `to{idl:'functions.analytics', idt:'yandex_function.analytics'}` (нет в current) → `MOV_TARGET_UNRESOLVED`; все entries этой цепочки — `MOV_DANGLING`.

**Acceptance Scenarios**:

1. **Given** миграция, чей терминал `to` не соответствует ни одному текущему resource (например, `to{idl:'functions.analytics', ...}`, а в current есть только `functions.user_service`), **When** buildMoves, **Then** `kind==='invalid'`; errors содержит `MOV_TARGET_UNRESOLVED` с указанием терминала.
2. **Given** цепочка из нескольких шагов, чей терминал не текущий, **When** buildMoves, **Then** каждый entry этой цепочки даёт `MOV_DANGLING` (история целиком «висит»), плюс `MOV_TARGET_UNRESOLVED` на терминале.

---

### User Story 7 — Только idl меняется (адрес не меняется) → no-op для Terraform (Priority: P1)

Логический rename (`functions.users → functions.accounts`) при неизменном Terraform-адресе (`yandex_function.users`). Terraform-адрес не изменился → `moved`-блок не нужен (Terraform ничего переносить не должен); фича idl-only миграции — в поддержке цепочек и стабильности логической идентичности (Constitution VI), а не в изменении адреса.

**Why this priority**: Вариант «either side may stay» из §35; надо явно определить, что idl-only не даёт Terraform-блок (иначе был бы no-op `moved { from = X; to = X }`).

**Independent Test**: current `[{idl:'functions.accounts', idt:'yandex_function.users'}]`, миграция `from{idl:functions.users, idt:yandex_function.users} → to{idl:functions.accounts, idt:yandex_function.users}` → `kind:'ok'`, `moved === []` (пусто).

**Acceptance Scenarios**:

1. **Given** миграция, где `from.idt === to.idt` (меняется только `idl`), и терминал соответствует текущему resource, **When** buildMoves, **Then** `kind==='ok'`; `moved` пуст (ни одного блока — адрес не изменился).
2. **Given** цепочка `users→accounts→reports`, где `users→accounts` — idl-only, а `accounts→reports` меняет и idt, текущий `reports`, **When** buildMoves, **Then** компилируется `moved` только для реально изменившегося адреса (шаг смены idt), с `to = текущий адрес`.

---

### User Story 8 — Валидация формата и грамматики (Priority: P2)

DevOps написал `version: 2`, или забыл `moves:`, или указал idl с тремя сегментами / с дефисом, или idt с неправильной грамматикой, или передал no-op move. `loadMoves`/`buildMoves` возвращают понятные диагностики.

**Why this priority**: Контракт файла (Constitution III — version), fail-fast-структура.

**Independent Test**: «сырые» тексты YAML подаются в loader; проверяются коды.

**Acceptance Scenarios**:

1. **Given** `.ycsf/moved.yaml` c `version: 2`, **When** loadMoves, **Then** kind 'invalid', errors содержит `MOV_VERSION`.
2. **Given** файл c `version: 1` без ключа `moves`, **When** loadMoves, **Then** kind 'invalid', errors содержит `MOV_INVALID` (missing 'moves').
3. **Given** миграция c `from: {idl: functions, idt: yandex_function.users}` (id с одним сегментом) или `idl: "functions.user_service.extra"` (три сегмента), или `idt: "yandex-Function.users"` (дефис в типе), **When** buildMoves/loadMoves, **Then** kind 'invalid', errors содержит `MOV_INVALID`; несколько структурных ошибок собираются вместе (collect-all).
4. **Given** миграция, где `from` и `to` полностью идентичны (no-op), **When** buildMoves, **Then** kind 'invalid', errors содержит `MOV_INVALID`.

---

### User Story 9 — Optional file, пусто, детерминизм (Priority: P1)

`moved.yaml` опционален: файла нет — проект просто без миграций; `moves: []` — нет `moved`-блоков; одинаковые входные → одинаковый результат.

**Why this priority**: Границы фичи (IDEA §35: optional) и детерминизм (diff-based workflows, git).

**Independent Test**: 4 вызова: (a) loader без файла, (b) `moves: []`, (c) два buildMoves с одинаковыми входами, (d) два buildMoves с разным порядком записей.

**Acceptance Scenarios**:

1. **Given** в проекте нет `.ycsf/moved.yaml`, **When** вызван `loadMoves(rootDir)`, **Then** kind 'ok', `data.moves === []` (отсутствие файла — валидное состояние, НЕ ошибка).
2. **Given** `.ycsf/moved.yaml` c `moves: []`, **When** buildMoves с любыми current resources, **Then** kind 'ok', `moved === []`.
3. **Given** одинаковые `currentResources` и `moves`, **When** buildMoves вызван дважды, **Then** оба результата глубоко равны (детерминизм).
4. **Given** один и тот же набор цепочек, записанный в разном порядке записей, **When** buildMoves, **Then** результирующий `moved` одинаков (порядок определяется цепочками и хронологией, а не порядком записей файла).

---

### Edge Cases

- **`moves: []`**: no-op; `moved === []` (US9 AC2).
- **Только idl меняется** (`to.idt === from.idt`): `moved` не эмитится (адрес не изменился) — US7 AC1.
- **Только idt меняется** (`from.idl === to.idl`): один `moved` (US1).
- **Цепочка с idl-only шагом внутри**: idl-only шаг не даёт отдельный `moved`; `moved` эмитится только при реальной смене адреса, с `to` = финальный текущий адрес (US7 AC2).
- **Смена Terraform resource type**: `MOV_TYPE_CHANGE` (US4). 
- **`from === to` полностью**: `MOV_INVALID` (US8 AC4).
- **Одинаковый `from`, разный `to`**: `MOV_CONTRADICTORY` (US5 AC1).
- **Одинаковый `to`, разный `from`**: `MOV_CONTRADICTORY` (US5 AC2).
- **Дубликат миграции целиком (одинаковые from+to)**: `MOV_DUPLICATE`.
- **Цикл в графе** (`a→b`, `b→a`): `MOV_CYCLE` (история не может вращаться).
- **Терминал не в текущей модели**: `MOV_TARGET_UNRESOLVED`; все entries цепочки — `MOV_DANGLING` (US6).
- **idl с 1 или 3+ сегментами, пустым сегментом, не-lowercase или дефисом**: `MOV_INVALID` (грамматика `[a-z][a-z0-9_]*`).
- **idt c невалидной грамматикой** (например, дефис/слэш в сегменте): `MOV_INVALID` (грамматика `[a-zA-Z_][a-zA-Z0-9_]*`).
- **Дубликат YAML-ключа** (`from: {idl: X, idl: Y, idt: Z}`): ловится parse-gate `uniqueKeys` → `MOV_INVALID`.
- **Цепочка с пропущенным промежуточным шагом**: компилируется то, что есть; ошибки нет (US3 AC3).
- **Несколько независимых цепочек**: каждая компилируется отдельно и детерминированно.
- **Порядок diagnostics**: детерминированный — по порядку записей в файле (структурные/валидные), затем цепочки.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST поддерживать optional файл `.ycsf/moved.yaml` формата `version: 1` с обязательным ключом `moves` — списком записей `{ from: {idl, idt}, to: {idl, idt} }` (US8, US9; §35).
- **FR-002**: `loadMoves(rootDir)` MUST возвращать `kind:'ok'` с `data.moves === []`, если `.ycsf/moved.yaml` отсутствует (файл опционален, IDEA §35; в отличие от `EXT_MISSING_FILE` в 015); наличие файла решает оркестратор 021.
- **FR-003**: System MUST отклонять отсутствующий или отличный от `1` `version` → diagnostic `MOV_VERSION` (Constitution III).
- **FR-004**: System MUST отклонять структурно невалидные файлы → diagnostics `MOV_INVALID`, собираемые для ВСЕХ найденных ошибок (collect-all): YAML-синтаксис, duplicate YAML-keys (parse-gate `uniqueKeys`), отсутствие/не-список `moves`, запись не mapping, отсутствие/лишние ключи (`from`/`to`), `from.from/to` не mapping, `idl` не строка или нарушение IDL-грамматики (два сегмента `[a-z][a-z0-9_]*`), `idt` не строка или нарушение IDT-грамматики (два сегмента `[a-zA-Z_][a-zA-Z0-9_]*`), `from === to` целиком (no-op) (US8).
- **FR-005**: System MUST отклонять миграцию, где Terraform resource type (первый сегмент `from.idt`) отличается от типа `to.idt` → diagnostic `MOV_TYPE_CHANGE`; смена типа НЕ трактуется как безопасный rename/move (fail-fast, IDEA §35; Constitution V) (US4).
- **FR-006**: System MUST отклонять противоречивые bindings → diagnostic `MOV_CONTRADICTORY`: (a) две миграции с одинаковым `from`, но разным `to`; (b) две миграции с одинаковым `to`, но разным `from` (Constitution V: collision = error, не merge) (US5).
- **FR-007**: System MUST отклонять полный дубликат миграции (одинаковые `from` и `to`) → diagnostic `MOV_DUPLICATE` (redundant история; fail-fast) (Edge Cases).
- **FR-008**: System MUST детектировать цикл в графе миграций (например, `a→b`, `b→a`) → diagnostic `MOV_CYCLE`.
- **FR-009**: System MUST строить цепочки миграций по правилу связывания `prev.to === next.from` (**обе** компоненты `idl` и `idt` совпадают); компоновка цепочек — детерминированная (US3).
- **FR-010**: System MUST проверять, что терминал каждой цепочки соответствует текущему resource из `currentResources` (совпадение пары `{idl, idt}`); несоответствие → diagnostic `MOV_TARGET_UNRESOLVED` (указывает терминал и доступные текущие идентичности); кроме того, каждый entry несостоявшейся цепочки → diagnostic `MOV_DANGLING` (US6).
- **FR-011**: System MUST НЕ эмитить `moved`-блок для миграции, где `from.idt === to.idt` (изменился только `idl`; Terraform-адрес не менялся — блок был бы no-op `moved{from:X,to:X}`) (US7).
- **FR-012**: System MUST для каждой live-цепочки эмитить `TerraformMoved{from:<исторический адрес>, to:<текущий адрес из currentResources>}` для каждого исторического Terraform-адреса (кроме терминала, равного текущему); порядок блоков — хронологический (старый адрес раньше) (US1, US2, US3).
- **FR-013**: System MUST при любой ошибке validation НЕ компилировать ни одного `moved` (all-or-nothing, collect-all) (US4 AC2, US6).
- **FR-014**: System MUST применять validation к `moves` и `currentResources` без побочных эффектов и без I/O: чистый transform над входными данными; user `*.tf` не читается и не изменяется; провайдер-специфичные state migrations не выполняются (Constitution I/IV).
- **FR-015**: System MUST возвращать `moved` как `readonly TerraformMoved[]` — тип из contract 002 (`TerraformMoved`), не переопределяемый (US1 AC1).
- **FR-016**: System MUST быть детерминированным: одинаковые `currentResources` + один и тот же набор цепочек → одинаковый результирующий `moved` независимо от порядка записей в файле (US9 AC3/AC4).

### Error Codes (MOV_* family)

| Code | Condition | Phase |
|------|-----------|-------|
| `MOV_VERSION` | отсутствует или не равен `1` `version` (Constitution III) | Load |
| `MOV_INVALID` | Структура: YAML-синтаксис / duplicate YAML-keys / нет-или-не-список `moves` / запись не mapping / нет-или-лишние ключи / `from`/`to` не mapping / idl или idt не строка или нарушение грамматики / `from === to` (no-op) | Load + Validate |
| `MOV_DUPLICATE` | полный дубликат миграции (одинаковые `from` и `to`) | Validate |
| `MOV_TYPE_CHANGE` | смена Terraform resource type между `from.idt` и `to.idt` (не безопасный rename; fail-fast) | Validate |
| `MOV_CONTRADICTORY` | одинаковый `from` при разном `to`, или одинаковый `to` при разном `from` (collision, нет silent merge) | Validate |
| `MOV_CYCLE` | цикл в графе миграций (`a→b`, `b→a`) | Validate |
| `MOV_TARGET_UNRESOLVED` | терминал цепочки не соответствует ни одному текущему resource (message: терминал + доступные текущие идентичности) | Validate (buildMoves / 020 check) |
| `MOV_DANGLING` | entry цепочки, чей терминал не соответствует текущему resource (история «висит») | Validate (buildMoves) |

Кода для «успешного no-op idl-only» **нет**: это валидный результат (`kind:'ok'`, пустой `moved`), а не ошибка (US7). Кода для missing-file **нет**: отсутствие файла — валидное состояние (FR-002).

### Key Entities

- **MoveEndpoint**: `{ idl: string, idt: string }` — одна сторона миграции; логическая идентичность (IDL) + Terraform-адрес (IDT). `idl` — двухсегментный (`[a-z][a-z0-9_]*`), `idt` — `type.name` (`[a-zA-Z_][a-zA-Z0-9_]*`).
- **MoveEntry**: `{ from: MoveEndpoint, to: MoveEndpoint }` — одна запись миграции в `.ycsf/moved.yaml`.
- **MovesYaml**: `{ version: 1, moves: readonly MoveEntry[] }` — содержимое `.ycsf/moved.yaml` (formatted contract, Constitution III).
- **Chain**: максимальная последовательность миграций, связанная правилом `prev.to === next.from` (обе компоненты); терминал — `to` последней миграции; цепочка live, если терминал соответствует текущему resource.
- **CurrentResources**: входные `readonly MoveEndpoint[]` — текущее логическое отображение из project model (явная истина для «to»); передаётся в buildMoves оркестратором 021.
- **MovesDiagnostic**: `{ code, message, entry?, endpoint?, field?, file?, line?, column?, available? }` — диагностика load/validation (`MOV_*`); структурные diagnostics loader-а переиспользуют `ProjectModelDiagnostic` из 011 (паттерн registry).
- **MovesLoadResult**: `{ kind:'ok', data: MovesYaml } | { kind:'invalid', errors }` — результат `loadMoves` (отсутствие файла → ok с пустым `moves`).
- **TerraformMoved**: `{ kind:'moved'; from: string; to: string }` — контракт 002 (`.tf.json`: `{"moved":[...]}`); тип не дублируется в 017.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Каждый безопасный rename (только idt / обе стороны / цепочка) компилируется в корректный `moved`-блок с `to` = текущий адрес из project model; Terraform перенесёт resource в state без destroy+create (US1–US3; FR-012).
- **SC-002**: Цепочки миграций учтены верно: для N-шаговой цепочки компилируется по одному `moved` на каждый исторический адрес, все с `to` = текущий адрес, в хронологическом порядке (US3; FR-009/FR-012).
- **SC-003**: Смена Terraform resource type — fail-fast ошибка `MOV_TYPE_CHANGE`; ни один `moved` не скомпилирован (all-or-nothing) (US4; FR-005/FR-013).
- **SC-004**: Противоречивые bindings и дубликаты — ошибки: `MOV_CONTRADICTORY` / `MOV_DUPLICATE` / `MOV_CYCLE`; никакого silent merge, поведение order-independent (US5; FR-006/FR-007/FR-008/FR-016).
- **SC-005**: История валидируется против текущей модели: терминал не-текущей цепочки → `MOV_TARGET_UNRESOLVED`, entries → `MOV_DANGLING`; dangling-история не уходит молча (US6; FR-010).
- **SC-006**: idl-only миграция не даёт no-op `moved`-блок (адрес не менялся) (US7; FR-011).
- **SC-007**: Контракт файла enforcement: `version: 1` обязателен (`MOV_VERSION`), структура и грамматика обязательны (`MOV_INVALID`), `moves: []` и отсутствие файла — валидные состояния без ошибок (US8/US9; FR-001/FR-002/FR-003/FR-004).
- **SC-008**: Детерминизм: одинаковые входные → одинаковый `moved` (порядок записей файла не влияет) (US9; FR-016).
- **SC-009**: Чистый transform: `buildMoves` не выполняет I/O и не интерпретирует провайдер-специфичные state migrations; user `.tf` не затрагивается (US-инвариант; FR-014; Constitution I/IV).
- **SC-010**: 100% acceptance criteria spec 017 покрыты тестами (Constitution II); каждый AC → минимум один тест; тесты подтверждают RED → GREEN.

---

## Assumptions

- **Связывание цепочек — точное совпадение пары `{idl, idt}`**: `prev.to === next.from` требует совпадения обеих компонент; по одной компоненте цепочка не связывается. Обоснование: в каждый момент времени resource имеет ровно одну идентичность `{idl, idt}`; частичное совпадение означало бы неточность истории.
- **Терминал цепочки соответствует текущему resource по `idl` И `idt`**: если терминал `to.idl` совпадает, но `to.idt` отличается (или наоборот) — это несоответствие (`MOV_TARGET_UNRESOLVED`), т.к. проект отдаёт пару `{idl, idt}`.
- **`MOV_DANGLING` vs `MOV_TARGET_UNRESOLVED`**: `MOV_TARGET_UNRESOLVED` — на терминале (заявленный пункт назначения не является текущим resource); `MOV_DANGLING` — на каждом entry цепочки, чей терминал не текущий (вся цепочка «висит»). Для одиночной несостоявшейся миграции эмитятся оба кода.
- **idl-only миграция — валидна, но не даёт Terraform-блок**: изменение только логической идентичности при неизменном адресе не требует `moved` (FR-011). Необходимость idl-only объясняется стабильностью логической идентичности и chaining (Constitution VI).
- **Тип-чек выполняется на `idt` (первый сегмент) автономно, без side-table `IDL_DOMAIN_BY_TF_TYPE` из spec 015**: зависимость 017 — только 014; cross-check «IDL-домен ↔ IDT-тип» в scope 017 не входит. Семантика проста: `MOV_TYPE_CHANGE` ловит смену Terraform-типа, которая и есть опасная (небезопасная) ситуация.
- **История может быть неполной**: если терминал текущий, пропущенные промежуточные шаги не ошибка (US3 AC3); компилируется то, что присутствует. Ошибкой является только терминал, не соответствующий текущей модели.
- **`.ycsf/moved.yaml` — optional**: отсутствие файла — валидное состояние (FR-002); `MOV_MISSING_FILE`-кода нет (осознанно, в отличие от `EXT_MISSING_FILE` в 015: там файл обязателен по решению оркестратора; здесь — необязателен по IDEA §35).
- **Тип `TerraformMoved` из contract 002 переиспользуется как есть**: `{kind:'moved', from, to}`; 017 не расширяет и не переопределяет его (FR-015).
- **Текущее отображение передаётся в `buildMoves` как вход**: `currentResources` строится из dispatch 014 (managed apps → `{idl, idt}`); построение и передача — зона оркестрации 021, не 017.
- **Сериализация не меняется (014)**: `TerraformMoved[]` сериализуется serializer-ом 014 в `.tf.json` (`{"moved":[...]}`); 017 не вводит собственную сериализацию.
- **Fixture current resources в тестах**: текущие `{idl, idt}` пары подаются напрямую (как вход `buildMoves`); интеграция с реальным dispatch — 021.
- **Компакция/удаление истории не требуется в MVP** (IDEA §35).

---

## References

- Spec 002: pilot-contracts — `TerraformMoved` (`{kind:'moved', from, to}`), `TerraformResource`, IDL/IDT-грамматика
- Spec 014: materializer-dispatch — `DispatchResultOk.resources`, serializer `.tf.json`, паттерн двухфазного fail-fast (collect-all / all-or-nothing), `MTL_INVALID_TERRAFORM_ADDRESS` (IDT-грамматика)
- Spec 015: extensions — IDL-адресация, глубокий merge, паттерн чистого transform (`applyExtensions`) между dispatch и serialization, паттерн loader-а
- Spec 009: resource-references — модель IDL/IDT/IDR (Project B → A/C шов); двухсегментная IDL-грамматика
- IDEA.md §34: Resource naming and stability — стабильность сгенерированных адресов
- IDEA.md §35: `.ycsf/moved.yaml` — формат, chains, optional, «Не требуется удалять/compact history в MVP», fail-fast при смене типа
- Constitution III: contracts versioned (`version: 1`); IV: C не моделирует provider schema, не интерпретирует provider-level state migrations; V: explicit over magic (collision = error, no silent merge); VI: logical identity stable, renames only via `.ycsf/moved.yaml`; I: C владеет orchestration/build

---

## Next Steps

1. `/speckit.plan` — технический дизайн: `src/contracts/moves.ts` (type-only + `MOV_*`), `src/moves/` (loader, chain builder, validation, compiler), вход `currentResources`, точка врезки в 021.
2. `/speckit.tasks` — задачи в test-first: контракты → loader (parse-gate) → chain resolution → validation (type-change, contradiction, cycle, target) → compile `TerraformMoved[]` → edge cases → RED→GREEN.
3. `/speckit.implement` — код и тесты по acceptance criteria; lint, typecheck.
