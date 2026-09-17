# Аудит конвергенции — 008 api-composition

**Дата**: 2026-09-05 | **Branch**: `008-api-composition` | **HEAD**: `c033eb9` + convergence commits

---

## Область аудита

Спецификация 008, план, контракт, data-model, quickstart — все FR (001–018), все SC (001–007), все acceptance criteria US1–US4, все edge cases. Конституция (I–VI). Реализация в `packages/composer/src/compose/`, `packages/composer/src/compose/overrides/`, `packages/composer/src/index.ts`, тесты (unit + integration), фикстуры `test/fixtures/compose-*`.

---

## FR → модуль → тест

| FR | Модуль(и) | Unit-тест | Integration-тест |
|----|-----------|-----------|------------------|
| FR-001 | `compose.ts` (orchestrator) | `compose.spec.ts` — pipeline order, delegation | `compose.integration.spec.ts` — canonical fixture |
| FR-002 | `merge.ts`, `compose.ts` | `merge.spec.ts` — union paths/components, empty-app | `compose.integration.spec.ts` — US1/AC1, single-app |
| FR-003 | `provenance.ts`, `compose.ts` | `provenance.spec.ts` — ownerByPath, operationIdIndex | `compose.integration.spec.ts` — path→owner provenance |
| FR-004 | `merge.ts` | `merge.spec.ts` — path collision, different methods | `compose.integration.spec.ts` — compose-app-path-collision |
| FR-005 | `merge.ts` | `merge.spec.ts` — operationId collision (cross/within) | `compose.integration.spec.ts` — opid/self-collision fixtures |
| FR-006 | `merge.ts`, `auth-apply.ts` | `merge.spec.ts` — component collision; `auth-apply.spec.ts` — securitySchemes-vs-emission | `compose.integration.spec.ts` — component-collision fixture |
| FR-007 | `overrides/apply.ts`, `overrides/override-yaml.ts` | `apply.spec.ts`, `override-yaml.spec.ts` | `compose.integration.spec.ts` — all override fixtures (7 negative + canonical) |
| FR-008 | `overrides/apply.ts` | `apply.spec.ts` — local scope / foreign path / info | `compose.integration.spec.ts` — local-out-of-scope, local-info |
| FR-009 | `overrides/apply.ts` | `apply.spec.ts` — global→local priority | — (covered within canonical) |
| FR-010 | `overrides/apply.ts`, `overrides/override-yaml.ts` | `apply.spec.ts` — atomic replace (no deep merge) | — (covered within canonical) |
| FR-011 | `auth-apply.ts`, `compose.ts` | `auth-apply.spec.ts` — root security / none/defaultScheme | `compose.integration.spec.ts` — default-public, none-ref |
| FR-012 | `auth-apply.ts` | `auth-apply.spec.ts` — Variant A openIdConnect, function, none, map order | `compose.integration.spec.ts` — securitySchemes exact structure |
| FR-013 | `auth-apply.ts` | `auth-apply.spec.ts` — no ${resources...}/IAM; function_id logical ref | `compose.integration.spec.ts` — no-provisioning check |
| FR-014 | `compose.ts` (copy/clone), `merge.ts` (structuredClone) | `compose.spec.ts` — deep-freeze; `merge.spec.ts` — no mutation | `compose.integration.spec.ts` — inputs byte-parity |
| FR-015 | `compose.ts` (error surfacing) | `compose.spec.ts` — delegation/boundary regression (T035) | `compose.integration.spec.ts` — bad-auth/bad-extract |
| FR-016 | `merge.ts` | `merge.spec.ts` — version mismatch | `compose.integration.spec.ts` — version-mismatch fixture |
| FR-017 | `compose.ts` FINALIZE, `merge.ts` sortRecordKeys | `merge.spec.ts` — canonical sort; `provenance.spec.ts` — no-leak | `compose.integration.spec.ts` — order-swap (canonical + T042 local-add) |
| FR-018 | `auth-apply.ts` (scope boundary) | `auth-apply.spec.ts` — no integration/IAM/artifacts | `compose.integration.spec.ts` — no ${resources...} in output |

---

## SC → тест

| SC | Тест |
|----|------|
| SC-001 | `compose.integration.spec.ts` (US1–US4 + edge scenarios); `compose.spec.ts` (pipeline order) |
| SC-002 | `compose.integration.spec.ts` — order-swap determinism (canonical + T042 local-add); `merge.spec.ts` — canonical key sort |
| SC-003 | `compose.integration.spec.ts` — all negative fixtures (7 collision/override/auth) |
| SC-004 | `compose.integration.spec.ts` — no provenance in document; `provenance.spec.ts` — no-leak walkJsonKeys |
| SC-005 | `compose.spec.ts` — pipeline order; `apply.spec.ts` — priority/sequential; `auth-apply.spec.ts` — defaultScheme/none |
| SC-006 | `compose.integration.spec.ts` — no-provisioning; `auth-apply.spec.ts` — no-${resources}/IAM/Lockbox |
| SC-007 | `compose.spec.ts` — input immutability; `compose.integration.spec.ts` — delegation 006/007 surfacing as own types |

