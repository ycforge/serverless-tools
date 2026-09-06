# Spec 015: extensions — `.ycsf/extensions.yaml`, IDL-адресация, deep merge

## Metadata

- **Spec ID**: 015
- **Title**: Extensions — `.ycsf/extensions.yaml`, IDL-адресация таргетов, deep merge для generated resources
- **Status**: 🚧 In Progress
- **Dependencies**: 002 (pilot-contracts ✅), 014 (materializer-dispatch ✅)
- **IDEA.md sections**: §25 (User extensions), §16 (IDL / IDT / IDR — определения терминов), §26 (outputs — только для согласования разрешения IDL)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)
- **Branch**: `015-extensions`

---

## Problem Statement

Spec 014 диспатчит каждый app на materializer, получает `TerraformResource` и сериализует его в deterministic `.tf.json`. После этого у пользователя нет декларативного способа расширить сгенерированный resource: добавить env-переменную в `environment`, поднять `execution_timeout`, привязать service account — без правки кода materializer или Terraform-оверрайдов.

Terraform `*_override.tf` неприемлем по четырём причинам (IDEA §25):

1. Заменяет **весь** nested block одного типа, а не мержит поля на любом уровне вложенности;
2. Адресуется по Terraform IDT (`yandex_function.user_service`) — хрупкий адрес, ломается при переименовании в C;
3. C не валидирует target — опечатка уходит в `terraform plan` молча;
4. Нет стабильной логической адресации, устойчивой к rename.

IDEA §25 предлагает декларативный `.ycsf/extensions.yaml`: target — стабильный **IDL** (`functions.user_service`), patch — **deep merge** в `resource.configuration`. Spec 015 реализует этот слой как **чистый transform между dispatch (014) и serialization (014)**: формат файла + loader + IDL-resolution + deep merge + диагностика `EXT_*`. Это IN-SCOPE. Вне scope — CLI-оркестрация (021), `ycsf check`-команда (020), outputs (016), чтение user `.tf` (запрещено Constitution IV — C никогда не читает и не анализирует `*.tf`).

Файл `.ycsf/extensions.yaml` — **необязательный** компонент проекта (проект без расширений его не заводит). Ключевой инвариант: extensions применяются **только** к generated resources output-а dispatch, никогда к builder-ам, никогда к user `.tf`.

---

## Scope (In Scope)

### 1. Формат `.ycsf/extensions.yaml` (`version: 1`)

Канонический формат (соответствует §25 и каноническому reference-проекту `user_service` / `openapi`):

```yaml
version: 1
extensions:
  - target: "functions.user_service"
    patch:
      environment:
        CUSTOM_VAR: "value"
      execution_timeout: "30s"
      service_account_id: "${yandex_iam_service_account.custom.id}"

  - target: "gateways.openapi"
    patch:
      custom_domains:
        - domain_id: "${yandex_api_gateway_domain.main.id}"
```

Структурные требования (подробно — FR-003/FR-004):

- `version` обязателен и равен `1` (Constitution III: каждый `.ycsf/*.yaml` несёт `version: 1`); иначе `EXT_VERSION`.
- `extensions` обязателен и является списком правил; отсутствие/иной тип → `EXT_INVALID`.
- Каждое правило — mapping ровно с двумя ключами: `target` (строка, IDL-грамматика) и `patch` (plain-object mapping, т.е. YAML-таблица). Лишние/отсутствующие ключи, `target` не строка или с нарушением грамматики, `patch` не mapping (например, скаляр/список/null) → `EXT_INVALID`.
- Дубликаты YAML-ключей внутри любого mapping (включая вложенные в `patch`) → `EXT_INVALID` (парсится через parse-gate с `uniqueKeys`, паттерн spec 011/014 `parseYaml`).
- Содержимое значений `patch` C **не валидирует** против provider schema (Constitution IV: provider schema — зона `terraform validate`; C не моделирует её). Проверяется только TYPE-структура (object/array/scalar/null), необходимая для merge.
- **Интерполяция**: `${...}`-строки в значениях patch проходят через весь pipeline без обработки и без валидации (FR-010; Terraform владеет их семантикой). `{{$ENV}}` в extensions **не обрабатывается** и **не валидируется** (FR-011; это build-time концепция spec 012 для build-контекстов, к extensions неприменима).

### 2. IDL-адресация — механизм resolution (решение этой спецификации)

IDEA §16 вводит трёхуровневую модель:

```text
IDL:  functions.user_service          # logical identity (<domain>.<name>)
IDT:  yandex_function.user_service     # Terraform address (<type>.<name>)
IDR:  d4e123...                        # реальный cloud-ресурс (после terraform apply)
```

§26 подтверждает соответствие на примере: `gateways.openapi.domain` → `yandex_api_gateway.openapi.domain`. Т.е. **имя (name) в IDL и в IDT совпадает**, а первый сегмент — **домен** — однозначно соответствует Terraform resource type.

