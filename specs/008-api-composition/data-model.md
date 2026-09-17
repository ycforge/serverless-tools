# Data Model: api-composition — merge, конфликты, provenance, overrides, auth-применение (Project B)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/api-composition.md](./contracts/api-composition.md) | **Research**: [research.md](./research.md)

Сущности, правила (маппинг на FR-*) и невалидные состояния; фиксированная pipeline; документированные «не ошибки». Тело — русский, идентификаторы — английский.

## Entities

### Composition (openapi-приложение, единица компиляции)
Единица компиляции; одна композиция = один gateway-документ. Владеет общими `auth.yaml` (007) и `overrides.yaml` (global) в своём корне. Несколько композиций — независимые namespace (свои схемы auth, свои overrides, изолированные конфликты).

- `compositionRoot` — корень openapi-приложения (тот же `appRoot`, который 007 использует для чтения `auth.yaml`);
- входные артефакты: `auth.yaml` (обязателен, 007), `overrides.yaml` (опционален — отсутствие = нет глобальных правил);
- результат: ровно один `GatewayDocument` (артефакт типа по контрактам 002/019; имя ссылки `gateways.<app>` присваивается вне B).

### ComposerAppParticipant (участник)
Приложение-участник с `appRoot`.

- `appRoot` — корень приложения (источник 006-извлечения и `<appRoot>/overrides.yaml`);
- `openApi` — извлечённый 006 документ (неизменный; byte-parity, FR-014);
- `localOverrides` — `OverrideFile | null` из `<appRoot>/overrides.yaml` (опционален);
- инвариант: участники в запросе — явный список с уникальными `appRoot`; порядок ввода детерминирует порядок обработки, но НЕ результат (FR-017).

### OpenApiDocument (вклад 006)
Извлечённый, неизменный документ одного приложения; источник `paths`, `components` и operation-level `security`-метаданных (007). Per-app root `security`, `info`, `tags`, `servers` в gateway-документ НЕ переносятся (приватны; Assumptions «info шлюза»). `components.securitySchemes` приложений — обычные компоненты: вливаются как есть и участвуют в коллизии имён FR-006.

### PathOwnership (provenance, route→app) — внутренняя, не в артефакт (FR-003/017)
Происхождение маршрутов во время компиляции. См. research R2.

- `ownerByPath: Map<path, owner>` — `owner ∈ { appId, 'global' }`; строгий path-partition (FR-004) делает путь единицей владения: весь pathItem имеет одного владельца;
- `operationIdIndex: Map<operationId, { path, appId }>` — для локальной адресации `kind: operationId` и диагностики FR-005;
- `'global'` — пути, добавленные глобальным override (US3/AC2); локально добавленные пути — владелец приложение (FR-008);
- инвариант: provenance существует только на время компиляции, в `GatewayDocument` не попадает ни одним ключом/полем.

### MergeResult (промежуточный)
Слитые `paths` + `components` до auth-применения и overrides, плюс `PathOwnership`. Конфликты на этом этапе — fail-fast (см. rules).

### OverrideRule / OverrideAddress / OverrideFile (grammar, FR-007/008/010, research R3)
Правило = `op` (`'replace' | 'add' | 'remove'`) + адресуемая цель `target` + `value` (для replace/add). Уровни: global (`<compositionRoot>/overrides.yaml`) и local (`<appRoot>/overrides.yaml`).

- `kind ∈ { info, path, operation, operationId, component }`; `operation` требует `path` + `method` (строчная HTTP-method); `path` — строка пути (`pathItem`); `component` — `name`.
- `value` — opaque JSON-значение (проверяется только наличие для replace/add и отсутствие для remove на этапе grammar).
- Применение детерминированно: правила одного файла — последовательно по файлу; global файл применяется до local файлов участников; пересечение global↔local — приоритет local > global (FR-009), не конфликт.
- Атомарность (FR-010): `replace` кладёт value целиком, глубокого слияния с существующей целью нет.

### GatewayDocument (выходной артефакт, FR-002/003/017)
Скомпилированная спецификация API Gateway (одна на композицию).

- `openapi` — единый `openapi` участников (FR-016; значение не «выбирается», а наследуется единогласием);
- `info` — из global override (иначе fail-fast `COMPOSE_INFO_MISSING`);
- `paths` — объединение pathItems участников + override-правки; ключи канонически отсортированы;
- `components` — объединение компонентов участников + эмиссия `securitySchemes` (R6); ключи канонически отсортированы; секция опускается при пустоте;
- `security` — корневый только из `defaultScheme` при типе не-`none` (FR-011);
- НЕ содержит: provenance, per-app `info`/`tags`/`servers`/root-`security`, `${resources...}`-синтаксис, `x-yc-apigateway-integration` (FR-018);
- детерминизм: повторная компиляция и перестановка участников дают байт-идентичный документ.

### ComposeRequest / ComposeResult
- Request: `{ compositionRoot, apps: readonly ComposeApp[{ appRoot }][], functions? }` (research R1).
- Result: `{ document: GatewayDocument, provenance: ReadonlyMap<string, RouteOwner> }` — provenance отдельно от артефакта (внутренняя read-map, НИКОГДА не сериализуется в документ).

