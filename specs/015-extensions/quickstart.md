# Quickstart: extensions — validation scenarios Sc1..ScN

Справочный проект (как во всех спеках): apps `user_service`, `analytics`, `frontend`, `openapi`. Dispatch (014) сгенерировал канонический набор ресурсов:

```text
yandex_function      user_service   { name: "user-service", runtime: "nodejs18", entrypoint: "main.handler",
                                      environment: { NODE_ENV: "production" }, execution_timeout: "5s" }
yandex_function      analytics      { name: "analytics", ..., environment: { NODE_ENV: "production" }, tags: { env: "prod" } }
yandex_api_gateway   openapi        { name: "openapi", ..., custom_domains: [{ domain_id: "d1" }] }
yandex_container     frontend       (тип вне IDL_DOMAIN_BY_TF_TYPE — НЕ IDL-адресуем, спец фикстура)
```

`IDL_DOMAIN_BY_TF_TYPE` (C-owned, spec 015): `yandex_function → functions`, `yandex_api_gateway → gateways`. → IDL-индекс: `functions.user_service`, `functions.analytics`, `gateways.openapi`. `frontend`-ресурс (тип вне таблицы) в индекс не попадает и не таргетируется.

**Предусловия**: `packages/pilot`, vitest (`pnpm --filter @ycforge/pilot test`); тесты RED → GREEN по Constitution II. `applyExtensions`/`deepMerge` чистые (без I/O); `loadExtensions` без файла кидает `EXT_MISSING_FILE`. Сериализация — переиспользуемый serializer 014 (`serializeResourceFile`/`serializeResource`, sorted keys).

---

## Sc1. Патч env/timeout/service_account на `yandex_function.user_service` (US1, FR-008)

`.ycsf/extensions.yaml`:
```yaml
version: 1
extensions:
  - target: "functions.user_service"
    patch:
      environment:
        CUSTOM_VAR: "value"
      execution_timeout: "30s"
      service_account_id: "${yandex_iam_service_account.custom.id}"
```

Вход `resources` = канонический набор (см. выше). Вызов `applyExtensions(resources, yaml)`.

**Ожидание**: `kind === 'ok'`; у `user_service`: `configuration.environment` содержит **обе** переменные (`NODE_ENV: "production"` + `CUSTOM_VAR: "value"`); `execution_timeout === "30s"`; `service_account_id === "${yandex_iam_service_account.custom.id}"` **байт-в-байт** (FR-010 passthrough). `kind === 'resource'`, `type === 'yandex_function'`, `name === 'user_service'` не изменены (FR-012).

**Сериализация (014)**: `serializeResourceFile("user_service", patched)` → `.tf.json` с merged-конфигурацией, валиден как JSON, ключи отсортированы (FR-009/014).

## Sc2. Array replace: `custom_domains` заменяется, не дописывается (US2, FR-008)

Input: `openapi.configuration.custom_domains = [{ domain_id: "d1" }]`. Patch:
```yaml
  - target: "gateways.openapi"
    patch:
      custom_domains:
        - domain_id: "${yandex_api_gateway_domain.main.id}"
```

**Ожидание**: `custom_domains.length === 1` и равен patch-массиву целиком (replace, НЕ `[{domain_id:"d1"}, {domain_id:"..."}]`).

**Тот же ресурс без patch-ключа**: patch `{ tags: {...} }` (без `custom_domains`) → `configuration.custom_domains` остаётся исходным массивом (нет «чистки по умолчанию»).

## Sc3. Опечатка в target → `EXT_UNRESOLVED_TARGET` со списком доступных IDL (US3, FR-007)

Input-ресурсы: `yandex_function.user_service`, `yandex_function.analytics`, `yandex_api_gateway.openapi`. Файл:
```yaml
version: 1
extensions:
  - target: "functions.user_servivce"
    patch: { execution_timeout: "30s" }
  - target: "functions.user_service"     # валидный, второй
    patch: { tags: { main: "http" } }
```