**Решение (механизм)**: IDL первого сегмента (домен) выводится из `TerraformResource.type` через **explicit side-table `IDL_DOMAIN_BY_TF_TYPE`**, которой владеет модуль extensions (Project C). Для канонических доменов:

| Terraform resource type | IDL domain |
|-------------------------|------------|
| `yandex_function`       | `functions` |
| `yandex_api_gateway`    | `gateways` |

Почему side-table, а не аддитивное поле `idl?` на `TerraformResource` (contract 002):

| Критерий | Side-table `IDL_DOMAIN_BY_TF_TYPE` | Поле `TerraformResource.idl?: string` |
|----------|------------------------------------|----------------------------------------|
| Аддитивность к contract 002 | да, контракт не меняется вообще | да, но контракт расширяется |
| Материализуется ли table/internals | нет — extension-модуль C сам владеет mapping | требование заполнять `idl` ложится на каждый materializer-плагин — мы **выдумываем internals плагинов** |
| Honesty | домен — это соглашение C о сгенерированном ресурсе, C его и декларирует | домен приходит «из builder/materializer internals» |
| Явность (Constitution V) | одна нормативная таблица, расширяется точечно | скрытый где-то в плагине стринг |
| IDL-stable при rename | name сегмент = `resource.name` = stable logical identity app (Constitution VI); домен = C-таблица | тоже, но требует миграции всех плагинов |

Вывод: **side-table, C-owned, additive к 002**; контракты 002/014 не меняются (аддитивной правки нет вообще — это самое честное решение).

**IDL grammar** (сегменты — по грамматике `ResourceReference` из contract 002 / spec 009): ровно два сегмента `domain.name`, каждый `[a-z][a-z0-9_]*` (нижний регистр, подчёркивание допустимо, дефис — нет). Примеры: `functions.user_service`, `gateways.openapi`.

**Normative resolution rule** (из `resource` `{type: T, name: N}` → IDL):

1. `domain = IDL_DOMAIN_BY_TF_TYPE[T]`; если `T` отсутствует в таблице — ресурс **не IDL-адресуем** и в IDL-индекс не попадает (не ошибка сам по себе: такой ресурс просто нельзя таргетировать).
2. `idl(resource) = domain.N`.
3. Каждый `target` из extensions.yaml разрешается ровно к одному ресурсу: `idl(resource) === target`.
4. Ноль совпадений → `EXT_UNRESOLVED_TARGET` (message содержит сам target + список **доступных IDL** всех IDL-адресуемых ресурсов в детерминированном алфавитном порядке).
5. Одно совпадение — patch применяется к `resource.configuration`.

Домен, не входящий в таблицу, но грамматически валидный (`containers.my_app`) — НЕ структурная ошибка: это **resolution-level** `EXT_UNRESOLVED_TARGET` (доступные IDL показывают, что такого домена нет). Это безопасно по отношению к росту таблицы (spec 019 добавит домены аддитивно; сегодняшний «неопознанный» домен завтра может стать валидным).

**Инвариант уникальности IDL**: по construction dispatch 014 (один app → один resource; `resource.name` уникален в пределах типа) и 1:1 таблицы доменов, два ресурса с одним IDL невозможны. Нарушение инварианта — defensive `EXT_INVALID` (сообщение «duplicate IDL <idl> in generated model»); непроизводимо на текущем dispatch, заявлено для честности при будущем multi-resource (019).

### 3. Deep merge семантика (§25.2 — точно по разделу)

`patch` применяется к `resource.configuration`. Merge — структурный, на JSON-дереве (YAML-дерево — это дерево, циклы невозможны по data-model; `undefined`/функции/Date невозможны после YAML-парсинга):

- **Object + Object** → рекурсивный подmerge по всем ключам;
- **array в patch** → **replace** целиком (никаких append; предсказуемо, без магии §25.2);
- **scalar в patch** → override;
- **null в patch** → replace значением `null`;
- **base не plain-object** (null / отсутствует / массив / скаляр) → заменяется значением patch целиком;
- **новые ключи** patch добавляются в результат;
- merge возвращает **новый** объект; исходные `resource` и patch не мутируются (входные данные `readonly`); паттерн — non-mutating, общие поддеревья base, не тронутые patch, сохраняются как ссылки (иммутабельно, безопасно).

Точное правило: **рекурсивный merge применяется тогда и только тогда, когда ОБА значения — plain objects; во всех остальных случаях значение из patch заменяет base.** Merge total на JSON-дереве → никогда не «падает» → кода `EXT_MERGE_ERROR` **не существует** (осознанно; см. Error Codes).

### 4. `applyExtensions` — чистый transform + validation (для 020 `ycsf check`)

```typescript
interface ExtensionRule {
  readonly target: string;
  readonly patch: Record<string, unknown>;
}

interface ExtensionsYaml {
  readonly version: 1;
  readonly extensions: readonly ExtensionRule[];
}

type ApplyExtensionsResult =
  | { readonly kind: 'ok'; readonly resources: readonly TerraformResource[] }
  | { readonly kind: 'invalid'; readonly errors: readonly ExtensionsDiagnostic[] };
```