### ComposeError
Детерминированная ошибка композиции (единый тип 008; см. contract). Коды групп: конфликты (path/operationId/component/version), грамматика и применение overrides, info-gate, инвариант none-ссылки. Ошибки делегированных этапов НЕ оборачиваются: наружу всплывают `OpenApiExtractError` (006) / `AuthConfigError` (007) исходных кодов (FR-015).

- контекстные поля: `app?`, `path?`, `method?`, `operationId?`, `componentName?`, `target?`, `op?`, `ruleIndex?`, `filePath?`, `valueName?` (имена версий для FR-016) и др.;
- инвариант: каждое невалидное состояние из таблицы ниже маппится ровно на один код; сообщения строятся только из контекста, никогда из содержимого документов/правил.

## Validation rules (маппинг FR-* → правило → невалидное состояние → код 008)

| # | Правило | FR | Невалидное состояние | Код ошибки |
|---|---------|----|----------------------|------------|
| 1 | участники — непустой явный список приложений | FR-001 (spine), V | `apps` пуст/отсутствует | `COMPOSE_NO_PARTICIPANTS` |
| 2 | извлечение каждого участника (006) | FR-001 | ошибка источника/артефакта/раннера | `OpenApiExtractError` (коды 006, как есть) |
| 3 | auth-валидация каждого участника (007) | FR-001 | любой fail-fast 007 | `AuthConfigError` (коды 007, как есть) |
| 4 | поля `openapi` всех участников совпадают | FR-016 | разнобой версий | `COMPOSE_OPENAPI_VERSION_MISMATCH` (`apps`, `versions`) |
| 5 | совпадение строки пути у ≥2 приложений | FR-004 | один путь — два app (любые методы) | `COMPOSE_PATH_COLLISION` (`path`, `apps`) |
| 6 | уникальность `operationId` в объединении (вкл. self-collision) | FR-005 | дубликат operationId | `COMPOSE_OPERATIONID_COLLISION` (`operationId`, `paths`, `apps`) |
| 7 | уникальность имён `components` (вкл. securitySchemes) | FR-006 | дубликат имени компонента | `COMPOSE_COMPONENT_COLLISION` (`componentName`, `apps`) |
| 8 | коллизия auth-эмиссии securitySchemes с существующим именем | FR-006, FR-012 | имя не-`none` схемы уже занято | `COMPOSE_COMPONENT_COLLISION` (`componentName`, `schemeName`) |
| 9 | каждая operation-level `security`-ссылка на не-`none` схему резолвима (007 гарантирует объявление; FR-012 эмитит запись) | FR-011/012, V | ссылка на схему типа `none` | `COMPOSE_SECURITY_REF_NONE_SCHEME` (`route`, `schemeName`) |
| 10 | override-файл (если есть) — валидный YAML-map с `version: 1` и списком `rules` | FR-007, III | битый/не-документ; версия ≠ 1; `rules` не список; `rules` пуст; файл есть, но не читается | `OVERRIDE_FILE_INVALID_YAML` / `OVERRIDE_VERSION_UNSUPPORTED` / `OVERRIDE_RULES_NOT_LIST` / `OVERRIDE_RULES_EMPTY` / `OVERRIDE_FILE_UNREADABLE` (`filePath`) |
| 11 | грамматика правила: `op ∈ {replace,add,remove}`; target валиден по `kind` и полям; `value` есть для replace/add и отсутствует для remove; method — HTTP-method | FR-007, V | неизвестный op/kind; невалидные поля; нет value; лишний value | `OVERRIDE_UNKNOWN_OP` / `OVERRIDE_INVALID_TARGET` / `OVERRIDE_VALUE_REQUIRED` / `OVERRIDE_VALUE_FORBIDDEN` / `OVERRIDE_METHOD_INVALID` (`op`, `kind`, `ruleIndex`) |
| 12 | apply: цель существует для replace/remove; отсутствует для add | FR-007, AC6 | замена/удаление отсутствующего; добавление существующего | `OVERRIDE_TARGET_MISSING` / `OVERRIDE_TARGET_ALREADY_EXISTS` (`path`/`operationId`/`componentName`, `ruleIndex`) |
| 13 | local override адресует только path-space своего приложения (или добавляет свой путь); root-поля (`info`/`component`) и чужие пути — fail-fast | FR-008 | выход за path-space владельца | `OVERRIDE_OUT_OF_SCOPE` (`app`, `targetPath`, owner) |
| 14 | итоговый gateway-документ содержит `info` | Edge/Assumptions «info шлюза», V | info не задан (нет global override) | `COMPOSE_INFO_MISSING` |
| 15 | глобальная уникальность и детерминизм: нормализация ключей, отсутствие provenance в артефакте | FR-003/017 | (не правило, а инвариант финализации) | — |
| 16 | B не эмитит integrations, `${resources...}`, IAM-поля authorizer | FR-013/018 | (не правило, а граница области) | — |

