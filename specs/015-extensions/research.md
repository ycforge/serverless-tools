# Research: extensions — `.ycsf/extensions.yaml`, IDL-адресация, deep merge

## Decisions & Rationale

### 1. Где живёт side-table `IDL_DOMAIN_BY_TF_TYPE` и как расширяется

**Decision**: `IDL_DOMAIN_BY_TF_TYPE` — **hardcoded, C-owned константа в runtime-модуле `src/extensions/idl.ts`**: замороженный `Readonly<Record<string, string>>` с каноническими парами `yandex_function → functions`, `yandex_api_gateway → gateways`. Расширение — **аддитивное, только будущими спеками** (spec 019 добавит домены для real materializer-пакетов). Никакого registry-пути, конфига или API «зарегистрировать домен» в v1.

**Rationale**:
- Spec (Scope 2, решение 015) явно говорит «**C-owned side-table**» и сравнивает с альтернативой `TerraformResource.idl?` — поле отвергнуто (добавляло бы internals-требование к каждому плагину). Константа в коде C — самый честный вариант: C владеет соглашением о доменах сгенерированных ресурсов и декларирует его одной нормативной таблицей (Constitution V: explicit).
- Домен вне таблицы сегодня, но появившийся завтра — сегодня даёт `EXT_UNRESOLVED_TARGET`, завтра начнёт резолвиться (spec Assumption): поведение conservative и аддитивное; hardcoded-таблица этому не мешает (добавление пары — не-breaking).
- Таблица 1:1 (тип → домен) по construction dispatch 014 (один app → один resource) → IDL уникален; таблица не содержит обратного mapping (домен → тип), обратный путь не нужен ни одной функции 015.

**Alternatives Considered**:
- **Поле `TerraformResource.idl?`** (contract 002): отвергнуто spec-решением — расширяет contract 002 и требует от материалайзеров декларировать C-соглашение.
- **Extensible/plugin-registered таблица** (материализаторы при загрузке декларируют домены, registry накапливает): отвергнуто — C не должен зависеть от runtime-плагинов для собственной адресации (plugin может не загрузиться, порядок загрузки добавил бы недетерминизм, дубли доменов потребовали бы новый код коллизии). Вдобавок spec Assumption фиксирует «side-table C», а 2134-паттерн «domain — договорённость C, не плагина».
- **Конфигурационный файл доменов** (напр. отдельный `.ycsf/idl.yaml`): отвергнуто — новый формат-контракт ради двух строк; Constitution III требует версионировать каждый `.ycsf/*.yaml`, а выгоды нет.
- **Инверсия — меппинг домен→тип**: не нужна; резолвится только target→resource через индекс `idl(resource) === target`.

### 2. Условие рекурсии deep merge — `isPlainObject` на обоих значениях

**Decision**: Рекурсия применяется **тогда и только тогда, когда ОБА значения — plain objects** (в смысле `isPlainObject`: `typeof === 'object'`, не `null`, не массив, и прототип — `Object.prototype` или `null`). Во всех остальных случаях значение из patch **заменяет** base (массив, скаляр, `null`, `undefined`-нет, отсутствующий ключ → добавить ключ). Это ровно правило FR-008/§25.2. `deepMerge` — `function deepMerge(base: unknown, patch: unknown): unknown`, non-mutating, возвращает новый объект; поддеревья base, не затронутые patch, переиспользуются по ссылке (иммутабельно).

**Rationale**:
- Spec (Scope 3) даёт точное правило: «recursive merge применяется тогда и только тогда, когда ОБА значения — plain objects; во всех остальных случаях значение из patch заменяет base». После YAML-парсинга данные — только plain objects/arrays/scalars/null (спец Assumption), поэтому guard «проверить, что оба — plain objects» покрывает все реальные случаи и делает merge **total**: падать нечему → кода `EXT_MERGE_ERROR` нет (spec Error Codes; запрещено вводить непроизводимый код).
- `null`/массив/скаляр в base не могут быть рекурсивно смержены — replace (US2 AC2: base-массив без patch-ключа остаётся нетронутым; при patch-массиве — replace целиком).
- Проверка прототипа (а не `typeof === 'object'` отдельно) исключает массивы и class-instances; после YAML это defensive, но делает функцию честной для любых входов.