Функция `applyExtensions(resources: readonly TerraformResource[], extensions: ExtensionsYaml): ApplyExtensionsResult`.

Двухфазная семантика (паттерн фазы 1 spec 014):

- **Фаза validation (collect-all, all-or-nothing)**: строится IDL-индекс; собираются (1) дубликаты target (`EXT_DUPLICATE_TARGET`, в порядке появления) и (2) все неразрешённые target (`EXT_UNRESOLVED_TARGET`, в порядке файла, каждый с доступными IDL). Если есть хотя бы одна ошибка → `kind:'invalid'` со ВСЕМИ собранными ошибками; **ни один patch не применяется**.
- **Фаза apply (детерминированная)**: правила применяются **в порядке файла**; каждое к своему уникальному ресурсу (дубликаты ban → каждый target ровно один раз). Результат — новый массив ресурсов с теми же `kind`/`type`/`name`, у каждого таргетированного изменён только `configuration`.

### 5. `loadExtensions` — loader (паттерн spec 011/014)

```typescript
type ExtensionsLoadResult =
  | { readonly kind: 'ok'; readonly data: ExtensionsYaml }
  | { readonly kind: 'invalid'; readonly errors: readonly ProjectModelDiagnostic[] };
```

Функция `loadExtensions(rootDir: string): ExtensionsLoadResult`.

- Файла нет → **throw** `Error('missing .ycsf/extensions.yaml (EXT_MISSING_FILE)')` — симметрично `loadProjectModel` (spec 011: missing apps.yaml — throw) и `loadRegistry` (spec 013: `BRG_MISSING_FILE` — throw). Присутствие файла решает оркестратор (021): проект без extensions просто не вызывает loader.
- Структурные ошибки (версия, форма, YAML-синтаксис, duplicate YAML-keys) → `kind:'invalid'` со **всеми** собранными diagnostics (collect-all), тип — переиспользуемый `ProjectModelDiagnostic` (file/line/column/field; паттерн registry `diag`).
- Дубликаты `target` **в** loader НЕ проверяются (это зона validation `applyExtensions` — единая точка входа для 020 check; см. FR-005).

### 6. Интеграция с 014

- Вход `applyExtensions` = `DispatchResultOk.resources` (output dispatch 014); выход = patched `TerraformResource[]`, который сериализуется **без изменений** serializer-ом 014 (deep-merged `configuration` — обычный JSON-объект; кей-сортировка из FR-009/014 обеспечивает стабильные байты).
- **015 не меняет ни contract 002, ни dispatch/serialize 014**: ни сигнатур, ни полей. Это чистый transform + loader + resolution.
- Точка врезки «dispatch → applyExtensions → serialize», а также передача extensions в диспетч-пайплайн (например, через расширение `DispatchOptions` в 021) — **оркестрация CLI 021** (вне scope 015). Наблюдаемый инвариант для 021: байты `.tf.json` равны сериализации merged `configuration`; serialization-утилиты 014 (`serializeResourceFile` / `serializeResource`) экспортируются из materialize-модуля и переиспользуемы.
- Validation-функция для `ycsf check` (020): это сам `applyExtensions` — он возвращает `EXT_UNRESOLVED_TARGET`/`EXT_DUPLICATE_TARGET`, когда target не существует в generated model. Проводка 020/021 — вне 015.

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| Terraform `*_override.tf` семантика | заменяется extensions-механизмом (весь смысл фичи); override-файлы C не читает | — |
| Чтение/анализ user `*.tf` | Constitution IV: C никогда не читает и не анализирует `*.tf` (IDEA §25.6) | — |
| Интерполяция `{{$ENV}}` | build-time концепция spec 012; в extensions не применяется и не валидируется (FR-011) | 012 |
| Валидация `${...}` | Terraform owns expression validation; C не моделирует provider schema | Terraform |
| `.ycsf/outputs.yaml`, auto-generated outputs | spec 016 | 016 |
| Команда `ycsf check` / CLI-оркестрация | resolution-функция есть (applyExtensions); команда/проводка — 020/021 | 020, 021 |
| Изменения dispatch/serialize (014) или contract 002 | 015 аддитивен; врезка — оркестрация 021 | 021 |
| Multi-resource per app | dispatch 014 — один app → один resource; multi-resource — 019 | 019 |
| Real materializer-пакеты | fixture-материализаторы в тестах (как 014); domain-таблица расширяется в 019 | 019 |
| Содержимое patch против provider schema | C не моделирует provider schema; `terraform validate` | Terraform |

---

## User Scenarios & Testing

### User Story 1 — DevOps расширяет сгенерированную функцию (env vars, timeout, service account) (Priority: P1)

Диспатч сгенерировал `yandex_function.user_service` с `configuration: { name, runtime, entrypoint, environment: { NODE_ENV: "production" }, execution_timeout: "5s" }`. DevOps хочет добавить переменную окружения, поднять timeout и привязать service account, не трогая код materializer и не используя override.

