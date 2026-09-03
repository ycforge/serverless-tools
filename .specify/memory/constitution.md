# serverless-tools Constitution

Источник: `IDEA.md` (разделы «Что принципиально НЕ должно попасть в architecture», «Основные architectural invariants», «Главная ментальная модель»). При расхождении constitution и feature-spec constitution побеждает; изменение constitution — отдельное обсуждение с обновлением IDEA.md.

## Core Principles

### I. Разделение ответственности A/B/C/Terraform (NON-NEGOTIABLE)

A отвечает за runtime, B — за API composition, C — за orchestration/build, Terraform — за provisioning/deployment.

- **A не framework**: тонкий runtime adapter; никакого deployment, provisioning, API Gateway compilation, auth-инфраструктуры.
- **B не Terraform compiler**: только API composition и OpenAPI/API Gateway semantics; B не знает Terraform и не импортирует user-код.
- **C не god tool**: не управляет Yandex API напрямую, не имеет собственного provisioning engine и deployment backends, не знает внутренние схемы NestJS/Docker/OpenAPI/auth.yaml/provider-полей.
- **Terraform — единственный deployment engine**. Никакого собственного serverless-tools DSL поверх provider schema.

### II. Spec-First, Test-First (NON-NEGOTIABLE)

Код не пишется вне цикла specify → plan → tasks → implement. Тесты генерируются из acceptance criteria спецификации ДО реализации; RED подтверждается запуском, затем GREEN. Каждый acceptance criterion → минимум один тест (traceability). Исключение: тонкие оркестрационные слои C (вызов Terraform CLI) покрываются characterization-тестами постфактум — осознанно, а не импровизацией.

### III. Контракты версионируются

Builder/Materializer API, форматы `.ycsf/*.yaml`, Artifact — контракты между независимыми npm-пакетами. Каждый `.ycsf/*.yaml` имеет `version: 1`. Контракты плагинов экспортируются из `@ycforge/pilot/contracts` и версионируются по semver вместе с pilot; breaking change = major + migration guide. Artifact type — `<package-scope>:<kind>`.

### IV. Terraform остаётся настоящим Terraform

User-owned `.tf` и C-generated `.tf.json` живут в одном module directory. C генерирует только минимально необходимый resource; provider-specific поля — через `.ycsf/extensions.yaml` (IDL-адресация, deep merge) или user `.tf`. C не моделирует provider schema и не валидирует её (это делает `terraform validate`).

### V. Явное вместо магии

Builder/materializer discovery — explicit mapping (`.ycsf/builders.yaml`), не auto-discovery. Все `{{$ENV}}` обязательны и валидируются до запуска builder. Коллизии (один artifact type — два materializer; один path/operationId — два app; identity в apps.yaml и resources.yaml одновременно) — fail-fast error, не merge. Default scheme не выводит Guard.

### VI. Ownership: apps = managed, resources = external

Apps — buildable source units, C генерирует для них Terraform resources. Ресурсы из `resources.yaml` — всегда external (reference only). Application и resource — разные сущности; logical identity стабильна, переименования — только через `.ycsf/moved.yaml`.

## Дополнительные ограничения

- Монорепозиторий npm/pnpm — это исходный код **инструментов** serverless-tools, а не деплоимое приложение: `packages/nest-bridge` (A, `@ycforge/nestjs-connector`; историческое имя `@ycforge/ycsf-nestjs-connector`, мигрирует из github.com/ycforge/ycsf-nestjs-connector), `packages/composer` (B, `@ycforge/composer`), `packages/pilot` (C, `@ycforge/pilot`), builders/materializers — отдельные пакеты. Отдельного SDK-пакета нет: контракты плагинов — часть публичного API pilot (`@ycforge/pilot/contracts`).
- Секреты: не в build config, не в frontend bundle; runtime secrets — через Lockbox/extensions-паттерн.
- Frontend build environment — только public/build-time данные.
- OpenAPI build — safe mode через explicit `openapi_entry`; B всегда ставит `SERVERLESS_TOOLS_OPENAPI_BUILD=1`.
- Примеры и канонические форматы в документах согласованы между разделами (единый reference-проект: `user_service`, `analytics`, `frontend`, `openapi`).

## Development Workflow

- Один spec = один фокус = одна ветка.
- После tasks — обязательно analyze (консистентность spec/plan/tasks) до implement.
- После implement — converge; расхождения spec↔код → новые задачи или обновление spec.
- Расхождение spec ↔ IDEA.md → обновляется IDEA.md (specs первичны).
- Внешний цикл spec-to-spec: после converge — статус ✅ в `specs/README.md`, затем берётся следующая ⬜ spec со всеми закрытыми зависимостями (низший номер); обновление roadmap обязательно — это единственный источник истины о прогрессе между сессиями. Подробно — секция «Agent work loop» в AGENTS.md.
- `ycsf check`/`ycsf-api check` — lightweight contract validation; глубокая Terraform-валидация — `terraform validate`.

## Governance

Constitution имеет приоритет над feature specs и plans. Изменение constitution требует явного обсуждения и синхронного обновления `IDEA.md`. Все PR/reviews проверяют соответствие принципам I–VI; отклонение от Test-First допустимо только в оговорённых принципом II случаях.

**Version**: 1.1.0 | **Ratified**: 2026-09-03 | **Last Amended**: 2026-09-03