**Ожидание**:
- `kind === 'invalid'`; errors содержит **один** `EXT_UNRESOLVED_TARGET`; `message` содержит target `functions.user_servivce` **и** доступные IDL в алфавитном порядке: `functions.analytics`, `functions.user_service`, `gateways.openapi` (порядок по строке, НЕ входной порядок).
- **all-or-nothing (US3 AC2)**: валидный второй target (`functions.user_service`) **НЕ применён** — ни один patch вообще.

**Грамматически валидный, но несуществующий домен**: `target: "containers.user_service"` → тот же `EXT_UNRESOLVED_TARGET` (resolution-level, НЕ структурная ошибка).

## Sc4. Дубликат target в файле → `EXT_DUPLICATE_TARGET` (US4, FR-005)

```yaml
version: 1
extensions:
  - target: "functions.user_service"
    patch: { execution_timeout: "30s" }
  - target: "functions.user_service"
    patch: { environment: { A: "1" } }
  - target: "gateways.openapi"
    patch: { custom_domains: [] }
```

**Ожидание**: `kind === 'invalid'`; errors содержит `EXT_DUPLICATE_TARGET` c target `functions.user_service`. **all-or-nothing (US4 AC2)**: `gateways.openapi` тоже **НЕ** патчится (`custom_domains` НЕ заменяется). Порядок ошибок: duplicates (по появлению) → unresolved (в порядке файла).

## Sc5. User `.tf` не тронут; нет I/O в `applyExtensions` (US5, FR-014)

Рядом лежит user-owned `.tf` (`infra/custom.tf` → `yandex_iam_service_account.custom`, `yandex_function_iam_binding.users`). Вызов `applyExtensions` на массиве resources + extensions.yaml.

**Ожидание**: результат определяется **только** `resources` + extensions.yaml; `applyExtensions` **не читает никакие файлы, не пишет, не удаляет** (никакого I/O в transform; единственное I/O фичи — `loadExtensions`). `.tf`-файлы не изменяются и не исчезают (SC-003).

**Passthrough (US5 AC2)**: patch `service_account_id: "${yandex_iam_service_account.custom.id}"` проходит как литерал; C не пытается понять/проверить ссылку (FR-010). То же для `{{$ENV}}`-строк — литерал, без интерполяции (FR-011).

## Sc6. Детерминизм двух запусков (US6, FR-009/SC-001)

Два вызова `applyExtensions` с идентичными `resources` + extensions:
1. `result.resources` глубоко равны (configuration структурно идентичны).
2. Оба результата сериализованы serializer-ом 014 → **байты `.tf.json` идентичны**.

Проверка: входные `resources` после обоих вызовов — прежние (immutability, FR-008; research 6).

## Sc7. Ошибки версии и структуры файла (US7, FR-003/FR-004) — `loadExtensions`

| Файл | Ожидание |
|------|----------|
| `version: 2` + `extensions: []` | `invalid`, errors содержит `EXT_VERSION` |
| `version: 1` без ключа `extensions` | `invalid`, errors содержит `EXT_INVALID` (missing 'extensions') |
| `patch: "not-an-object"` | `invalid`, `EXT_INVALID` |
| `target: "functions/user_service"` или `target: "Functions.user_service"` или `target: "functions"` или `target: "functions.user_service.extra"` | `invalid`, `EXT_INVALID` (IDL-грамматика) |
| Несколько структурных ошибок сразу (не-список `extensions` + bad `patch`) | `invalid`, **все** errors собраны (collect-all) |
| `patch: { environment: { A: 1, A: 2 } }` (duplicate YAML key внутри patch) | `invalid`, `EXT_INVALID` (parse-gate uniqueKeys, FR-004) |
| Top-level неизвестный ключ `foobar:` | `invalid`, `EXT_INVALID` (research 7, Constitution V) |

## Sc8. Пустой patch / пустой список / новые ключи / отсутствующий файл (US8, FR-013/FR-002)

