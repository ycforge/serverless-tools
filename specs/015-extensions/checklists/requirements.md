# Specification Quality Checklist: Extensions (`.ycsf/extensions.yaml`, IDL-адресация, deep merge)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — PASS (по инженерной конвенции репо спецификация содержит контрактные TS-типы (`ExtensionRule`, `ExtensionsYaml`, `ApplyExtensionsResult`), error codes `EXT_*` и нормативную таблицу доменов — это часть публичного API, как в specs 012/013/014; HOW-выборы (конкретные модули/файлы) отложены в plan)
- [x] Focused on user value and business needs — PASS (US1–US8 с Priority, Why, Independent Test, AC; сценарии — DevOps-пользователи)
- [x] Written for non-technical stakeholders — PASS (русская проза, пользовательские сценарии на естественном языке)
- [x] All mandatory sections completed — PASS (Metadata, Problem Statement, Scope In/Out, User Scenarios & Testing, Edge Cases, Requirements (FR), Error Codes, Key Entities, Success Criteria, Assumptions, References, Next Steps)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — PASS (0 markers; все решения приняты через documented Assumptions: side-table IDL-механизм, EXT_DUPLICATE_TARGET=error, отсутствие EXT_MERGE_ERROR, EXT_MISSING_FILE throw-семантика)
- [x] Requirements are testable and unambiguous — PASS (FR-001..FR-015, каждая MUST-формулировка с конкретным кодом/состоянием; merge-семантика §25.2 задана точным правилом «recursive только когда оба plain-object, иначе replace»)
- [x] Success criteria are measurable — PASS (SC-001..SC-008, включая SC-008: 100% AC → ≥1 тест; SC-001 байт-детерминизм; SC-004 replace-проверка)
- [x] Success criteria are technology-agnostic (no implementation details) — PASS (SC формулируются через observable outcomes: детерминизм байт, untouched .tf, passthrough строк, replace массивов)
- [x] All acceptance scenarios are defined — PASS (8 User Stories, 17 Acceptance Scenarios, плюс блок Edge Cases из 13 пунктов)
- [x] Edge cases are identified — PASS (empty patch, empty list, nested array replace, patch в null/отсутствующий ключ, несуществующий домен, 1/3+ сегментов, duplicate YAML-keys, duplicate target, duplicate IDL-invariant, ресурс вне таблицы, non-object configuration, циклы)
- [x] Scope is clearly bounded — PASS (Scope boundaries: Out of Scope таблица — override.tf, чтение .tf, {{$ENV}} интерполяция, ${...} валидация, outputs/016, CLI/020-021, изменения 002/014, provider schema)
- [x] Dependencies and assumptions identified — PASS (deps 002/014; Assumptions: side-table механизм с обоснованием vs `idl?` field, passthrough ${...}/{{$ENV}}, опциональность extensions.yaml, инвариант один-app-один-resource, JSON-деревья без циклов)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — PASS (каждый FR-001..FR-015 отражён в ≥1 Acceptance Scenario или Edge Case)
- [x] User scenarios cover primary flows — PASS (happy path US1, array replace US2, target typo US3, duplicate target US4, untouched .tf US5, determinism US6, structure/version US7, empty/missing-file US8)
- [x] Feature meets measurable outcomes defined in Success Criteria — PASS (SC напрямую проверяемы через AC)
- [x] No implementation details leak into specification — PASS (пойманные решения о механизмах задокументированы как решения/assumptions в Scope (2) и Assumptions; конкретные файлы/модули — в Next Steps для plan)

## Notes

- Проект использует инженерные спецификации (SDD); присутствие контрактных TS-типов (`ExtensionRule`, `ExtensionsYaml`, `ExtensionsLoadResult`, `ApplyExtensionsResult`), error codes `EXT_*`, имени файла `.ycsf/extensions.yaml` и нормативной таблицы `IDL_DOMAIN_BY_TF_TYPE` — по конвенции specs 011/012/013/014, не является нарушением «no implementation details».
- Пункт «Written for non-technical stakeholders» трактуется в контексте репо: спецификации читаются инженерами + авторами плагинов; язык — русский, сценарии — пользовательские.
- 0 `[NEEDS CLARIFICATION]` маркеров; решения по умолчанию: (1) IDL-механизм = explicit side-table `IDL_DOMAIN_BY_TF_TYPE` (C-owned, additive к 002), поле `TerraformResource.idl?` отвергнуто — обоснование в Scope (2); (2) duplicate target = error (`EXT_DUPLICATE_TARGET`), не последовательный merge — Constitution V, прецеденты MTL_COLLISION/MTL_OUTPUT_NAME_COLLISION/PML_DUPLICATE_APP_ID; (3) кода `EXT_MERGE_ERROR` нет — merge total на JSON-дереве; (4) `.ycsf/extensions.yaml` опционален для проекта, `EXT_MISSING_FILE` бросается loader-ом только при вызове без файла; (5) несуществующий домен (грамматически валидный) = `EXT_UNRESOLVED_TARGET`, не структурная ошибка.