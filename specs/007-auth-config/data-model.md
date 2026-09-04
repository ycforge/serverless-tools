# Data Model: auth-config — `auth.yaml` и валидация scheme references (Project B)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/auth-config.md](./contracts/auth-config.md)

Сущности, правила валидации (маппинг на FR-*) и невалидные состояния. Тело — русский, идентификаторы — английский.

## Entities

### AuthYamlDocument
Единый источник схем composition (авторизованный контракт `auth.yaml`, `version: 1`).

- `version` — `1` (литерал, единственная поддерживаемая версия формата; FR-002)
- `defaultScheme` — `string`, имя схемы «project default» (FR-003)
- `schemes` — `Readonly<Record<string, AuthScheme>>`, непустой map (FR-004)
- Инварианты (валидированное состояние, вход для 008):
  - `version === 1`; `defaultScheme ∈ schemes`; `schemes` непустой;
  - имена схем уникальны и case-sensitive (любые непустые строки; нормализация/trimming отсутствуют — схема `Public` НЕ эквивалентна `public`, Edge cases);
  - документ read-only: 007 его не мутирует и не применяет к OpenAPI (R5).

### AuthScheme (дискриминированный union по `type`)
Валидированная typed-форма схемы. `none` — без дополнительных полей; `jwt` — `jwksUri`, `issuer`, `audience` (`string | string[]`, непустые; R7); `function` — `function: FunctionReference` (FR-006).

```ts
type AuthScheme =
  | { type: 'none' }
  | { type: 'jwt'; jwksUri: string; issuer: string; audience: string | readonly string[] }
  | { type: 'function'; function: FunctionReference };
```

Расширяемость (FR-005): добавление типа = новый член union + новая запись реестра полей; существующие ветви не меняются (SC-005).

### RawAuthScheme (pre-validation)
Сырой узел `schemes` после YAML-парсинга: `{ type: string, ...прочие поля }` без типизации. Неизвестный `type` валидируется ещё на этой форме (`AUTH_UNKNOWN_SCHEME_TYPE`) — до проверки полей (никогда не «no security»; V).

### SchemeName
Логическое имя схемы: непустая строка, exact-match, case-sensitive, без нормализации. Зарезервировано: `public` (нижний регистр, тип `none`) — no-op convention из 003/§11; использование имени `public` как обычной схемы допустимо (FR-009), появление `public` в `security`-записи — договорное нарушение.

### DefaultScheme
`defaultScheme` = имя схемы из `schemes`. Для 007 валидна только резолвимость (`defaultScheme ∈ schemes`); как имя применяется/эмитится в 008 (precedence method > controller > project default).

### SecurityEntry (источник: извлечённый OpenAPI, 006)
Auth-требование из `security`-массивов извлечённого документа (FR-013 — только эти метаданные).

- `location` — `'root'` | `'METHOD /path'` (напр. `'GET /users'`) — точка, где встретилась запись
- `schemeName` — ключ security-requirement объекта; `scopes` — его массив значений (не используется B на 007)
- Инвариант: источник — `security` на корне документа И на операциях `paths[*][method].security`; `components.securitySchemes` документа источником не является (R6).

### FunctionReference
Логическая ссылка authorizer-функции по формату §12.

- Грамматика: `functions.<name>`, сегмент `[a-z][a-z0-9_]*` (стиль сегмента `parseResourceReference` из pilot/contracts; НЕ трёхсегментный `ResourceReference` — R3)
- `name` — второй сегмент; разрешимость — `name ∈ functions` (caller-provided набор функций композиции)
- B не интроспектирует целевую функцию (FR-012 «SHALL NOT»); провижининг/JWKS/Lockbox/Object Storage — вне B (FR-011)

### AuthValidationRequest / AuthValidationResult
- Request: `{ appRoot, openApi, functions? }` — `appRoot` (корень composition, файл `<appRoot>/auth.yaml`), `openApi` (извлечённый документ, обязателен — композиция всегда держит его в руках), `functions` (набор функций композиции; обязателен к передаче, если в документе есть `function`-схема — иначе `AUTH_FUNCTION_SET_REQUIRED`)
- Result: `{ authYaml: AuthYamlDocument }` — валидированная read-model; побочных эффектов нет (R5)

### AuthConfigError
Детерминированная ошибка валидации (единый тип).

- `code` — один из кодов ниже; контекстные поля: `path?` (файл), `schemeName?`, `field?`, `type?`, `ref?`, `route?`, `keyPath?` (yaml node-путь, напр. `schemes.user`)
- Инвариант: каждый fail-fast из FR-001..FR-009/012 маппится ровно на один код (таблица ниже)

## Validation rules (маппинг FR-* → правило → код)