**Why this priority**: Основной happy path §25. Без него фича бесполезна как альтернатива `*_override.tf`.

**Independent Test**: fixture materializer (как в 014) возвращает `TerraformResource{type:'yandex_function', name:'user_service', configuration:{environment:{NODE_ENV:'production'}, execution_timeout:'5s'}}`; `applyExtensions(resources, {version:1, extensions:[{target:'functions.user_service', patch:{environment:{CUSTOM_VAR:'value'}, execution_timeout:'30s', service_account_id:'${yandex_iam_service_account.custom.id}'}}]})`.

**Acceptance Scenarios**:

1. **Given** resource `yandex_function.user_service` c `environment.NODE_ENV='production'` и `execution_timeout='5s'`, **When** applyExtensions с patch `{ environment:{CUSTOM_VAR:'value'}, execution_timeout:'30s', service_account_id:'${yandex_iam_service_account.custom.id}' }`, **Then** result.kind === 'ok'; `configuration.environment` содержит **обе** переменные (`NODE_ENV` и `CUSTOM_VAR`); `configuration.execution_timeout === '30s'`; `configuration.service_account_id === '${yandex_iam_service_account.custom.id}'` байт-в-байт.
2. **Given** то же, **When** результат сериализован serializer-ом 014, **Then** `.tf.json` содержит merged-конфигурацию и валиден как JSON (keys отсортированы).

---

### User Story 2 — Array replace: `custom_domains` заменяется, а не дописывается (Priority: P1)

У `yandex_api_gateway.openapi` в `configuration.custom_domains` уже есть один домен (сгенерирован). DevOps патчит `custom_domains` своим списком. Terraform `*_override.tf`-семантика заменяла бы весь nested block грубо; здесь важно, что **массив заменяется целиком, без append** (§25.2).

**Why this priority**: Контрактная семантика merge для массивов — «predictable, no magic append»; проверка именно replace, а не concat — центральное требование.

**Independent Test**: ресурс с `custom_domains:[{domain_id:'a'}]`, patch `custom_domains:[{domain_id:'${yandex_api_gateway_domain.main.id}'}]` → в результате ровно 1 элемент = patch-массив.

**Acceptance Scenarios**:

1. **Given** resource `gateways.openapi` c `configuration.custom_domains = [{domain_id:'a'}]`, **When** applyExtensions c patch `custom_domains:[{domain_id:'${yandex_api_gateway_domain.main.id}'}]`, **Then** результат `configuration.custom_domains.length === 1` и равен patch-массиву (replace, не `[{domain_id:'a'}, {domain_id:'...'}]`).
2. **Given** тот же ресурс, patch не содержит ключа `custom_domains`, **Then** `configuration.custom_domains` остаётся исходным массивом без изменений (нет по умолчанию чистки).

---

### User Story 3 — Опечатка в target → ошибка со списком доступных IDL (Priority: P1)

DevOps написал `functions.user_servivce` (опечатка). `applyExtensions` возвращает `EXT_UNRESOLVED_TARGET` с target и списком доступных IDL — пользователь сразу видит, какие ресурсы реально сгенерированы.

**Why this priority**: Главное преимущество над override — C валидирует target (IDEA §25, колонка «Валидация»). Без этого опечатка молча уходит в `terraform plan`.

**Independent Test**: ресурсы `yandex_function.user_service`, `yandex_function.analytics`, `yandex_api_gateway.openapi`; target `functions.user_servivce` → invalid.

**Acceptance Scenarios**:

1. **Given** массив ресурсов с IDL `functions.user_service`, `functions.analytics`, `gateways.openapi`, **When** applyExtensions с target `functions.user_servivce`, **Then** result.kind === 'invalid'; errors содержит `EXT_UNRESOLVED_TARGET`; message содержит target `functions.user_servivce` и доступные IDL `functions.analytics`, `functions.user_service`, `gateways.openapi` (алфавитный детерминированный порядок).
2. **Given** тот же сценарий, **When** в том же extensions-файле есть ещё один (валидный) target, **Then** НИ один patch не применён (all-or-nothing): второй валидный target не патчит свой ресурс.

---

### User Story 4 — Дубликат target в файле → ошибка (Priority: P1)

DevOps случайно объявил `target: "functions.user_service"` в двух правилах. Это конфликт, не silent merge.

**Why this priority**: Constitution V (fail-fast над магией; collision = error). В репо прецеденты: `MTL_COLLISION`, `MTL_OUTPUT_NAME_COLLISION`, `PML_DUPLICATE_APP_ID`, `BRG_KEY_COLLISION` — везде error, не merge. Последовательный merge сделал бы результат зависимым от порядка правил — скрытая магия; ошибка делает поведение order-independent.

**Acceptance Scenarios**:

1. **Given** extensions-файл с двумя правилами: оба `target:'functions.user_service'` (разные patch), **When** applyExtensions, **Then** result.kind === 'invalid'; errors содержит `EXT_DUPLICATE_TARGET` с этим target.
2. **Given** то же, **When** в файле есть валидный target на другой ресурс, **Then** ни один patch не применён (включая недублирующиеся) — fail-fast до apply.

