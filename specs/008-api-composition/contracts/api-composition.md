# Contract: `@ycforge/composer` — api-composition (`compose`)

**Version**: 1 — стабилен в рамках semver `@ycforge/composer` (major = breaking).

Контракт композиции: merge извлечённых per-app OpenAPI-документов (006) в единый gateway-документ, fail-fast на конфликтах, внутренний provenance (route→app), применение auth-конфигурации (шов 007) и global/local overrides. Потребляется программно сегодня и будущим `ycsf-api` CLI (spec 010); типовая интероперабельность, без runtime-зависимостей от других пакетов serverless-tools.

## Публичный API

```ts
interface ComposeApp {
  appRoot: string;               // корень приложения-участника: источник 006-извлечения и <appRoot>/overrides.yaml
}

interface ComposeRequest {
  compositionRoot: string;       // корень openapi-приложения (composition): источник <compositionRoot>/auth.yaml
                                 //   и <compositionRoot>/overrides.yaml
  apps: readonly ComposeApp[];   // непустой список участников (уникальные appRoot); пустой список — ошибка
  functions?: readonly string[]; // функции композиции (007, FR-012); обязателен, если есть function-схема
}

type RouteOwner = string;        // appId участника или литерал 'global' (пути, добавленные global override)

interface ComposeResult {
  document: GatewayDocument;                 // скомпилированный артефакт — БЕЗ provenance (FR-003/017)
  provenance: ReadonlyMap<string, RouteOwner>; // внутренняя read-map path → owner; НИКОГДА не сериализуется в document
}

interface GatewayDocument {
  openapi: string;               // единый openapi участников (FR-016)
  info: Record<string, unknown>; // из global override (иначе COMPOSE_INFO_MISSING)
  security?: Array<Record<string, readonly unknown[]>>; // только если defaultScheme типа не-`none` (FR-011)
  paths: Record<string, unknown>;
  components?: Record<string, unknown>; // компоненты участников + эмитированные securitySchemes; опускается при пустоте
  [key: string]: unknown;
}
```

## `compose(request: ComposeRequest): Promise<ComposeResult>`

Компилирует одну композицию в один gateway-документ. Детерминирован: результат байт-идентичен при повторах и перестановке порядка участников (FR-017). Отклоняет с `ComposeError` на fail-fast композиции; ошибки 006/007 всплывают как есть (FR-015).

### Что B ГАРАНТИРУЕТ после успешного резолва (обязательства контракта)

- Для каждого участника извлечён и провалидирован документ по цепочке 006, auth-конфигурация композиции провалидирована по 007 (FR-001); входные документы не мутированы (FR-014, byte-parity).
- Gateway-документ содержит каждую операцию и каждый компонент каждого приложения без пересечений (FR-002); пути/operationId/имена `components` уникальны в объединении (FR-004/005/006).
- `openapi` у всех участников совпадает; случайный разнобой — ошибка до merge (FR-016).
- auth-слой применён по FR-011/012/013 (см. «Auth-применение»); в артефакте нет provisioning-артефактов и синтаксиса `${resources...}`.
- Global и local overrides применены детерминированно с приоритетом local > global (FR-007/008/009/010); документы instanceof не углубленно-слиты.
- Артефакт не содержит следов принадлежности маршрутов приложениям (FR-003/017); provenance доступен только через `result.provenance`.

### Что B НЕ делает (границы контракта)

- НЕ является Terraform-компилятором и не провижининг: не подставляет реальные IDR, IAM-идентификаторы, `service_account_id`, `tag`, `${resources...}` (FR-013, Constitution I/IV; шов к 019 — см. ниже).
- НЕ эмитит API Gateway integrations (`x-yc-apigateway-integration`) и вручную объявленные gateway-маршруты (FR-018; зона 009/019).
- НЕ читает `apps.yaml`/build-конфигурацию приложений (зона C/011); участники и функции приходят в запросе (research R1).
- НЕ выполняет semantic merge / operation-level merge общих путей и не детектирует семантические пересечения шаблонных путей (post-MVP, Assumptions); пересекающийся path = совпадение строки.
- НЕ мутирует входы и не «выбирает» версию OpenAPI/`info` — версия наследуется единогласием участников, `info` обязан прийти из global override.
- НЕ использует generic deep merge для overrides (FR-010): каждое правило — явная адресация + атомарная операция.

