# Specification Quality Checklist: composer-builder — `@ycforge/composer/builder`, Builder-модуль Project B (`ycforge:api-gateway`)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- All 16 items pass. Spec is ready for `/speckit.plan`.
- FR-001–FR-016 testable with: fixture-проект в map-form (C-диалект apps.yaml + builders.yaml `ycforge:api-gateway: '@ycforge/composer/builder'`) → `buildApps()` (public API C); интеграционный hand-off с реальным materializer 019 (`replaceResourceRefs`); legacy-суite CLI — как guard 0-регрессий; safe-mode пробы через runner-субпроцесс.
- 0 [NEEDS CLARIFICATION]: два потенциально спорных места закрыты решениями с обоснованием — IDT-таблица в B (D-4: `terraformType` обязан производить producer по контракту 019 `ApiGatewayArtifactValue`; B знает только адресную таблицу, не Terraform-семантику) и диалект `build_config.yaml` (D-2/FR-008: builder читает `context.buildConfig` от C, legacy root-`openapi_entry` остаётся только CLI-путём; риск и fail-fast документированы в §12/§8).
- Границы соблюдены: builder не парсит `.ycsf/apps.yaml` (BIG-4, FR-005), не импортирует user-код (B-принцип, FR-007/FR-013), CLI не меняется (NG-1, FR-012), контракты аддитивны (FR-016, SC-007).
- Диагностики/недомолвки отсутствуют; SUCCESS-критерии SC-001..SC-007 измеримы на reference-проекте 024 и legacy-суите composer.
- Отклонение от «technology-agnostic» в SC осознанно и соответствует конвенции repo (025/023 тоже ссылаются на `terraform plan`/`ycsf plan`): это spec внутреннего инструментария, а не пользовательского продукта.