**Alternatives Considered**:
- Рекурсия по любому object (class instances, Map/Set): отвергнуто — после YAML таких значений нет, а general object-merge дал бы нетривиальную семантику для не-JSON данных; plain-object guard — спецификация «merge на JSON-дереве».
- Рекурсия по массивам (по-элементно) или append: отвергнуто §25.2/US2 — «Array: replace (predictable, no magic append)»; append сделал бы результат зависимым от порядка и от содержимого base.
- Мутация base на месте: отвергнуто — FR-008 «исходные ресурсы и patch не мутируются»; разделяемое изменение сломало бы повторные запуски dispatch-выхода (US6).

### 3. Parse-gate: переиспользовать `parseYaml` или свой парсер

**Decision**: **Свой `parseExtensionsYaml`** в `src/extensions/extensions-yaml.ts`, повторяющий паттерн spec 013 `parseBuildersYaml`: `parseDocument(text, { uniqueKeys: true })` (та же parse-gate техника 011/014), но эмитирующий **`EXT_*` коды** (YAML-синтаксис и duplicate YAML-keys → `EXT_INVALID`; отсутствие/не-1 `version` → `EXT_VERSION`), через переиспользуемый **`diag()`-factory** из `src/model/errors.ts`. `parseYaml` (src/model/parse.ts) **не переиспользуется**: он хардкодит `PML_*` коды (`PML_PARSE`, `PML_DUPLICATE_KEY`, `PML_VERSION`) и возвращает `ProjectModelDiagnostic`, что не совпадает с EXT-семейством.

**Rationale**:
- Spec FR-004: «дубликаты YAML-ключей ловятся parse-gate `uniqueKeys`, паттерн 011/014 parseYaml» — «паттерн» означает сам приём (parseDocument с `uniqueKeys: true`, line/column в диагностику), не переиспользование конкретной функции с чужими кодами. Прецедент 013: `builders-yaml.ts` делает **свой** `parseDocument` с `BRG_DUPLICATE_KEY/BRG_INVALID/BRG_VERSION`, не вызывая `parseYaml`.
- Error Codes spec 015: `EXT_INVALID` покрывает «YAML-синтаксис / duplicate YAML-keys / …», отдельных кодов `EXT_PARSE`/`EXT_DUPLICATE_KEY` **нет** — оба мапятся в `EXT_INVALID` (в отличие от PML-семейства, где есть отдельные коды). Сообщение `error.message` из YAML-парсера сохраняется; line/column — по `error.linePos[0]`.
- `diag()` переиспользуется для единого shape (file/line/column/field; FR-015 паттерн) — research 5.

**Alternatives Considered**:
- Вызвать `parseYaml` и ремапить `PML_* → EXT_*`: отвергнуто — двойной маппинг кодов, потеря связи с исходным сообщением, плюс `PML_PARSE`/`PML_DUPLICATE_KEY` не существуют в EXT-каталоге (нечего мапить).
- Обобщить `parseYaml` параметром «code set»: отвергнуто — `parseYaml` — устоявшийся API 011 (PML), менять его сигнатуру ради 015 = ненужная правка; 013 уже показал прецедент автономного парсера для своего кода-семейства.
- Разобрать структуру без AST-парсера (ручной walk): отвергнуто — потеря line/column для диагностик (FR-015) и дубликат-детекции.

### 4. Дубликат target — ошибка, не последовательный merge

**Decision**: Повторение одного `target` в файле → **`EXT_DUPLICATE_TARGET`** на validation-фазе `applyExtensions`, собирается со всеми остальными ошибками (в порядке появления). **Последовательный merge двух правил с одним target запрещён** (результат зависел бы от порядка правил — скрытая магия).

**Rationale**:
- FR-005 прямое требование + Constitution V (collision = error, никогда silent merge). Прецеденты в репо: `MTL_COLLISION`, `MTL_OUTPUT_NAME_COLLISION`, `PML_DUPLICATE_APP_ID`, `BRG_KEY_COLLISION` — везде error, не merge; US4 AC1/AC2.
- Порядок ошибок детерминирован (spec Edge Case): duplicate targets — в порядке появления (по первому вхождению target в файле), затем unresolved — в порядке файла.

**Alternatives Considered**:
- Последовательный apply (второе правило мержится в результат первого): отвергнуто — результат зависит от порядка правил (недетерминизм по источнику), silent override; прямой конфликт с FR-005/Constitution V и US4.
- Последнее правило побеждает (last-wins): отвергнуто — то же самое: неявная семантика, order-dependent.
- Warning вместо error: отвергнуто — Constitution V, FR-005 (error, fail-fast).

### 5. Validate-first collect-all против streaming; порядок ошибок

**Decision**: `applyExtensions` — **двухфазный, validate-first, collect-all, all-or-nothing** (паттерн validation-фазы spec 014):