---

## Тест-матрица

| Файл | Количество тестов | Покрытые US |
|------|-------------------|-------------|
| `compose-errors.spec.ts` | 5 | Foundational |
| `provenance.spec.ts` | 4 | US1 |
| `merge.spec.ts` | 13 | US1, US2, Edge |
| `compose.spec.ts` | 11 | US1, US2, US5, Edge |
| `overrides/override-yaml.spec.ts` | 12 | US3 |
| `overrides/apply.spec.ts` | 10 | US3 |
| `auth-apply.spec.ts` | 12 | US4 |
| `test/compose.integration.spec.ts` | 23 | US1–US5, Edge |
| **Итого compose** | **207** | |

Предыдущий baseline (006+007): 117 → текущий: 207 (прирост +90, включая +1 convergence T042-тест).

---

## Divergence notes

1. **Fixture `compose-app-no-info/`** перечислен в `plan.md` §Project Structure и `quickstart.md`, но не создан. Путь `COMPOSE_INFO_MISSING` покрыт интеграционным тестом через `compose-app-path-collision` fixture (интеграция строка 244–254) — функциональный критерий удовлетворён; отдельный fixture — упущение документации, не функциональный пробел.

---

## CLARIFY

**2026-09-05 (фаза /speckit-plan)**: Тип parent securityScheme для jwt схемы при auth-эмиссии — принят вариант A (`openIdConnect` + производный `openIdConnectUrl`). Детали в `spec.md` (секция «Clarifications»), `research.md` (R5), `contracts/api-composition.md` (секция «Auth-применение»). Конфликт с контрактами не產生: эмиссия внутри стабильной границы authorizer; новые Override-конфликты не вводят; новые коды `ComposeError` не требуются.

---

## Gates

| Gate | Ожидаемое | Факт | Статус |
|------|-----------|------|--------|
| `pnpm --filter @ycforge/composer test` | 207 | 207 | ✅ |
| `pnpm --filter @ycforge/composer typecheck` | 0 ошибок | 0 ошибок | ✅ |
| `pnpm lint` (root) | clean | clean | ✅ |
| `pnpm test` (root) | ≥703 | 704 (55 pilot + 207 composer + 442 nest-bridge) | ✅ |
| `pnpm --filter @ycforge/composer build` | ok | ok | ✅ |

---

## Конституция

| Принцип | Статус | Комментарий |
|---------|--------|-------------|
| I. Разделение A/B/C | ✅ | B — composition (merge/conflicts/auth/overrides); эмиссия `functions.<name>` логических ссылок; 006/007 вызываются через публичный API; C/011/009/019 не дублируются |
| II. Spec-first, test-first | ✅ | Все AC → минимум 1 тест; RED-before-GREEN подтверждён в tasks.md (T003–T035); convergence T042 RED→GREEN доказан (RED: probe, GREEN: fix+тест) |
| III. Контракты версионируются | ✅ | `overrides.yaml` version: 1; `@ycforge/composer` semver; контрактная версия 1 (аддитивные расширения) |
| IV. Terraform остаётся Terraform | ✅ | B не моделирует provider schema; `${resources...}` / IDR — шов к 009/019; `service_account_id`/`tag` не эмитятся |
| V. Явное вместо магии | ✅ | Fail-fast на всех коллизиях (path/operationId/component/version/none-ref/info-missing); overrides = explicit + atomic; finality sort (FR-017); no deep merge |
| VI. Ownership apps vs resources | N/A | B не читает apps.yaml; участники caller-provided |

---

## Итог

**Конвергентно.**

Реализация (commit `c033eb9` + convergence commits T042) покрывает все FR-001–FR-018, все SC-001–SC-007, все acceptance criteria US1–US4 и все edge cases из спецификации. Найден один пробел (FR-017 FINALIZE-детерминизм при override-added paths двух участников), исправлен в T042 (RED→GREEN). Второе наблюдение (отсутствие fixtures `compose-app-no-info`) задокументировано как divergence; путь `COMPOSE_INFO_MISSING` покрыт интеграционным тестом. Межпакетные границы (006/007 delegation), zero-runtime deps, public contract, и determinism invariants — все удовлетворены.
