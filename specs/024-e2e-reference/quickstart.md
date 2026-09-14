# Quickstart — reference-проект: от clone до `terraform plan` (spec 024)

**Branch**: `024-e2e-reference` | **Статус**: Phase 1 design | **Артефакты**: [data-model.md](./data-model.md) (формы конфигов), [contracts/reference-project.json](./contracts/reference-project.json) (boundary-контракт plan без кред), [plan.md](./plan.md) (§Pipeline, §Strategy верификации)

Документ — **валидационный гайд** (scalable scenarios Sc1..Sc6), а не реализация; полные формы конфигов — в data-model, EFL-го исходники — в tasks.md.

---

## 0. Prerequisites

| Что | Требование |
|-----|-----------|
| Node | ≥ 22 |
| pnpm | workspace-monorepo |
| Terraform CLI | ≥ 1.5 (эмпирика: v1.15.8 darwin/arm64; pinned в README, A-1/A-8) |
| Docker daemon | требуется ТОЛЬКО для полного пути analytics (A-4); free-path без него (см. границы) |
| Cloud credentials | НЕ нужны для check→validate; нужны только для реального `plan` (US-4, runtime-env, не в репо) |

Единственная сетевая активность — `pnpm install` + `terraform init` (загрузка provider plugins). Registry-push не выполняется (D-6).

---

## 1. Sc1 — clone + установка

```bash
git clone <repo-url> serverless-tools
cd serverless-tools
pnpm install
```

**Expected**: все workspace-пакеты резолвятся; `examples/reference-project` подхватывается глобом `examples/*` (FR-001), пакеты подключаются `workspace:*`.

**Gate/check**: `pnpm --filter @ycforge/reference-project exec node -e "console.log(1)"` — не ошибка; `pnpm ls @ycforge/pilot` показывает резолв.

---

## 2. Sc2 — контрактная валидация: `ycsf check`

```bash
pnpm --filter @ycforge/reference-project check
# = ycsf check --validate-tf
```

**Expected (gate)**: `ycsf check` **0 диагностик/коллизий** (FR-015); suspicious-ключей в `build_env` frontend нет (D-7). Дерево `.ycsf/*` валидно: apps MAP-form (4 app), builders/materializers явный mapping (BRG-коллизий и BRG_UNKNOWN_BUILDER нет), extensions/outputs IDL-адресуемы. `--validate-tf` дополнительно гоняет `terraform validate` в `infra/` (требует сгенерированных `.tf.json`; на чистом checkout падает только на EMPTY-файлах, как спроектировано в P3).

**RED-фикстурa** (для тестов, не эталон): неканонический `orders` в apps.yaml → коллизия/диагностика fail-fast (FR-002/FR-022).

---

## 3. Sc3 — build + materialize

```bash
pnpm --filter @ycforge/reference-project exec ycsf build
pnpm --filter @ycforge/reference-project exec ycsf materialize
```

**Expected (gate)**:
- `build`: артефакты всех четырёх приложений валидных форм (FR-016); порядок топологический (user_service/analytics/frontend → openapi, `deterministicOrder`); analytics собирается локально без push, digest `{{.Id}}` (FR-024); повторный build на неизменённых src — тёплый кэш, builder'ы не вызваны (FR-012, spec 022).
- `materialize` (cwd=`infra/`): `infra/user_service.ycsf.tf.json`, `infra/analytics.ycsf.tf.json`, `infra/frontend.ycsf.tf.json`, `infra/openapi.ycsf.tf.json` (+ companion `infra/generated/openapi-openapi.yaml`), `infra/99-ycsf-outputs.tf.json` (user + auto outputs; FR-017).
- Golden-структуру каждого файла — см. [data-model §9](./data-model.md); схема — [contracts/reference-project.json](./contracts/reference-project.json).

**Hard-assерты**: addresses `yandex_function.user_service`, `yandex_serverless_container.analytics`, `yandex_storage_bucket.frontend`, `yandex_api_gateway.openapi` — стабильны (FR-017, D-4).
**RED**: повторный прогон — byte-for-byte идентичный `infra/*.tf.json` (FR-020, golden.spec).

---

## 4. Sc4 — terraform init (единственная сетевая стадия)

