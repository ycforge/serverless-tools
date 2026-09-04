# Contract: `@ycforge/composer` — auth-config (`validateAuthConfig`)

**Version**: 1 — стабилен в рамках semver `@ycforge/composer` (major = breaking).

Контракт Phase B по auth: документ `auth.yaml`, самовалидация, валидация scheme-ссылок из извлечённого OpenAPI (006), резолвимость `function`-ссылок. Потребляется программно сегодня и будущим `ycsf-api` CLI (spec 010); типовая интероперабельность, без runtime-зависимостей от других пакетов serverless-tools.

## Формат `auth.yaml` (version 1)

Файл лежит в корне openapi-приложения (composition): `<appRoot>/auth.yaml`, рядом с `build_config.yaml`/`overrides.yaml`. Физически вне `.ycsf/`, но версионируется по тем же правилам contract versioning (Constitution III); `version: 1` обязателен (FR-002).

```yaml
version: 1
defaultScheme: user

schemes:
  public:
    type: none

  user:
    type: jwt
    issuer: https://auth.example.com
    audience: [my-api]
    jwksUri: https://auth.example.com/jwks.json

  internal:
    type: function
    function: functions.internal_authorizer
```

### Схема документа

| Поле | Тип | Обязательно | Правило |
|------|-----|-------------|---------|
| `version` | `integer` | да | `=== 1`; иное значение — `AUTH_VERSION_UNSUPPORTED` (FR-002) |
| `defaultScheme` | `string` | да | ровно одно непустое значение; `defaultScheme ∈ schemes` (FR-003) |
| `schemes` | map | да | непустой map `имя → схема` (FR-004); имена case-sensitive, без нормализации |
| `schemes.<name>.type` | `string` | да | `none` \| `jwt` \| `function`; неизвестный тип — fail-fast (FR-005) |
| `schemes.<name>.jwksUri` | `string` | для `jwt` | непустая строка (FR-006) |
| `schemes.<name>.issuer` | `string` | для `jwt` | непустая строка (FR-006) |
| `schemes.<name>.audience` | `string \| string[]` | для `jwt` | непустое значение; пустой массив = отсутствие поля (FR-006, research R7) |
| `schemes.<name>.function` | `string` | для `function` | грамматика `functions.<name>`, сегмент `[a-z][a-z0-9_]*`; `name` ∈ набор функций композиции (FR-006/FR-012) |

- Дубликат ключа в документе — fail-fast: внутри `schemes` → `AUTH_DUPLICATE_SCHEME` (с именем), в любом другом месте → `AUTH_DUPLICATE_KEY` (с node-путём) (FR-007; строже минимума — весь документ unique, Constitution V).
- `public` (нижний регистр, тип `none`) — зарезервированная no-op-конвенция (spec 003); объявление схемы `public` и `defaultScheme: public` допустимы (FR-009).
- Формат — contract-versioned вместе с `@ycforge/composer`: breaking-изменение грамматики = major + migration guide; добавление нового `type` — аддитивное расширение, существующие конфигурации не ломаются (FR-005, SC-005).

## Публичный API

```ts
interface AuthValidationRequest {
  appRoot: string;               // корень openapi-приложения (composition); источник <appRoot>/auth.yaml
  openApi: OpenApiDocument;      // извлечённый документ (006) — единственный источник security-entries (FR-013)
  functions?: readonly string[]; // функции композиции (FR-012); обязателен, если есть function-схема
                                 //   (иначе AUTH_FUNCTION_SET_REQUIRED)
}

interface AuthValidationResult {
  authYaml: AuthYamlDocument;    // валидированная read-model: version 1, defaultScheme, schemes
}

interface AuthYamlDocument {
  version: 1;
  defaultScheme: string;
  schemes: Readonly<Record<string, AuthScheme>>;
}

type AuthScheme =
  | { type: 'none' }
  | { type: 'jwt'; jwksUri: string; issuer: string; audience: string | readonly string[] }
  | { type: 'function'; function: FunctionReference };

interface FunctionReference {
  ref: string;   // каноническая форма "functions.<name>"
  name: string;  // второй сегмент
}
```

## `validateAuthConfig(request: AuthValidationRequest): Promise<AuthValidationResult>`

Валидирует `auth.yaml` своей composition и сверяет scheme-ссылки в `security`-записях извлечённого OpenAPI. Резолвится с валидированной read-model; отклоняет с `AuthConfigError` на любом fail-fast.

Что B ГАРАНТИРУЕТ после успешного резолва (обязательства контракта):

- `auth.yaml` self-contained валиден: `version: 1`, ровно один `defaultScheme` ∈ `schemes`, непустой `schemes`, каждый тип ∈ `{none, jwt, function}`, обязательные поля по типу, дубликаты ключей отсутствуют (FR-002..FR-007).
- Каждый scheme name во всех `security`-записях извлечённого документа (`security` на корне и на операциях `paths[*][method]`) объявлен в `schemes` своей composition (FR-008).
- Появление `public` в `security`-записи — договорное нарушение цепочки A→OpenAPI → fail-fast (FR-009).
- Каждая `function`-ссылка корректна по грамматике §12 и разрешается в функцию из набора композиции; содержимое функции не интроспектируется (FR-012).