---

### User Story 5 — User-owned `.tf` не тронут (Priority: P1)

Пользователь держит в `infra/` обычный Terraform: `yandex_iam_service_account.custom`, `yandex_function_iam_binding.users`. Extensions применяются только к generated resources; C не читает и не модифицирует `.tf`.

**Why this priority**: Constitution IV (C никогда не читает/анализирует user `.tf`, IDEA §25.6). Граница фичи; нарушение = нарушение constitution.

**Independent Test**: `applyExtensions` вызывается на массиве resources; рядом лежат `.tf` файлы; результат не зависит от их содержимого и не трогает их (только transform над памятью).

**Acceptance Scenarios**:

1. **Given** ресурсы `yandex_function.user_service` и отдельный user `*.tf` в том же проекте, **When** applyExtensions, **Then** результат определяется только `resources` + extensions.yaml; user `.tf` не читается (нет I/O в `applyExtensions`), не изменяется, не удаляется.
2. **Given** configured resource в region, где user `.tf` объявляет `yandex_iam_service_account.custom`, **When** patch содержит `service_account_id:'${yandex_iam_service_account.custom.id}'`, **Then** строка проходит как есть (passthrough, FR-010); C не пытается понять/проверить ссылку.

---

### User Story 6 — Детерминизм повторных запусков (Priority: P1)

Одинаковые входные данные (resources + extensions.yaml) → одинаковый результат: эквивалентные `configuration` и одинаковые байты `.tf.json`.

**Why this priority**: Детерминизм — базовое требование (как SC-003 в 014); diff-based workflows (git, CI) зависят от стабильности байт.

**Independent Test**: два вызова `applyExtensions` с одинаковыми входными → deep-equal результаты; сериализация → одинаковые байты.

**Acceptance Scenarios**:

1. **Given** одинаковые resources и extensions, **When** applyExtensions вызван дважды, **Then** оба `result.resources` глубоко равны (configuration структурно идентичны).
2. **Given** то же, **When** оба результата сериализованы serializer-ом 014, **Then** байты `.tf.json` идентичны.

---

### User Story 7 — Ошибки версии и структуры файла (Priority: P2)

DevOps написал `version: 2`; или забыл `extensions:`; или `patch` сделал списком. `loadExtensions` возвращает понятные диагностики.

**Why this priority**: Формат-контракт (Constitution III — version), fail-fast-структура; ошибки конфигурации нужно показывать рано и полно.

**Independent Test**: «сырые» тексты YAML подаются в loader; проверяются коды.

**Acceptance Scenarios**:

1. **Given** `.ycsf/extensions.yaml` c `version: 2`, **When** loadExtensions, **Then** kind 'invalid', errors содержит `EXT_VERSION`.
2. **Given** файл c `version: 1` без ключа `extensions`, **When** loadExtensions, **Then** kind 'invalid', errors содержит `EXT_INVALID` (missing 'extensions').
3. **Given** файл c `patch: "not-an-object"` или target `"functions/user_service"` (дефис/слеш/три сегмента), **When** loadExtensions, **Then** kind 'invalid', errors содержит `EXT_INVALID`; несколько структурных ошибок собираются вместе (collect-all).

---

### User Story 8 — Пустой patch, пустой список, новые ключи, отсутствующий файл (Priority: P2)

Крайние случаи формата: `patch: {}` — no-op; `extensions: []` — no-op; patch добавляет новый top-level ключ; файла нет вообще — проект просто без расширений.

**Why this priority**: Границы формата; детерминированное поведение без сюрпризов.

**Independent Test**: 4 отдельных вызова: (a) пустой patch, (b) пустой список, (c) добавление нового ключа, (d) loader без файла.

**Acceptance Scenarios**:

1. **Given** rule с `patch: {}`, **When** applyExtensions, **Then** result.kind === 'ok'; `configuration` структурно равна исходной (no-op).
2. **Given** extensions c `extensions: []`, **When** applyExtensions, **Then** result.kind === 'ok'; resources идентичны входным (identity transform).
3. **Given** ресурс без ключа `tags`, patch `{tags:{main:'http'}}`, **When** applyExtensions, **Then** `configuration.tags === {main:'http'}` (новый ключ добавлен).
4. **Given** в проекте нет `.ycsf/extensions.yaml`, **When** вызван `loadExtensions(rootDir)`, **Then** брошено `Error` с кодом `EXT_MISSING_FILE` (наличие файла решает оркестратор 021; проект без extensions не вызывает loader).

---

### Edge Cases

