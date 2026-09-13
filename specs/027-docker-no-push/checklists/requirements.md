# Specification Quality Checklist: docker-no-push — локальная сборка `ycforge:docker-image` без публикации в registry

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-13
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
- FR-001–FR-008 are testable with hermetic fixture tests: fake-docker (`test/helpers/fake-bins.ts`, расширенный режимом локального digest) + журнал argv как доказательство «push не вызывался»; в текущей среде (docker daemon не запущен, проверено 2026-09-13) ни один тест не требует реального daemon — characterization через fake (Constitution II exception, как в 018).
- D-1..D-6 фиксируют решения: расположение/имя опции (`image.no_push`), additive contract, локальный digest из daemon при сохранении инварианта «never a mutable tag», fail-fast без новых BLC-кодов, неизменность tag-семантики, 0 правок C/B/materializers.
- 0 [NEEDS CLARIFICATION] — все развилки закрыты разумными дефолтами и документированы (опция `image.no_push`; локальный content-digest ≠ будущий registry manifest-digest — A-2/D-3; диагностика через существующие `BLC_BUILD_FAILED`/`BLC_IMAGE_DIGEST_UNAVAILABLE` — D-4).
- Уровень технической детализации (CLI-subcommand'ы `docker build`/`push`, коды `BLC_*`, имя опции) соответствует принятой конвенции технических spec-toolchain в репо (023, 025, 026) — это не «преждевременная структура кода», а user-facing контракт поведения builder'а.
- Аддитивность: опция аддитивна (NG-1..NG-8), push-режим по умолчанию не меняется (FR-007, SC-005) — застраховано сохранением всего существующего `docker.spec.ts` как регрессионной базы.
- Contract trace: `DockerBuildConfig`/`dockerBuildConfig` (builders-core.json) расширяются только optional-полем `image.no_push`; `DockerArtifactValue` не меняется (SC-007); materializer yandex-serverless-container не трогается (NG-3).
- Acceptance: US-1..US-5 + SC-001..SC-007 + 17 Given/When/Then-сценариев; «Никаких [NEEDS CLARIFICATION]» в §14 — декларация приёмки (конвенция 025), не маркер.