## Формат override-файлов (version 1)

Global: `<compositionRoot>/overrides.yaml`; local: `<appRoot>/overrides.yaml`. Файл отсутствует = нет правил уровня (не ошибка). Версионируется по правилам contract versioning (Constitution III), `version: 1` обязателен (аналог `auth.yaml` в 007).

```yaml
version: 1
rules:
  - op: replace
    target: { kind: info }
    value: { title: "My API", version: "1.0.0" }

  - op: add
    target: { kind: path, path: /_health }
    value:
      get:
        responses:
          "200": { description: ok }

  - op: replace
    target: { kind: operation, path: /users, method: get }
    value:
      operationId: listUsers
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: array } } } }

  - op: remove
    target: { kind: operationId, operationId: getUsers }

  - op: replace
    target: { kind: component, name: UserDto }
    value: { type: object, properties: { id: { type: string } }, required: [id] }
```

### Схема правила

| Поле | Тип | Обязательно | Правило |
|------|-----|-------------|---------|
| `version` | `integer` | да | `=== 1`; иное — `OVERRIDE_VERSION_UNSUPPORTED` |
| `rules` | список | да, непустой | отсутствует/не список — `OVERRIDE_RULES_NOT_LIST`; пуст — `OVERRIDE_RULES_EMPTY` |
| `rules[].op` | `string` | да | `replace` \| `add` \| `remove`; иное — `OVERRIDE_UNKNOWN_OP` |
| `rules[].target` | map | да | дискриминированный по `kind`; невалидный/неизвестный kind — `OVERRIDE_INVALID_TARGET` |
| `rules[].target.kind` | `string` | да | `info` \| `path` \| `operation` \| `operationId` \| `component` |
| `rules[].target.path` | `string` | для `path`/`operation` | строка пути (путь всегда начинается с `/`) |
| `rules[].target.method` | `string` | для `operation` | строчная HTTP-method из `{get,put,post,delete,options,head,patch,trace}`; иное — `OVERRIDE_METHOD_INVALID` |
| `rules[].target.operationId` | `string` | для `operationId` | непустое имя операции |
| `rules[].target.name` | `string` | для `component` | непустое имя компонента (включая `securitySchemes`) |
| `rules[].value` | любой YAML-узел | для `replace`/`add` | отсутствует — `OVERRIDE_VALUE_REQUIRED`; присутствует у `remove` — `OVERRIDE_VALUE_FORBIDDEN` |

- Адресация §14 отображается структурно: `METHOD /path` → `{kind: operation, path, method}`.
- Дублирующиеся правила внутри одного файла — допустимы (последовательная семантика, research R3); пересечение global↔local — приоритет local > global (FR-009).
- Применение: `replace`/`remove` на отсутствующей цели — `OVERRIDE_TARGET_MISSING`; `add` на существующей — `OVERRIDE_TARGET_ALREADY_EXISTS`; локальное правило вне path-space своего приложения или на root-полях (`info`/`component`) — `OVERRIDE_OUT_OF_SCOPE`.
- Значение `value` — opaque YAML→JSON; B не валидирует его OpenAPI-семантику (кроме итогового info-gate).

### Границы уровней

- Local override: ТОЛЬКО path-space своего приложения (`kind: path`/`operation`/`operationId` с резолвом в свой путь) либо добавление НОВЫХ путей в свой path-space (получают owner = appId). Root-поля и чужие пути — fail-fast (FR-008).
- Global override: весь документ, все `kind`; добавленные пути получают owner `'global'` (US3/AC2); доступ к ним из local override — `OVERRIDE_OUT_OF_SCOPE`.

## Auth-применение (шов 007)

На вход — валидированная 007 read-model `authYaml` (007/R5: 008 получает `{ appRoot, authYaml, openApi }`).