Примечания:
- Правила 2–3 делегированы 006/007: коды их таксономии публикуются наружу без ремапа (FR-015).
- Правило 9 — инвариант «неэмитабельной ссылки» (research R6): 007 требует объявления схемы, но не запрещает ссылки на `none`-схему (кроме `public`); валидность итогового документа требует securitySchemes-записи, которую для `none` нельзя эмитить → fail-fast в 008 (никогда не «тихое опускание»).
- Правило 4: значение `openapi` в документе — общее значение участников; B не выбирает версию.

## НЕ ошибки композиции (явно документируются)

- **Пустое приложение** (нет `paths` или пустой операций, Edge cases): вклад пуст, остальные участники и правила применяются как обычно (FR-002).
- **Объявленная, но неиспользуемая схема** auth.yaml: эмиссия `securitySchemes`/authorizer выполняется для КАЖДОЙ не-`none` схемы (Assumptions), так что на 008 это валидный и детерминированный вклад, а не ошибка.
- **«Голые» операции** без `security`: не ошибка; получают `defaultScheme` через корневый `security` (не-`none`) или остаются публичными (`none`) (FR-011; шов 007).
- **`security: []` на операции**: «явно без auth», сохраняется как есть (переопределяет root).
- **Отсутствие override-файла** (global или local): нет правил уровня — не ошибка.
- **Пересечение global и local override на одной цели**: приоритет local > global, НЕ конфликт (FR-009).
- **Два правила внутри одного файла, переадресующие одну цель**: последовательная семантика (позднее правило видит результат раннего) — детерминированный pipeline, НЕ коллизия (research R3).
- **Пустое приложение внутри composition и duplicates в `apps`**: дубликат `appRoot` в `apps` — fail-fast (явный список должен быть множеством; Constitution V).
- **Коллизия схемы: auth.yaml 007-валиден, но ссылка операции на `none`-схему** — уже ошибка (правило 9), а не «не ошибка».

## State transitions: фиксированная pipeline (research R7)

```
Initial: compose({ compositionRoot, apps, functions? })

  1. READ      apps — непустой список уникальных appRoot      -> else COMPOSE_NO_PARTICIPANTS
  2. EXTRACT   per app (порядок ввода): extractOpenApi(appRoot) (006)
                 любая ошибка 006                                -> OpenApiExtractError (как есть)
  3. AUTH      authYaml = validateAuthConfig({ appRoot: compositionRoot,
                 openApi: doc[0], functions })                    -> AuthConfigError (как есть)
                 for i in 1..N: validateAuthReferences(doc[i], authYaml)
                                                                    -> AuthConfigError (как есть)
  4. VERSION   все doc[i].openapi равны                          -> else COMPOSE_OPENAPI_VERSION_MISMATCH
  5. MERGE     paths/components объединение + конфликты:
                 path repeat                                    -> COMPOSE_PATH_COLLISION
                 operationId repeat (вкл. self)                 -> COMPOSE_OPERATIONID_COLLISION
                 component name repeat                          -> COMPOSE_COMPONENT_COLLISION
               строит PathOwnership (research R2)
  6. AUTH-APPLY defaultScheme -> root security (не-`none`); securitySchemes
                 + authorizers на каждую не-`none` схему (R5/R6)
                 none-ссылка операции                           -> COMPOSE_SECURITY_REF_NONE_SCHEME
                 коллизия имени с securitySchemes               -> COMPOSE_COMPONENT_COLLISION
  7. OVERRIDES  global файл → правила по порядку; затем local файлы участников
                 (порядок ввода); грамматика-ошибки и apply-ошибки -> OVERRIDE_* (коды 10–13)
                 добавляемые пути получают owner global/app        (provenance)
  8. FINALIZE   info присутствует                               -> else COMPOSE_INFO_MISSING
                 каноническая сортировка ключей paths/components (research R2)
                 provenance отдельно; артефакт без provenance

Final: ComposeResult { document: GatewayDocument, provenance }
```

Инварианты перехода:
- Порядок строго фиксирован (SC-001/SC-005): первый нарушенный инвариант даёт детерминированную ошибку; частичные результаты наружу не выдаются (FR-015).
- Следствия канонического порядка: ошибка 006 любого участника останавливает pipeline ДО auth (извлечение всех вперёд); auth-валидация (007) идёт до version/merge; conflicts (5) до auth-эмиссии (6): поэтому коллизия имени с уже слитым securitySchemes из приложений определяется на шаге 6 по общему правилу FR-006; overrides (7) после auth-применения (6): добавленные override-пути и заменённые тела операций не проходят atomic-apply auth — наследуют/переопределяют корневый `security` по OAS-семантике документа.
- Детерминизм результата: нормализация ключей (шаг 8) + порядок схем из composition-owned `auth.yaml` + fail-fast на коллизиях — порядок участников влияет только на порядок обработки (FR-017, SC-002/SC-005).
- Входные per-app документы, `auth.yaml` и override-файлы никогда не мутируются (FR-014); merge/overrides работают на копиях.