- **Empty patch (`patch: {}`)**: no-op; ресурс не меняется (US8 AC1).
- **Empty extensions (`extensions: []`)**: identity transform (US8 AC2).
- **Nested array replace внутри вложенного объекта**: base `{a:{list:[1,2,3]}}`, patch `{a:{list:[4]}}` → оба plain objects на уровне `a` → рекурсивно; `list` — массив в patch → replace → `{a:{list:[4]}}` (не `[1,2,3,4]`).
- **Patch в base null / отсутствующий ключ**: base `{a:null}`, patch `{a:{x:1}}` → base не plain object → replace → `{a:{x:1}}`; base отсутствует → ключ добавляется (US8 AC3).
- **Patch-массив поверх base-массива**: replace целиком (US2).
- **Patch c null-значением**: base `{a:'old'}`, patch `{a:null}` → `{a:null}`.
- **Target с 1 или 3+ сегментами, пустым сегментом или не-lowercase**: `functions`, `functions.user_service.extra`, `Functions.user_service`, `functions.user-service` → `EXT_INVALID` (грамматика IDL: два сегмента `[a-z][a-z0-9_]*`).
- **Грамматически валидный, но несуществующий домен**: `containers.user_service` при таблице без домена `containers` → `EXT_UNRESOLVED_TARGET` (resolution-level, message показывает доступные IDL).
- **Target без совпадающего ресурса**: → `EXT_UNRESOLVED_TARGET` (US3).
- **Дубликат YAML-ключа внутри одного правила** (`patch: {environment: {A: 1, A: 2}}`): ловится parse-gate `uniqueKeys` → `EXT_INVALID` (структурная, а не merge).
- **Дубликат target в двух правилах**: → `EXT_DUPLICATE_TARGET` (US4).
- **Два ресурса с одним IDL** (нарушение инварианта 014): defensive `EXT_INVALID` «duplicate IDL <idl> in generated model»; по construction непроизводимо (один app → один resource, таблица доменов 1:1).
- **Ресурс с типом вне таблицы** (например, будущий вторичный ресурс 019): не адресуем, не ошибка; в ok-результат попадает без изменений.
- **Configuration таргетированного ресурса не plain-object** (materializer вернул не-mapping): defensive `EXT_INVALID` (вход extensions предполагает JSON-object configuration); не таргетированные ресурсы не проверяются.
- **Циклы в данных**: невозможны по data-model — YAML/JSON — дерево (assumption); deep merge не обрабатывает циклы.
- **Порядок ошибок resolution**: детерминированный — duplicate targets сначала (по появлению), затем unresolved в порядке файла.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST поддерживать файл `.ycsf/extensions.yaml` формата `version: 1` с обязательным ключом `extensions` — списком правил `{ target: string, patch: mapping }` (US7, US8; §25).
- **FR-002**: `loadExtensions(rootDir)` MUST выбрасывать `Error` с кодом `EXT_MISSING_FILE`, если `.ycsf/extensions.yaml` отсутствует; наличие файла решает оркестратор 021 (паттерн `BRG_MISSING_FILE` / spec 011).
- **FR-003**: System MUST отклонять отсутствующий или отличный от `1` `version` → diagnostic `EXT_VERSION` (Constitution III).
- **FR-004**: System MUST отклонять структурно невалидные файлы → diagnostics `EXT_INVALID`, собираемые для ВСЕХ найденных ошибок (collect-all): YAML-синтаксис, duplicate YAML-keys (parse-gate `uniqueKeys`), отсутствие/не-список `extensions`, элемент не mapping, отсутствие/лишние ключи правила, `target` не строка или нарушение IDL-грамматики (два сегмента `[a-z][a-z0-9_]*`), `patch` не plain-object mapping (US7).
- **FR-005**: System MUST отклонять повторение одного `target` в файле → diagnostic `EXT_DUPLICATE_TARGET` на этапе validation `applyExtensions` (fail-fast, Constitution V; прецеденты MTL_COLLISION / MTL_OUTPUT_NAME_COLLISION / PML_DUPLICATE_APP_ID). Последовательный merge в этой ситуации запрещён — результат был бы зависим от порядка правил.
- **FR-006**: System MUST строить детерминированный IDL-индекс из входных `TerraformResource`: для каждого ресурса `idl = domain.name`, где `domain = IDL_DOMAIN_BY_TF_TYPE[resource.type]`, `name = resource.name`; ресурсы с типом вне таблицы в индекс не попадают (не адресуемы; не ошибка сами по себе).
- **FR-007**: System MUST разрешать каждый `target` ровно к одному ресурсу по правилу `idl(resource) === target`; каждый неразрешённый target → `EXT_UNRESOLVED_TARGET` с message (target + доступные IDL в алфавитном порядке); resolution-ошибки собираются для ВСЕХ правил до применения любого patch (all-or-nothing); при наличии ошибок ни один patch не применяется (US3).
- **FR-008**: System MUST применять deep merge `patch` → `resource.configuration` по семантике: оба значения — plain-object → рекурсивный merge; значение из patch (array/scalar/null) → replace; base не plain-object → replace; новые ключи добавляются; исходные ресурсы и patch не мутируются, возвращаются новые объекты (US1, US2, US8 AC3; §25.2).
- **FR-009**: System MUST применять правила в порядке файла; каждый `target` применяется ровно один раз (гарантируется FR-005).
- **FR-010**: System MUST НЕ обрабатывать и НЕ валидировать `${...}` в значениях patch — строки передаются без изменений (passthrough; Terraform owns expression validation) (US1 AC1, US5 AC2; §25.3).
- **FR-011**: System MUST НЕ обрабатывать и НЕ валидировать `{{$ENV}}` в значениях patch — значения остаются литералами; интерполяция — build-time концепция spec 012, к extensions неприменима (§25.3).
- **FR-012**: System MUST сохранять `kind`, `type`, `name` ресурса без изменений при применении patch; меняется только `configuration` (US1).
- **FR-013**: System MUST трактовать пустой `patch: {}` и пустой список `extensions: []` как no-op: ok, ресурсы без изменений (US8 AC1/AC2).
- **FR-014**: System MUST применять extensions ТОЛЬКО к generated resources (output dispatch 014); НЕ читать, НЕ изменять и НЕ удалять user `*.tf`; НЕ выполнять builders; НЕ использовать Terraform override-семантику (US5; Constitution I/IV; §25).
- **FR-015**: System MUST НЕ валидировать содержимое значений `patch` против provider schema (Constitution IV: C не моделирует provider schema; глубокую валидацию выполняет `terraform validate`); проверяется только structure, необходимая для merge.