- **defaultScheme** (FR-011): тип не-`none` → корневый `security: [{ <defaultScheme>: [] }]` (операции без `security` наследуют, с явным `security` сохраняют своё, `security: []` — «явно без auth»); тип `none` → корневый `security` не эмитится.
- **securitySchemes** (FR-012): одна запись на каждую схему не-`none` в порядке map `schemes`; `none` — без записи; коллизия существующего имени — fail-fast (`COMPOSE_COMPONENT_COLLISION`, общее правило FR-006).
- **authorizers** (FR-013): вложенное `x-yc-apigateway-authorizer` внутри записи схемы (реальная позиция Yandex, research R5).
  - `jwt` (**решено, вариант A**): запись схемы = `{ type: openIdConnect, openIdConnectUrl: <issuer>/.well-known/openid-configuration, x-yc-apigateway-authorizer: { type: jwt, jwksUri: <jwksUri>, issuers: [<issuer>], audiences: [<audience>…], identitySource: { in: header, name: Authorization, prefix: "Bearer " } } }` (audience scalar оборачивается в массив; identitySource — фиксированный дефолт).
  - `function`: запись схемы = `{ type: http, scheme: bearer, x-yc-apigateway-authorizer: { type: function, function_id: functions.<name> } }` — логическая ссылка §12/007 verbatim, БЕЗ `${resources...}`.
- **Контрактная нота «производный openIdConnectUrl» (jwt)**: `openIdConnectUrl: <issuer>/.well-known/openid-configuration` выводится B из `issuer` (`auth.yaml`) по фиксированной конвенции; это ОБЯЗАТЕЛЬНАЯ часть эмиссии (артефакт детерминирован и проверяем). Рантайм-следствие: IdP обязан хостить OIDC discovery по этому адресу, иначе API Gateway не получит `jwks_uri`/публичные ключи и вернёт ошибку получения конфигурации (500 при авторизации JWT). Yandex допускает опущение `openIdConnectUrl` при заданном `jwksUri`, однако контракт 008 фиксирует вывод; переопределение/отказ от вывода URL — аддитивное контрактное расширение (напр., будущее поле jwt-схемы в `auth.yaml`), вне MVP.
- **none-ссылка операции** (см. data-model, правило 9): operation-level `security` на объявленную схему типа `none` — `COMPOSE_SECURITY_REF_NONE_SCHEME` (`route`, `schemeName`).
- Корневый `security` per-app документов в gateway-документ не переносится (Assumptions «info шлюза»).

## Errors (`ComposeError`)

`ComposeError extends Error` c `code` и контекстными полями. Ошибки 006/007 всплывают как `OpenApiExtractError`/`AuthConfigError` без переупаковки (FR-015).

| code | Meaning | Контекстные поля | Spec source |
|------|---------|------------------|-------------|
| `COMPOSE_NO_PARTICIPANTS` | `apps` пуст/отсутствует (композиция обязана называть ≥1 участника) | — | FR-001, Assumptions |
| `COMPOSE_OPENAPI_VERSION_MISMATCH` | поля `openapi` участников не совпадают | `apps`, `versions` | FR-016 |
| `COMPOSE_PATH_COLLISION` | одна строка пути у ≥2 приложений (любые методы) | `path`, `apps` (оба appId) | FR-004 |
| `COMPOSE_OPERATIONID_COLLISION` | дубликат `operationId` в объединении (вкл. внутри одного app) | `operationId`, `paths` (обе), `apps` | FR-005 |
| `COMPOSE_COMPONENT_COLLISION` | дубликат имени компонента (вкл. auth-эмиссию securitySchemes) | `componentName`, `apps` / `schemeName` | FR-006, FR-012 |
| `COMPOSE_SECURITY_REF_NONE_SCHEME` | operation-level `security` ссылается на схему типа `none` (нельзя эмитить запись) | `route`, `schemeName` | FR-011/012, V |
| `COMPOSE_INFO_MISSING` | `info` не задан (нет global override) | — | Edge, Assumptions «info шлюза» |
| `OVERRIDE_FILE_UNREADABLE` | override-файл существует, но не читается | `filePath` | FR-007 |
| `OVERRIDE_FILE_INVALID_YAML` | файл есть, но не YAML-map (битый YAML / не-документ) | `filePath` | FR-007 |
| `OVERRIDE_VERSION_UNSUPPORTED` | `version` ≠ 1 | `filePath` | FR-007, III |
| `OVERRIDE_RULES_NOT_LIST` | `rules` отсутствует / не список | `filePath` | FR-007 |
| `OVERRIDE_RULES_EMPTY` | `rules` пуст — бессмысленный файл (симметрия с `schemes: {}` в 007) | `filePath` | FR-007, V |
| `OVERRIDE_UNKNOWN_OP` | `op` вне `{replace, add, remove}` | `ruleIndex`, `op` | FR-007/010 |
| `OVERRIDE_INVALID_TARGET` | `target` невалиден (нет/неизвестный `kind`/неверные поля) | `ruleIndex`, `kind` | FR-007 |
| `OVERRIDE_VALUE_REQUIRED` | `replace`/`add` без `value` | `ruleIndex`, `op` | FR-007/010 |
| `OVERRIDE_VALUE_FORBIDDEN` | `remove` с `value` | `ruleIndex` | FR-007/010 |
| `OVERRIDE_METHOD_INVALID` | `kind: operation` с не-HTTP-method | `ruleIndex`, `method`, `path` | FR-007 |
| `OVERRIDE_TARGET_MISSING` | `replace`/`remove` на отсутствующей цели | `ruleIndex`, `target` (path/operationId/componentName), `path` | FR-007, US3/AC6 |
| `OVERRIDE_TARGET_ALREADY_EXISTS` | `add` на существующей цели | `ruleIndex`, `target`, `path` | FR-007, US3/AC6 |
| `OVERRIDE_OUT_OF_SCOPE` | local override вне path-space своего приложения или на root-полях | `app`, `targetPath`, `targetKind`, owner | FR-008, US3/AC5 |

