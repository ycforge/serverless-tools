# serverless-tools Specs Roadmap

Разработка ведётся по SDD (spec-kit). Правила процесса — в `.specify/memory/constitution.md`. Архитектурный контекст — `IDEA.md` (читать точечно, по ссылкам на разделы).

**Эта монорепа — исходный код инструментов serverless-tools, а не деплоимое приложение.** Пакеты:

- `packages/nest-bridge` — Project A (`@ycforge/nestjs-connector`; историческое имя `@ycforge/ycsf-nestjs-connector`, код мигрирует сюда из https://github.com/ycforge/ycsf-nestjs-connector);
- `packages/composer` — Project B (`@ycforge/composer`, API Gateway / OpenAPI Composition Builder);
- `packages/pilot` — Project C (`@ycforge/pilot`, Build/Deployment Orchestrator); plugin contracts экспортируются через `@ycforge/pilot/contracts`;
- builders/materializers — отдельные пакеты.

Specs создаются **перед реализацией соответствующей фичи**, а не все заранее. Этот файл — карта планируемых specs; при старте работы над фичей создавайте spec по `/speckit.specify`, сверяясь с указанными разделами IDEA.md.

> Как читать IDEA.md точечно: разделы имеют стабильные заголовки `# N.`. Найти раздел — `grep -n "^# 25\." IDEA.md`, затем читать только нужный диапазон строк (`sed -n 'A,Bp' IDEA.md`). Читать файл целиком не нужно.

## Статус легенды

- ✅ — spec написана
- 🚧 — в работе
- ⬜ — запланирована

## Волна 0 — фундамент

| # | Spec | Scope (IDEA.md) | Статус | Зависимости |
|---|------|-----------------|--------|-------------|
| 001 | connector-reverse — reverse-spec Project A | §2, §11 | ✅ | — |
| 002 | pilot-contracts — Builder/Artifact/Materializer/TerraformResource/ResourceReference/OutputBuilder (контракты `@ycforge/pilot/contracts`), версионирование | §7, §8, §15, §22, §23, §26, §42, §43 | ✅ | — |

## Волна 1 — Project A gaps (по таблице расхождений в specs/001)

| # | Spec | Scope | Статус | Зависимости |
|---|------|-------|--------|-------------|
| 003 | connector-require-auth — `@RequireAuth`, subpath exports `/auth`/`/queue`/`/context`, global guard | §11, §2 | ✅ | 001 |
| 004 | connector-observability — unified logger в stdout, `trace_id` в контексте и error-ответе | §2 | ✅ | 001 |
| 005 | connector-mq-partial-failure — опциональная per-message семантика ошибок batch MQ | §2 | ✅ | 001 |

## Волна 2 — Project B (API composition)

| # | Spec | Scope | Статус | Зависимости |
|---|------|-------|--------|-------------|
| 006 | openapi-extraction — `openapi_entry`, fallback chain, `SERVERLESS_TOOLS_OPENAPI_BUILD=1`, metadata-only | §10 | ✅ | 002 |
| 007 | auth-config — `auth.yaml`, scheme types none/jwt/function, валидация ссылок | §11–12 | 🚧 | 002 |
| 008 | api-composition — merge specs, fail-fast конфликты, provenance (internal), overrides global/local | §13–14 | ⬜ | 006, 007 |
| 009 | resource-references — IDL/IDT/IDR, `${resources...}` template syntax, ENV-only mode | §15–19 | ⬜ | 002 |
| 010 | ycsf-api-cli — `ycsf-api compile` / `ycsf-api check` | §3 | ⬜ | 008, 009 |

## Волна 3 — Project C (orchestrator)

| # | Spec | Scope | Статус | Зависимости |
|---|------|-------|--------|-------------|
| 011 | project-model — `.ycsf/*.yaml` форматы, `version: 1`, apps/resources ownership, `depends_on` граф | §4–6, §17 | ⬜ | 002 |
| 012 | build-env — `{{$ENV}}` интерполяция, `build_env`, ENV validation | §6, §19 | ⬜ | 011 |
| 013 | builder-registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов | §21 | ⬜ | 002, 011 |
| 014 | materializer-dispatch — collision policy, TerraformResource → `.tf.json` | §22–24 | ⬜ | 002, 013 |
| 015 | extensions — `.ycsf/extensions.yaml` IDL-адресация, deep merge | §25 | ⬜ | 014 |
| 016 | outputs — `.ycsf/outputs.yaml`, auto-generated outputs | §26 | ⬜ | 014 |
| 017 | moved — `.ycsf/moved.yaml`, Terraform `moved` blocks | §34–35 | ⬜ | 014 |
| 018 | builders-core — nestjs-function (bundling), docker, vite builders | §5, §21, §36–37 | ⬜ | 002, 013 |
| 019 | materializers-yandex — function/container/api-gateway/queue/bucket TF materializers | §22, §27, §32–33, §37 | ⬜ | 002, 014 |
| 020 | ycsf-check — `ycsf check` validation layer | §28 | ⬜ | 011, 014–017 |
| 021 | ycsf-cli — build/materialize/plan/apply/destroy | §20, §30, §40 | ⬜ | 013, 014 |
| 022 | incremental-builds — content-addressed кэш артефактов | §39 | ⬜ | 021 |

## Волна 4 — интеграция

| # | Spec | Scope | Статус | Зависимости |
|---|------|-------|--------|-------------|
| 023 | local-dev-server — `@ycforge/js-dev-tools/server`, payload 2.0 эмуляция | §38 | ⬜ | 001 |
| 024 | e2e-reference — reference-проект (user_service + orders + frontend + openapi), build → terraform plan | §30, §41 | ⬜ | все волны 1–3 |

## Правила

- Нумерация specs не переиспользуется; новая фича — следующий свободный номер.
- Колонка Scope — точка входа в IDEA.md, а не замена чтения; при расхождении spec и IDEA.md обновляется IDEA.md (specs первичны, constitution важнее обоих).
- Issues в GitHub создаются на этапе `/speckit.tasks` → `/speckit.taskstoissues` для фичи в работе, а не для запланированных specs.