### Error Codes (EXT_* family)

| Code | Condition | Phase |
|------|-----------|-------|
| `EXT_MISSING_FILE` | `.ycsf/extensions.yaml` отсутствует при вызове `loadExtensions` (throw, паттерн `BRG_MISSING_FILE`) | Load |
| `EXT_VERSION` | отсутствует или не равен `1` `version` (Constitution III) | Load |
| `EXT_INVALID` | Структура: YAML-синтаксис / duplicate YAML-keys / нет-или-не-список `extensions` / правило не mapping / нет-или-лишние ключи / target не IDL-грамматика / patch не mapping; defensive: duplicate IDL в индексе; configuration таргетированного ресурса не object | Load + Validate |
| `EXT_UNRESOLVED_TARGET` | target не разрешается ни к одному generated resource (message: target + доступные IDL в алфавитном порядке), включая грамматически валидный, но несуществующий домен | Validate (applyExtensions / 020 check) |
| `EXT_DUPLICATE_TARGET` | один `target` объявлен в файле более одного раза (fail-fast, Constitution V) | Validate (applyExtensions) |

Кода `EXT_MERGE_ERROR` **нет** (осознанно): deep merge total на JSON-дереве (YAML → данные без циклов/экзотики), «упасть» ему нечему; вводить код, который фича не производит, запрещено правилами формата.

### Key Entities

- **ExtensionRule**: `{ target: string, patch: Record<string, unknown> }` — одно правило расширения. `target` — IDL (`domain.name`); `patch` — JSON-дерево (YAML-tree), применяемое к `resource.configuration`.
- **ExtensionsYaml**: `{ version: 1, extensions: readonly ExtensionRule[] }` — содержимое `.ycsf/extensions.yaml` (formatted contract, Constitution III).
- **IDL** (logical identity, §16): стабильный логический идентификатор ресурса `domain.name` (`functions.user_service`, `gateways.openapi`); в отличие от IDT (`yandex_function.user_service`) устойчив к rename. Грамматика сегментов — как у `ResourceReference` 002: `[a-z][a-z0-9_]*`.
- **IDL_DOMAIN_BY_TF_TYPE**: нормативная side-table C (решение 015) «Terraform resource type → IDL domain»: `yandex_function` → `functions`, `yandex_api_gateway` → `gateways`. Аддитивная расширяемость — spec 019. Ресурсы с типом вне таблицы не IDL-адресуемы.
- **ExtensionsDiagnostic**: `{ code, message, target?, file?, field?, line?, column?, availableIdls? }` — диагностика resolution/validation (`EXT_UNRESOLVED_TARGET` несёт `availableIdls`). Структурные diagnostics loader-а переиспользуют `ProjectModelDiagnostic` из 011 (паттерн registry).
- **ExtensionsLoadResult**: `{ kind:'ok', data: ExtensionsYaml } | { kind:'invalid', errors }` — результат `loadExtensions` (не бросает validation, бросает только `EXT_MISSING_FILE`).
- **ApplyExtensionsResult**: `{ kind:'ok', resources } | { kind:'invalid', errors }` — результат `applyExtensions` (ok = patched `TerraformResource[]`).
- **DeepMerge**: семантика (не сущность) — рекурсивный merge только между двумя plain-object; array/scalar/null из patch → replace; base не object → replace; non-mutating.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Детерминизм: одинаковые `resources` + одинаковый `extensions.yaml` → структурно равные `configuration` и идентичные байты `.tf.json` при повторном применении и сериализации (US6; ◦ FR-009).
- **SC-002**: Каждый `target` валидируется против generated model: неразрешённый target → `EXT_UNRESOLVED_TARGET` с доступными IDL; при любой ошибке resolution/duplicate ни один patch не применяется (all-or-nothing) (US3/US4; FR-005/FR-007).
- **SC-003**: User `.tf` не затрагивается: extensions применяются только к выходу dispatch; `applyExtensions` не читает и не пишет файлы; user `.tf` никогда не модифицируется и не удаляется (US5; FR-014).
- **SC-004**: Массивы заменяются, а не дописываются: в любом acceptance-сценарии c patch-массивом результат — replace целиком (US2; FR-008).
- **SC-005**: Deep merge соответствует §25.2 точно: object+object → recursive, array → replace, scalar → override; null-и-отсутствующие base → replace/добавление; новые ключи добавляются; исходные данные не мутируются (US1/US8; FR-008).
- **SC-006**: Контракт файла enforcement: `version: 1` обязателен (EXT_VERSION), структура обязательна (EXT_INVALID), duplicate target → ошибка (EXT_DUPLICATE_TARGET), пустые patch/список — no-op (US7/US8; FR-003/FR-004/FR-005/FR-013).
- **SC-007**: `${...}` и `{{$ENV}}` значения не обрабатываются: результат содержит их байт-в-байт (passthrough); никакой интерполяции/валидации в 015 (US1 AC1/US5 AC2; FR-010/FR-011).
- **SC-008**: 100% acceptance criteria spec 015 покрыты тестами (Constitution II); каждый AC → минимум один тест; тесты подтверждают RED → GREEN.