Все ошибки детерминированны и не содержат содержимого user-документов/правил: в сообщения попадает только контекст из таблицы (имена/пути/method/operationId/имя компонента/номера правил). Сравнение путей/имён — exact, case-sensitive, без нормализации.

## Seam к 019 (authorizer-эмиссия → материализация)

- 008 эмитит REAL-структуру Yandex API Gateway (research R5): authorizer — вложенный `x-yc-apigateway-authorizer` внутри `components.securitySchemes.<scheme>`; `function_id` содержит логическую ссылку `functions.<name>` (форма §12/007).
- 019 (materializers-yandex) отвечает за преобразование в Terraform: замена значений `function_id`, совпадающих с грамматикой `functions.<name>`, реальными IDR функции (source: артефакт функции после `terraform apply`), добавление `service_account_id`/`tag` при необходимости (IAM/провижининг — НЕ зона B, Constitution I/IV), и добавление per-operation `x-yc-apigateway-integration` (зона 009/019, FR-018).
- До формализации 009 синтаксис `${resources...}` в артефакте НЕ появляется (Assumptions); при введении — контрактное обновление 008, не ломающее текущий вывод.
- Артефакт сам по себе (без интеграций) не является деплоябельным в Yandex spec-ом; он — скомпилированный документ композиции, вход материализации.

## Seam к 009 / 010

- **009**: resource references (`${resources...}`, IDL/IDR) и интеграции — вне 008 (FR-018); 008 эмитит только логические `functions.<name>` (см. выше); появление 009 контрактно сменит форму authorizer-ссылки.
- **010**: `ycsf-api compile`/`ycsf-api check` потребляют публичный API `compose` и таксономию `ComposeError`; диагностика конфликтов 008 — единая для standalone и pipeline C (FR-015), CLI не дублирует логику композиции (Constitution I).

## Аддитивные заметки контракта

- Версия контракта остаётся 1; добавление новых `kind` для override-адресации или новых кодов `ComposeError` (например, будущий `{kind: openapi}` для принудительной версии, research R4-note) — аддитивные расширения без изменения существующих правил.
- Резолюция плана (2026-09-05, секция «Clarifications» в spec.md): дескриптор securityScheme для `jwt` — **вариант A** (`openIdConnect` + производный `openIdConnectUrl`), зафиксирован в «Auth-применение» выше как обязательная форма эмиссии; на версии контракта решение не сказалось (деталь эмиссии внутри стабильной границы authorizer-эмиссии). Отказ/переопределение производного URL — аддитивное расширение, вне MVP.