```bash
cd infra
terraform init
```

**Expected (gate)**: provider `yandex-cloud/yandex ~> 0.145.0` скачивается из registry.terraform.io; записывается `infra/.terraform.lock.hcl` (коммитится, FR-014/FR-018); никаких креденшалов не требуется.

**RED**: недоступность registry → fail-fast именно на стадии init с stage-именем (FR-013).

---

## 5. Sc5 — terraform validate (offline, 0-диагностик)

```bash
cd infra
terraform validate
```

**Expected (gate)**: `Success! The configuration is valid.` — 0 диагностик на всех сгенерированных ресурсах + `main.tf`. Ловит неполноту конфигурации (например `user_hash`) без облака (эмпирика plan:239).
**RED**: сломанный `.tf.json` (удалён `user_hash`) → validate сообщает об ошибке — контракт-нулевых-диагностик; тест `check-boundary` (T029).

---

## 6. Sc6 — terraform plan (граница без креденшалов, FR-019)

```bash
cd infra
terraform plan
```

**С kredами** (runtime-env контрибьютора): успешный план, ровно 4 managed-ресурса со стабильными addresses (US-4 AC1).
**Без kred** (детерминированный CI-путь, FR-019/D-5): конвейер останавливается **ровно и только** на границе настройки provider — до любого обращения к Yandex Cloud:

> `Error: one of 'token' or 'service_account_key_file' should be specified`
> *(exit ≠ 0; место диагностики — стадия terraform plan, ни одна более ранняя стадия не падает)*

**Default wording для README/tests** (фиксируется characterization-локом, D-9):
> «ycsf check/build/materialize и terraform validate работают локально и оффлайн; terraform init обращается только к registry.terraform.io; terraform plan без credentials гарантированно завершает fail с диагностикой конфигурации провайдера до какого-либо вызова Yandex Cloud. Docker-registry (push) не выполняется вовсе (no_push; digest — локальный).»

Логи combination: структура плана (ресурсы/addresses) верифицируется по `infra/*.tf.json` + validate; реальная связка gateway↔apps — по `${yandex_function.user_service.id}` etc. в gate-спецификации (D-4) и golden companion-файле.

---

## 7. Единая команда (FR-011)

```json
{
  "scripts": {
    "plan":  "ycsf check && ycsf build && ycsf materialize && terraform init && terraform validate && terraform plan",
    "check": "ycsf check --validate-tf",
    "test":  "vitest run"
  }
}
```

`pnpm --filter @ycforge/reference-project plan` = одна команда от clone до плана (US-1). `ycsf plan` не используется в эталоне (не гонит check/validate — plan.md:252). `test` — hermetic vitest (golden, secret-scan, check-boundary characterization, docs-lint, model-sanity), без сети и без облака.

---

## 8. Сценарии приёмки (маппинг на US/SC)

| Sc | Сценарий | Условие | Gate |
|----|----------|---------|------|
| Sc1 | clone + install | clean checkout | FR-001, SC-001 |
| Sc2 | `ycsf check` | — | 0-диагностик (FR-015) |
| Sc3 | build+materialize | — | 4 валидных артефакта + `infra/*.tf.json` (FR-016/017) |
| Sc4 | `terraform init` | сеть до registry | lock.hcl, provider (FR-014/018) |
| Sc5 | `terraform validate` | offline | Success (FR-018, SC-004) |
| Sc6 | `terraform plan` | c/без kred | 4 ресурса или документированный стоп (FR-019) |

Инкрементальность (US-6), локальный dev-server 023 (US-7), docs-каноничность (US-3) — отдельные сценарии тестов, см. [tasks.md](./tasks.md) T018/T019, T025-T031.

---

## 9. Вне scope план/quickstart (не запускается в эталоне)

- `terraform apply` / `ycsf apply`, destroy, publish, деплой (roadmap: plan — финальная стадия, D-«Out of scope»).
- Push docker-image в registry (no_push).
- Cloud credentials в репо (`.env*` запрещены; credentials — runtime-env).
- Внешние resources.yaml-сущности.

Секрет-скан (FR-023) и docs-lint (FR-022) — в vitest-корпусе, см. tasks T027/T028.