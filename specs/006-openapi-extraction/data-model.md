# Data Model: OpenAPI extraction (Project B)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Entities

### OpenApiDocument
Целевой артефакт извлечения: извлечённый OpenAPI-документ одного приложения.

- `openapi` — `string` (версия OpenAPI, e.g. `3.0.0`) — обязателен
- `info` — `object` — обязателен у источника, не валидируется на этапе извлечения
- `paths` — `object` — обязателен
- `components?`, прочие поля — `any`, не валидируются (структурная валидация — R3)
- Инвариант: документ передаётся дальше **без изменений структуры** (FR-009); композиция/merge — spec 008.

### ExtractionRequest
Вход извлечения: явная конфигурация одной операции.

- `appRoot` — `string` — корень приложения (для артефактов `<app>/swagger.json`, `<app>/openapi.json`, `<app>/dist/main`)
- `openapiEntry?` — `string` — путь к файлу, экспортирующему `buildYcsfOpenApi: () => Promise<OpenApiDocument>`; присутствие — явный primary source (FR-001, FR-010)
- Правило: знакомое явное указание предпочтительнее; отсутствие `openapiEntry` включает fallback-цепочку (FR-004/005)

### OpenApiExtractError
Детерминированная ошибка извлечения.

- `code` — один из: `NO_SOURCE`, `INVALID_ARTIFACT`, `ENTRY_LOAD_FAILED`, `ENTRY_EXECUTION_FAILED`, `ENTRY_RETURNED_INVALID`, `ENTRY_TIMEOUT`, `RUNNER_SPAWN_FAILED`
- `sourcePath?` — путь к источнику (артефакт / entry / runner), где применимо
- `cause?` — исходная ошибка (без раскрытия содержимого user-документов)
- Инвариант: каждая публичная причина из FR-006/007/008/011 маппится ровно на один код (R4)

## State transition: выбор источника (fallback chain)

```
Initial: request = { appRoot, openapiEntry? }

1. openapiEntry present?
     yes -> SOURCE_ENTRY (runner: import -> buildYcsfOpenApi() -> doc)
             entry load/exec fail -> ENTRY_LOAD_FAILED / ENTRY_EXECUTION_FAILED /
                                     ENTRY_TIMEOUT / ENTRY_RETURNED_INVALID (fail-fast, no fallthrough)
     no  -> step 2

2. <app>swagger.json exists & valid?  -> SOURCE_ARTIFACT(swagger.json)
     exists but invalid -> INVALID_ARTIFACT (fail-fast, no fallthrough to openapi.json)
     absent            -> step 3

3. <app>openapi.json exists & valid?  -> SOURCE_ARTIFACT(openapi.json)
     exists but invalid -> INVALID_ARTIFACT (fail-fast)
     absent            -> step 4

4. <app>dist/main importable & exports buildYcsfOpenApi?
     yes -> SOURCE_CONVENTION (runner, same contract as step 1)
     no  -> step 5

5. -> NO_SOURCE error: "Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point."
```

Инварианты перехода:
- Приоритет строго фиксирован (SC-003): `openapiEntry` → `swagger.json` → `openapi.json` → `dist/main` → `NO_SOURCE`.
- Существующий, но невалидный источник — fail-fast (FR-007, FR-008), никогда не переход к следующему.
- Каждый шаг детерминирован и наблюдаем (ни один источник не выбирается молча).