Что B НЕ делает (границы контракта, см. также «Seam к 008»):

- НЕ проверяет соответствие guard семантике схемы (FR-010 — зона A).
- НЕ генерирует/провижинит key pairs, rotation, JWKS publishing, Lockbox, Object Storage, authorizer-функцию (FR-011).
- НЕ читает user-код и metadata `ycsf:auth:*`; единственный источник auth-требований — `security` извлечённого документа (FR-013).
- НЕ мутирует `openApi` и не применяет `defaultScheme` (US2/AC4; seam к 008).

## Errors (`AuthConfigError`)

`AuthConfigError extends Error` с `code` и контекстными полями; каждая публичная причина из FR-001..FR-009/012 маппится ровно на один код.

| code | Meaning | Контекстные поля | Spec source |
|------|---------|------------------|-------------|
| `AUTH_FILE_MISSING` | `<appRoot>/auth.yaml` отсутствует / не читается; вклад в пакет → path | `path` | FR-001 |
| `AUTH_FILE_INVALID_YAML` | файл есть, но не YAML-документ (битый YAML / не-объект) | `path` | FR-001 |
| `AUTH_DUPLICATE_KEY` | повтор ключа вне `schemes` (uniqueKeys по всему документу) | `keyPath` | FR-007 / V |
| `AUTH_DUPLICATE_SCHEME` | повтор имени схемы внутри `schemes` (последний победитель — никогда) | `schemeName` | FR-007 |
| `AUTH_INVALID_SCHEME_NAME` | имя схемы в `schemes` — не непустая строка (напр. пустой ключ `''`) | `schemeName` | FR-004 / data-model §SchemeName |
| `AUTH_VERSION_UNSUPPORTED` | `version` отсутствует или `!= 1` | `field=version` | FR-002 |
| `AUTH_DEFAULT_MISSING` | `defaultScheme` отсутствует или пуст | `field=defaultScheme` | FR-003 |
| `AUTH_DEFAULT_UNRESOLVED` | `defaultScheme` указывает на необъявленную схему | `schemeName` | FR-003 |
| `AUTH_SCHEMES_EMPTY` | `schemes` пуст | `field=schemes` | FR-004 |
| `AUTH_SCHEMES_NOT_MAP` | `schemes` существует, но не отображение | `field=schemes` | FR-004 / Edge |
| `AUTH_UNKNOWN_SCHEME_TYPE` | `type` вне `{none, jwt, function}` (например `oauth2`) | `schemeName`, `type` | FR-005 |
| `AUTH_MISSING_FIELD` | отсутствует/пусто обязательное поле по типу схемы | `schemeName`, `field` | FR-006 |
| `AUTH_FUNCTION_INVALID_REF` | `function` не по грамматике `functions.<name>` | `ref` | FR-012 |
| `AUTH_FUNCTION_UNRESOLVED` | `name` не в наборе функций композиции | `ref` | FR-012 |
| `AUTH_FUNCTION_SET_REQUIRED` | есть `function`-схема, но `functions` в запросе отсутствует | `schemeName` | FR-012 / V |
| `AUTH_SECURITY_UNDECLARED` | scheme name из `security`-записи не объявлен в `auth.yaml` | `schemeName`, `route` | FR-008 |
| `AUTH_SECURITY_PUBLIC_VIOLATION` | `public` встретился в `security`-записи (договорное нарушение) | `route` | FR-009 |

> Аддитивное дополнение контракта (2026-09-05, version остаётся 1, bump не требуется): код `AUTH_INVALID_SCHEME_NAME` — уточнение классификации невалидного имени схемы (пустой ключ `''` в `schemes`), ранее подпадавшего под документный `AUTH_FILE_INVALID_YAML` без `schemeName`-контекста. Дополнение не меняет существующие конфигурации и не ломает существующую таксономию — вводится только более точный, scheme-level код ошибки (T030).

Все ошибки детерминированны и не содержат содержимого user-документов/секретов: в сообщения попадает только контекст из таблицы выше (имя схемы, маршрут `root|METHOD /path`, путь файла, node-путь ключа, текст ссылки). Сравнение имён схем и имён функций — exact, case-sensitive, без нормализации.

## Seam к spec 008 (резерв зоны композиции)

007 фиксирует «валидный источник + резолвимость ссылок»; следующие обязанности ЯВНО исключены из 007 и передаются 008:

- применение `defaultScheme` к операциям без `security` (US2/AC4; §11 precedence);
- генерация `components.securitySchemes` из `schemes`;
- генерация API Gateway authorizers/security-конфигурации;
- слепо-проходное сопоставление `components.securitySchemes` извлечённого документа (не источник истины, R6).

Потребитель 008 получает: `{ appRoot, authYaml (валидированная read-model), openApi (неизменный) }`. Имплементация 007 ни при каких условиях не должна производить эти артефакты.