- **Validation-фаза**: (1) строится детерминированный IDL-индекс из входных `TerraformResource` (только ресурсы с типом из `IDL_DOMAIN_BY_TF_TYPE`; алфавитный сортированный список IDL для диагностик FR-007); (2) собираются `EXT_DUPLICATE_TARGET` (в порядке появления) и `EXT_UNRESOLVED_TARGET` (в порядке файла, каждый с `availableIdls`); (3) defensive `EXT_INVALID`: duplicate IDL в индексе («duplicate IDL <idl> in generated model») и `configuration` таргетированного ресурса не plain-object. Любая ошибка → `{ kind: 'invalid', errors: ВСЕ }`; **ни один patch не применяется**.
- **Apply-фаза**: только при чистой валидации; правила в порядке файла; каждый target ровно один раз; результат — новый массив ресурсов.

**Rationale**:
- FR-007/FR-005/FR-009 + US3 AC2/US4 AC2 явно требуют all-or-nothing: «при наличии ошибок ни один patch не применяется». Streaming (validate+apply по одному правилу) частично применил бы patch до обнаружения ошибки в более позднем правиле — нарушение атомарности и US3 AC2.
- Кидалось бы во время apply — на входе невалидная структура (но `ExtensionsYaml` уже прошёл loader; defensive-level). Validation-фаза дешёвая (O(resources) индекс + O(rules) резолв) — полный сбор ошибок бесплатен.
- Порядок «duplicates сначала, unresolved потом» зафиксирован spec Edge Case и делает вывод стабильным между запусками (SC-001).

**Alternatives Considered**:
- Stream (правило → validate → apply): отвергнуто — ломает all-or-nothing (US3 AC2: валидный второй target не патчит при ошибке в первом).
- Abort-on-first (первая ошибка останавливает): отвергнуто — FR-004/US7 AC3 требуют collect-all структурных ошибок; validate-first collect-all одинаков для всех фаз.
- Apply, а ошибки unresolved собирать в диагностику без abort: отвергнуто — FR-007 «resolution-ошибки собираются до применения любого patch; при наличии ошибок ни один patch не применяется».

### 6. Immutability: `applyExtensions` возвращает новый массив и новые объекты

**Decision**: `applyExtensions` **не мутирует входные данные** (входные параметры `readonly`): возвращает **новый массив** ресурсов; таргетированные ресурсы — **новые объекты** с теми же `kind`/`type`/`name` (FR-012) и новым `configuration` (результат `deepMerge`); нетаргетированные ресурсы переиспользуются **по ссылке** (иммутабельно, дёшево). `patch`-объекты тоже никогда не мутируются.

**Rationale**:
- FR-008 «исходные ресурсы и patch не мутируются, возвращаются новые объекты»; паттерн 014 — `dispatch` возвращает свежие объекты, не меняя входной `ProjectModel`. Determinism (US6) требует, чтобы повторные вызовы на тех же входах давали те же результаты — мутация входа сломала бы это (первый вызов испортил бы вход второго).
- Переиспользование нетаргетированных ресурсов по ссылке — безопасно (они readonly) и соответствует identity transform (US8 AC2).

**Alternatives Considered**:
- Мутация входа на месте (записать merged configuration в существующие объекты): отвергнуто — FR-008, US6 (immutable входы).
- Полная глубокая копия всех ресурсов: отвергнуто — лишние аллокации; нетаргетированные ресурсы не нуждаются в копии (readonly, shared-safe).

### 7. Неизвестные YAML-ключи — fail-fast `EXT_INVALID`, не ignore

**Decision**: Все неизвестные ключи отклоняются: на верхнем уровне файла допустимы ровно `version` и `extensions`; в правиле — ровно `target` и `patch`. Любой другой ключ (как на верхнем уровне, так и в правиле) → `EXT_INVALID`. Отсутствующие обязательные ключи — тоже `EXT_INVALID` (отсутствие `extensions` → `EXT_INVALID`; правило без `target`/`patch` или с лишним ключом → `EXT_INVALID`).

**Rationale**:
- Constitution V (explicit over magic): молча проигнорированный ключ — опечатка пользователя уйдёт в незаметный no-op (напр. `targets:` вместо `extensions:`), а потому это скрытая магия. FR-004 «лишние/отсутствующие ключи → `EXT_INVALID`» прямо покрывает правило; для топ-уровня spec не оговаривает поведение отдельно, но симметрия и V дают fail-fast.
- Структурная строгость не конфликтует с FR-015 (не моделируем provider schema): проверяем **только форму**, не содержимое значений patch.