| # | Правило | FR | Невалидное состояние | Код ошибки |
|---|---------|----|----------------------|------------|
| 1 | `auth.yaml` читается из `<appRoot>/auth.yaml` | FR-001 | файла нет / не читается | `AUTH_FILE_MISSING` |
| 2 | Файл — валидный YAML-документ (map) | FR-001 | битый YAML / не-документ | `AUTH_FILE_INVALID_YAML` |
| 3 | Любой дубликат ключа в документе (uniqueKeys) | FR-007, V | повтор ключа вне `schemes` | `AUTH_DUPLICATE_KEY` (`keyPath`) |
| 4 | Дубликат ключа внутри `schemes` | FR-007 | повтор имени схемы | `AUTH_DUPLICATE_SCHEME` (`schemeName`) |
| 5 | `version === 1` | FR-002 | нет/иное значение | `AUTH_VERSION_UNSUPPORTED` |
| 6 | `defaultScheme` присутствует (ровно один, непустой) | FR-003 | отсутствует / пуст | `AUTH_DEFAULT_MISSING` |
| 7 | `defaultScheme` объявлен в `schemes` | FR-003 | необъявленное имя | `AUTH_DEFAULT_UNRESOLVED` (`schemeName`) |
| 8 | `schemes` — непустой map | FR-004 | пуст / не-объект (список и т.п.) | `AUTH_SCHEMES_EMPTY` / `AUTH_SCHEMES_NOT_MAP` |
| 9 | `type ∈ {none, jwt, function}` | FR-005 | неизвестный тип | `AUTH_UNKNOWN_SCHEME_TYPE` (`schemeName`, `type`) |
| 10 | Обязательные поля по типу (FR-006, R7) | FR-006 | нет поля / пустое / пустой массив `audience` | `AUTH_MISSING_FIELD` (`schemeName`, `field`) |
| 11 | `function`-ссылка: грамматика `functions.<name>` | FR-012 | неверный формат | `AUTH_FUNCTION_INVALID_REF` (`ref`) |
| 12 | Function-разрешимость (`name ∈ functions`) | FR-012 | имя вне набора | `AUTH_FUNCTION_UNRESOLVED` (`ref`) |
| 13 | Набор `functions` передан при наличии function-схемы | FR-012, V | схемы есть, набора нет | `AUTH_FUNCTION_SET_REQUIRED` |
| 14 | Каждый scheme name в `security`-записях объявлен | FR-008 | необъявленная ссылка | `AUTH_SECURITY_UNDECLARED` (`schemeName`, `route`) |
| 15 | `public` в `security`-записи — договорное нарушение | FR-009 | появление `public` в security | `AUTH_SECURITY_PUBLIC_VIOLATION` (`route`) |
| 16 | имя схемы — непустая строка | FR-004, §SchemeName | пустое имя (`''`) | `AUTH_INVALID_SCHEME_NAME` (`schemeName`) |
| 17 | B не проверяет guard-семантику | FR-010 | — (не правило, а запрет) | — |
| 18 | B не провижинит auth-инфраструктуру | FR-011 | — (не правило, а запрет) | — |

Запреты 17–18 — НЕ ошибки валидации, а границы области B (Constitution I); фиксируются в контракте, а не в check-логике.

НЕ ошибки на уровне 007 (явно документируются, R5/R6):
- объявленная, но неиспользуемая схема (US2/AC3);
- операция без `security` и `security: []` (применение defaultScheme — 008);
- схема `function`, не выдающая key/JWKS/Lockbox-артефактов (это и есть граница FR-011).

## State transitions: pipeline валидации

Порядок строго фиксирован; первый нарушенный инвариант даёт детерминированную ошибку (fail-fast, SC-003). Этапы:

```
Initial: request = { appRoot, openApi, functions? }

  1. READ      resolved = resolve(appRoot)/auth.yaml
                 missing/unreadable        -> AUTH_FILE_MISSING (path)
  2. PARSE     yaml.parseDocument(text, uniqueKeys:true)
                 doc.errors (вкл. DUPLICATE_KEY) -> AUTH_FILE_INVALID_YAML /
                                                    AUTH_DUPLICATE_KEY / AUTH_DUPLICATE_SCHEME
                 корень не-объект           -> AUTH_FILE_INVALID_YAML
  3. VERSION   version === 1               -> else AUTH_VERSION_UNSUPPORTED
  4. DEFAULT   defaultScheme присутствует   -> else AUTH_DEFAULT_MISSING
                 (только присутствие; разрешимость — на этапе 6)
  5. SCHEMES   schemes — непустой map       -> else AUTH_SCHEMES_EMPTY / AUTH_SCHEMES_NOT_MAP
  6. DEFAULT   defaultScheme ∈ schemes      -> else AUTH_DEFAULT_UNRESOLVED
                 (разрешимость defaultScheme; проверяется ПОСЛЕ формы schemes,
                  чтобы поиск имени никогда не шёл по не-obj/пустой структуре)
  7. TYPE      type ∈ {none,jwt,function}   -> else AUTH_UNKNOWN_SCHEME_TYPE
  8. FIELDS    обязательные поля по типу    -> else AUTH_MISSING_FIELD
  9. FUNC-REF  function-ссылки: грамматика, набор functions (если есть function-схемы)
                                           -> else AUTH_FUNCTION_INVALID_REF /
                                              AUTH_FUNCTION_UNRESOLVED /
                                              AUTH_FUNCTION_SET_REQUIRED
 10. SECURITY  scan root. + операций security-entries
                 каждое имя объявлено?      -> else AUTH_SECURITY_UNDECLARED (scheme+route)
                 значение public?           -> else AUTH_SECURITY_PUBLIC_VIOLATION (route)

Final: AuthValidationResult { authYaml: AuthYamlDocument }  // валидированная read-model для 008
```

Инварианты перехода:
- Приоритет строго фиксирован (SC-003): `version → defaultScheme-presence → schemes-map/empty → defaultScheme-resolvability → type → fields → function → security`.
- Следствия канонического порядка: документ с `schemes: {}` и `defaultScheme: user` даёт `AUTH_SCHEMES_EMPTY` (правило 8 раньше правила 7 — форма schemes проверяется до разрешимости); документ с непустым `schemes`, `defaultScheme: ghost` и схемой с неизвестным `type` даёт `AUTH_DEFAULT_UNRESOLVED` (правило 7 раньше правила 9 — разрешимость проверяется до типа схемы).
- Существующий, но невалидный источник — fail-fast, никакие «мягкие» стадии (warnings) не предусмотрены (V).
- Документ `auth.yaml` и входной `openApi` никогда не модифицируются (R5).