# Requirements Checklist: 038 — APIGW Scalar Params

**Purpose**: Требования спеки `specs/038-apigw-scalar-params` (типизированные параметры API Gateway: приём скаляров и нормализация в строки), проверка качества формулировок.
**Created**: 2026-09-19
**Feature**: [spec.md](../spec.md)

**Note**: This custom checklist is generated for the spec-kit specify flow based on feature context and requirements.
**Review Ownership**: This checklist is a requirements-quality review artifact. Mark an item `[x]` only when the criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Скоуп и границы

- [x] CHK001 Скоуп ограничен `packages/nest-bridge` (+ reference-проект/golden как следствие); B/C/Terraform не затрагиваются (FR-011)
- [x] CHK002 Дискриминатор/registry `[http, mq]` и непересекаемость веток не меняются (FR-007)
- [x] CHK003 Зафиксирована причина фикса в A, а не в B (composer легитимно генерирует типизированные OpenAPI-схемы) — Clarifications

## Поведение транспорта

- [x] CHK004 Скаляры (`string|number|boolean`) и их списки принимаются в оценочных картах параметров (v1 `params`/`pathParams`/`multiValueParams`, v2 `parameters`/`pathParameters`/`multiValueParameters`) (FR-001)
- [x] CHK005 Структурные аномалии (`null`/объект/массив/`NaN`/неверный контейнер) по-прежнему отвергаются value-free `INVALID_INVOCATION_EVENT` (FR-002)
- [x] CHK006 Нормализация скаляров в строки — в единственной точке канонизации `normalizeHttpRequest`, для обоих входов; transformation, not mutation, `raw` сохраняет типы (FR-003/FR-004)
- [x] CHK007 Клиентские представления `headers`/`queryStringParameters`/`multiValueHeaders`/`multiValueQueryStringParameters` сохраняют строгость; послабление ограничено оценочными картами параметров (FR-005)
- [x] CHK008 Шлюзовые `parameters` (дефолты) не мёржатся в запрос приложения; канон query — клиентские значения (FR-006)

## Переиспользование и стабильность

- [x] CHK009 Существующий путь `normalizeHttpRequest` переиспользуется; `pathParameters` остаются строковыми для path-matching/`request.params`
- [x] CHK010 Диагностики остаются value-free и совместимыми с контрактом 036 (FR-002)

## Эвиденс и документы

- [x] CHK011 Reconstructed-fixture v1-события с типизированными значениями добавляется в `packages/nest-bridge/fixtures/http-apigw/` с provenance (FR-008)
- [x] CHK012 `apps/openapi/openapi.yaml` возвращает `count` к `type: integer, default: 1`; golden/хеш функции пересобраны (FR-009)
- [x] CHK013 Документация (ARCHITECTURE A/README, IDEA.md §2) обновляется по правилу «шлюз типизирует значения по схеме; адаптер нормализует скаляры; дефолты не мёржатся» (FR-010)
- [x] CHK014 E2E-критерий: `GET /users/logs` без параметров через реальный шлюз → 200 (SC-001)

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- `/skill:speckit-implement` reads checklist checkbox state as a gate and must not modify markers
- `checklists/requirements.md` has a separate built-in lifecycle maintained by `/skill:speckit-specify` and `/skill:speckit-clarify`
- Items are numbered sequentially for easy reference
