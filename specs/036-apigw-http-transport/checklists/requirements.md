# Requirements Checklist: 036 — APIGW HTTP Transport

**Purpose**: Требования спеки `specs/036-apigw-http-transport` (транспорт события `cloud_functions` для nest-bridge), проверка качества формулировок.
**Created**: 2026-09-17
**Feature**: [spec.md](../spec.md)

**Note**: This custom checklist is generated for the spec-kit specify flow based on feature context and requirements.
**Review Ownership**: This checklist is a requirements-quality review artifact. Mark an item `[x]` only when the criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Скоуп и границы

- [x] CHK001 Скоуп ограничен `packages/nest-bridge`; MQ-транспорт, контракты версии, subpath exports, composer и materializers-core НЕ затрагиваются (FR-010)
- [x] CHK002 Дискриминаторы v2/APIGW/MQ остаются попарно непересекающимися; порядок реестра `[http, mq]` не меняется (FR-001, FR-007)
- [x] CHK003 Определена граница «ALB v2.0 vs API Gateway cloud_functions» (присутствие/отсутствие `version`) задокументирована (FR-001, Точки неоднозначности IDEA.md)

## Поведение транспорта

- [x] CHK004 Discriminator дешёвый, детерминированный, без side-effects, не бросает исключений (FR-001, AGENTS §10)
- [x] CHK005 Описан обязательный слой валидации (ядро: httpMethod/path/headers/queryStringParameters/body/isBase64Encoded/requestContext.{identity,httpMethod,requestId,requestTime,requestTimeEpoch}) и опциональный слой (url/multiValue*/params/pathParams/operationId → `{}`/`""`) (FR-002/FR-003)
- [x] CHK006 Правила маршрутизации: `path` каноничен для v1-события; `rawQueryString` из `url`-query/fallback-serialize; `requestContext.http` мапится из `httpMethod`/`path`/`identity` (реальные значения) (FR-004/FR-006)
- [x] CHK007 Диагностики `INVALID`/`UNKNOWN` остаются value-free без изменений контракта (FR-008)

## Переиспользование и стабильность

- [x] CHK008 Нормализация переиспользует существующий `normalizeHttpRequest`; `httpVersion` параметризуется аддитивно с дефолтом `"2.0"` (FR-004/FR-005)
- [x] CHK009 Ответ формируется существующим `YandexHttpAdapter` без изменений (FR-009)
- [x] CHK010 Тесты дискриминатора табличные: v2, APIGW, гибрид, MQ, мусор (US3/FR-007)

## Эвиденс и документы

- [x] CHK011 Fixture реального v1-события (reconstructed, provenance «real API Gateway capture, spec 036») добавляется в `packages/nest-bridge/fixtures/` (FR-011)
- [x] CHK012 Обновляются `AGENTS.md`, `docs/ARCHITECTURE.md` §4, README-таблица транспортов; расхождение с `IDEA.md` §2 фиксируется (FR-012)
- [x] CHK013 E2E-критерий: реальный `GET /users` через шлюз → 200; прямой `yc invoke` тем же событием → 200 (SC-001/SC-002)

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- `/skill:speckit-implement` reads checklist checkbox state as a gate and must not modify markers
- `checklists/requirements.md` has a separate built-in lifecycle maintained by `/skill:speckit-specify` and `/skill:speckit-clarify`
- Items are numbered sequentially for easy reference