---

## Assumptions

- **Механизм IDL↔resource (решение 015)**: side-table `IDL_DOMAIN_BY_TF_TYPE` (C-owned, explicit, Constitution V) как в Scope (2). Поле `idl?` на `TerraformResource` отвергнуто (обоснование в таблице Scope (2)): оно требует от каждого materializer-плагина декларировать IDL — это выдумывание internals плагинов (honesty) и ненужное расширение contract 002.
- **`${...}` passthrough**: 015 не парсит и не валидирует Terraform-выражения; семантика — у Terraform (Constitution IV). Если выражение синтаксически невалидно — это минус `terraform validate`.
- **`{{$ENV}}` не интерполируется**: extensions — не build-контекст (012 занимается build-env); в extensions значение остаётся литералом. Сохранение байт-в-байт — безопасное поведение «не трогаем то, что не наше».
- **`.ycsf/extensions.yaml` — опциональный проект test**: отсутствие файла — валидное состояние; `EXT_MISSING_FILE` бросается loader-ом только если его вызвали без файла; наличие файла — решение оркестратора 021.
- **Один app → один resource (014)**: IDL уникален по construction (resource.name уникален в пределах типа; таблица доменов 1:1). Нарушение — defensive `EXT_INVALID`, непроизводимо.
- **Configuration и patch — JSON-деревья**: после YAML-парсинга — только plain objects, массивы, скаляры, null; циклы невозможны; нет `undefined`/функций/Date. Следствие — merge total, код `EXT_MERGE_ERROR` не вводится.
- **Таблица доменов 1:1 и её рост**: сейчас два домена; добавление доменов (spec 019) — аддитивное расширение таблицы (не breaking). Домен, не в таблице сегодня, но появившийся завтра, — сегодня даст `EXT_UNRESOLVED_TARGET`, завтра сработает: поведение conservative и честное.
- **Сериализация не меняется (014)**: merged `configuration` сериализуется как любой другой object; кей-сортировка FR-009/014 гарантирует стабильные байты. 015 не вводит собственную сериализацию.
- **Extensions не менять dispatch (014)**: никаких правок сигнатур/полей 002/014; врезка в пайплайн — оркестрация 021 (вне scope).
- **Fixture materializers в тестах** (как 014); real materializers — 019. Fixture возвращает `yandex_function`/`yandex_api_gateway` — типы из домен-таблицы.

---

## References

- Spec 002: pilot-contracts — `TerraformResource`, `ResourceReference` (IDL-грамматика сегментов)
- Spec 014: materializer-dispatch — `DispatchResultOk.resources`, `DispatchDiagnostic`, serializer, паттерн двухфазного fail-fast
- Spec 009: resource-references — модель IDL/IDT/IDR (Project B → A/C шов)
- IDEA.md §16: IDL / IDT / IDR (logical identity = `domain.name`)
- IDEA.md §25: `.ycsf/extensions.yaml` — формат, merge semantics, почему не override, user `.tf` (C не читает)
- IDEA.md §26: outputs — согласование IDL → Terraform expression resolution
- Constitution III: contracts versioned (`version: 1`); IV: C не моделирует provider schema, не читает user `.tf`; V: explicit over magic (collision = error, no silent merge); I: C владеет orchestration/build

---

## Next Steps

1. `/speckit.plan` — технический дизайн: `src/contracts/extensions.ts` (type-only + `EXT_*`), `src/extensions/` (loader, resolver, deep-merge), IDL-индекс, точка врезки в 021.
2. `/speckit.tasks` — задачи в test-first: контракты → deep merge (RED→GREEN) → IDL-resolution → loader → `applyExtensions` → edge cases.
3. `/speckit.implement` — код и тесты по acceptance criteria; lint, typecheck.