**Alternatives Considered**:
- Ignore неизвестных ключей (forward-compatibility): отвергнуто — silent-ignore против V; будущие аддитивные ключи будут добавляться версионированием файла (`version`), а не игнором.
- Warning + continue: отвергнуто — нет warn-канала в result union; незаметное предупреждение хуже явной ошибки (V).

### 8. `patch` не plain-object mapping — `EXT_INVALID`

**Decision**: `patch` обязан быть plain-object mapping (YAML-таблица). Скаляр, список, `null`, отсутствие → `EXT_INVALID` (FR-004: «поле patch не mapping (например, скаляр/список/null)»). Значения внутри patch **не проверяются на provider-schema** (FR-015) — только типа-структура, нужная merge (object/array/scalar/null), и формат собирается из того, что пришло из YAML.

**Rationale**:
- FR-004/Scope 1 («patch — plain-object mapping; patch не mapping → EXT_INVALID») + US7 AC3 (`patch: "not-an-object"` → invalid). Empty `patch: {}` при этом валиден (US8 AC1: no-op).
- Тип-структура значений внутри patch не валидируется против провайдера — provider schema зона `terraform validate` (Constitution IV).

**Alternatives Considered**:
- Допустить `patch` скаляр/null (трактовать как replace всего configuration): отвергнуто — FR-004 явно запрещает (patch обязателен и mapping); замена configuration целиком на скаляр — бессмысленный сценарий, лучше явная ошибка.
- Валидировать значения patch против provider schema: отвергнуто — Constitution IV, FR-015 (C не моделирует provider schema).

### 9. Zero-dep контракты: `src/contracts/extensions.ts` + `contracts/extensions.json`

**Decision**: Публичные **type-only** типы (`ExtensionRule`, `ExtensionsYaml`, `ExtensionsDiagnostic`, `ExtensionsLoadResult`, `ApplyExtensionsResult`) и **чистые** `EXT_*` константы живут в **`src/contracts/extensions.ts`** (зеркало `registry.ts`/`materialize.ts`), реэкспортируются через `src/contracts/index.ts` → `@ycforge/pilot/contracts`. Новый каталог **`contracts/extensions.json`** зеркалит пять `EXT_*` кодов + JSON Schema `.ycsf/extensions.yaml` + shape `ExtensionsDiagnostic`. Runtime (`loadExtensions`, `applyExtensions`, `deepMerge`, resolver) — в `src/extensions/`; `src/contracts/` остаётся zero-runtime-dependency (`zero-dependency.test.ts`). `loadExtensions` + `applyExtensions` экспортируются из `src/index.ts` (паттерн `loadProjectModel`/`dispatch`).

**Rationale**:
- `EXT_*` — отдельное семейство от `PML_*`/`BRG_*`/`MTL_*` (новый домен ошибок: extensions-формат + resolution), поэтому свой каталог, не расширение project-model.json/materialize.json (паттерн 012/013/014 — каждое семейство отдельно).
- Spec Error Codes фиксирует ровно пять кодов; константы (не строковые литералы) — Constitution V; JSON-зеркало — конвенция репо (011–014).
- I/O и `yaml` — только в `src/extensions/`, никогда в `src/contracts/` (zero-dep).

**Alternatives Considered**:
- Расширить `contracts/materialize.json`/project-model.json кодом `EXT_*`: отвергнуто — семейства ортогональны (как MTL vs BRG в 013/014 research).
- Runtime-функции в `src/contracts/`: отвергнуто — нулевые runtime-зависимости контрактов (fs/yaml).
- Без JSON-каталога (только константы в TS): отвергнуто — конвенция репо (011–014) публикует каталог для tooling/CLI.

## Performance Considerations

- IDL-индекс: один проход по `resources` (O(resources)); сортировка IDL для диагностик — O(resources log resources) только при ошибке `EXT_UNRESOLVED_TARGET`.
- Validation: O(rules) резолвов по Map-индексу (O(1) lookup на idl).
- Deep merge: O(суммарного размера узлов patch), рекурсивно по общим поддеревьям; переиспользование нетронутых поддеревьев base по ссылке — без копий.
- `applyExtensions`/`deepMerge` — чистые, без I/O; единственный файловый доступ — `loadExtensions` (existsSync/readFileSync).

## Dependencies to Add

None. `yaml` уже в `packages/pilot`; `node:fs`/`node:path` — Node builtins; `src/contracts/` остаётся dependency-free; новых npm-пакетов нет.