1. Rule с `patch: {}` → `ok`; `configuration` структурно равна исходной (**no-op**).
2. `extensions: []` → `ok`; resources идентичны входным (**identity transform**).
3. Ресурс без ключа `tags`, patch `{ tags: { main: "http" } }` → `ok`; `configuration.tags === { main: "http" }` (**новый ключ добавлен**).
4. В проекте **нет** `.ycsf/extensions.yaml` → `loadExtensions(rootDir)` **бросает** `Error` с `EXT_MISSING_FILE` в message (FR-002; наличие файла решает 021; проект без extensions не вызывает loader).

## Sc9. Крайние случаи deep merge (Edge Cases, FR-008/§25.2)

| base | patch | результат |
|------|-------|-----------|
| `{a:{list:[1,2,3]}}` | `{a:{list:[4]}}` | `{a:{list:[4]}}` (вложенный array replace; не `[1,2,3,4]`) |
| `{a:null}` | `{a:{x:1}}` | `{a:{x:1}}` (base не plain-object → replace) |
| `{a:'old'}` | `{a:null}` | `{a:null}` (null в patch → replace) |
| ресурс без `custom_domains` | `{custom_domains:[...]}` | массив добавляется |
| `{a:1}` | `{}` | `{a:1}` (no-op) |

**Immutability-проверка**: после любого вызова `JSON.stringify(result)` ≠ мутация входа; входные `resources` и patch-объекты не изменены (сравниваем до/после).

## Sc10. Defensive-проверки `applyExtensions` (Edge Cases)

1. **Duplicate IDL в индексе** (два ресурса `yandex_function.user_service`, нарушение инварианта 014) → `invalid`, `EXT_INVALID` «duplicate IDL functions.user_service in generated model» (непроизводимо на текущем dispatch; defensive для 019).
2. **`configuration` таргетированного ресурса не object** (материализатор вернул не-mapping) при валидном target → `invalid`, `EXT_INVALID`; **не** таргетированные ресурсы не проверяются.
3. **Ресурс с типом вне таблицы** (`yandex_container.frontend`): не адресуем, не ошибка; при ok-результате попадает в `resources` без изменений.
4. **Правило с лишним ключом** (`target`+`patch`+`weight:`) → `EXT_INVALID` (FR-004; research 7).
5. **`${...}` с мусором** (`${bad syntax`) в значении patch → проходит как строка (passthrough, FR-010; семантика у `terraform validate`).

## Карта требования → сценарий

| Требование | Сценарий |
|------------|----------|
| FR-002 `EXT_MISSING_FILE` throw | Sc8.4 |
| FR-003 `EXT_VERSION` | Sc7 |
| FR-004 `EXT_INVALID` (collect-all) | Sc7, Sc10.4, Sc8 dup-keys |
| FR-005 `EXT_DUPLICATE_TARGET` | Sc4 |
| FR-006 IDL-индекс | Sc3/Sc10.3 (`frontend` вне индекса) |
| FR-007 `EXT_UNRESOLVED_TARGET` + availableIdls, all-or-nothing | Sc3 |
| FR-008 deep merge (replace/new keys/non-mutating) | Sc1, Sc2, Sc8.1–3, Sc9 |
| FR-009 apply в порядке файла, детерминизм | Sc4 (порядок), Sc6 |
| FR-010 `${...}` passthrough | Sc1, Sc5.2, Sc10.5 |
| FR-011 `{{$ENV}}` passthrough | Sc5.2 |
| FR-012 kind/type/name сохраняются | Sc1 |
| FR-013 no-op пустых patch/списка | Sc8.1/8.2 |
| FR-014 только generated resources; user `.tf` не трогаются | Sc5 |
| SC-003 user `.tf` untouched / no I/O | Sc5 |
| US4 all-or-nothing (дубли) | Sc4 |
| US3 all-or-nothing (unresolved) | Sc3 |

> Примечание: задачи тест-фикстур — В `packages/pilot/test/extensions/` (unit: deep-merge/idl/resolver/apply/loader; quickstart-сценарии как интеграционные). Fixture materializers inline (как 014). Loader I/O тесты — `mkdtemp`.