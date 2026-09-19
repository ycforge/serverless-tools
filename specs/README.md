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
| 007 | auth-config — `auth.yaml`, scheme types none/jwt/function, валидация ссылок | §11–12 | ✅ | 002 |
| 008 | api-composition — merge specs, fail-fast конфликты, provenance (internal), overrides global/local | §13–14 | ✅ | 006, 007 |
| 009 | resource-references — IDL/IDT/IDR, `${resources...}` template syntax, ENV-only mode | §15–19 | ✅ | 002 |
| 010 | ycsf-api-cli — `ycsf-api compile` / `ycsf-api check` | §3 | ✅ | 008, 009 |

## Волна 3 — Project C (orchestrator)

| # | Spec | Scope | Статус | Зависимости |
|---|------|-------|--------|-------------|
| 011 | project-model — `.ycsf/*.yaml` форматы, `version: 1`, apps/resources ownership, `depends_on` граф | §4–6, §17 | ✅ | 002 |
| 012 | build-env — `{{$ENV}}` интерполяция, `build_env`, ENV validation | §6, §19 | ✅ | 011 |
| 013 | builder-registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов | §21 | ✅ | 002, 011 |
| 014 | materializer-dispatch — collision policy, TerraformResource → `.tf.json` | §22–24 | ✅ | 002, 013 |
| 015 | extensions — `.ycsf/extensions.yaml` IDL-адресация, deep merge | §25 | ✅ | 014 |
| 016 | outputs — `.ycsf/outputs.yaml`, auto-generated outputs | §26 | ✅ | 014 |
| 017 | moved — `.ycsf/moved.yaml`, Terraform `moved` blocks | §34–35 | ✅ | 014 |
| 018 | builders-core — nestjs-function (bundling), docker, vite builders | §5, §21, §36–37 | ✅ | 002, 013 |
| 019 | materializers-yandex — function/container/api-gateway/queue/bucket TF materializers | §22, §27, §32–33, §37 | ✅ | 002, 014 |
| 020 | ycsf-check — `ycsf check` validation layer | §28 | ✅ | 011, 014–017 |
| 021 | ycsf-cli — build/materialize/plan/apply/destroy | §20, §30, §40 | ✅ | 013, 014, 020 |
| 022 | incremental-builds — content-addressed кэш артефактов | §39 | ✅ | 021 |

## Волна 4 — интеграция

| # | Spec | Scope | Статус | Зависимости |
|---|------|-------|--------|-------------|
| 023 | local-dev-server — `@ycforge/js-dev-tools/server`, payload 2.0 эмуляция | §38 | ✅ | 001 |
| 024 | e2e-reference — reference-проект (user_service + analytics + frontend + openapi), build → terraform plan | §30, §41 | 🚧 | 001–023, 025, 026, 027, 028 |

## Волна 5 — e2e enablement

| # | Spec | Scope (IDEA.md) | Статус | Зависимости |
|---|------|-----------------|--------|-------------|
| 025 | pilot-e2e-enablement — значения артефактов через materialize (BIG-1), artifact-типы в builders-реестре (BIG-2), suspicious-keys в `ycsf check` (BIG-6) | §24, §26, §28, §36 | ✅ | 013, 014, 016, 020, 021, 022 |
| 026 | composer-builder — Builder-модуль `@ycforge/composer/builder` (`ycforge:api-gateway`) в конвейере `ycsf build`, единый источник истины по проектной модели (BIG-3, BIG-4) | §3, §10, §13–19 | ✅ | 006, 007, 008, 009, 010, 025 |
| 027 | docker-no-push — локальная сборка `ycforge:docker-image` без push (`image.no_push`, digest из локального daemon, инвариант never-a-mutable-tag) (BIG-5) | §37 | ✅ | 013, 018, 025 |
| 028 | e2e-final-enablement — пять фиксов тулчейна по research.md 024 (composer refs против app-модели; standalone materialize; required YC attrs + companion path; docker dev-modes registry-ref/remote; pilot registry consumer-graph + key namespaces) | §3, §10, §13–19, §21–24, §26, §30, §37 | ✅ | 024…, 025, 026, 027 |

## Правила

- Нумерация specs не переиспользуется; новая фича — следующий свободный номер.
- Колонка Scope — точка входа в IDEA.md, а не замена чтения; при расхождении spec и IDEA.md обновляется IDEA.md (specs первичны, constitution важнее обоих).
- Issues в GitHub создаются на этапе `/speckit.tasks` → `/speckit.taskstoissues` для фичи в работе, а не для запланированных specs.

## Волна 6 — follow-ups, зарегистрированные convergence-ом 024 (pure-package, 024 не трогает packages)

Зарегистрированы по findings-ам `/speckit-converge` спеки 024 (T034–T037, T044); объем фиксов — только `packages/*`, 024-эталон остаётся неизменным. **031–034 закрыты 028** (e2e-final-enablement, вл. 5): fix-ы Fix-1/Fix-2/Fix-3/Fix-5 — см. строки ниже.

| # | Spec | Scope (IDEA.md) | Статус | Зависимости |
|---|------|-----------------|--------|-------------|
| 029 | pilot-dir-alignment — `ycsf check` обязан валидировать те же сгенерированные `.tf.json`, что пишет materialize (`.ycsf/` vs `infra/`, D9); снэпшот-механизм 024 T033 после этого устаревает | §28, §30 | ⬜ | 020, 021 |
| 030 | docker-context-resolution — build-context `sourcePath` резолвится от projectRoot, а не от `cwd=sourcePath` (D10) | §36 | ⬜ | 018, 021 |
| 031 | materialize-standalone-values — **закрыто в 028 (Fix-2)**: `ycsf build` пишет `.ycsf/artifacts/<appId>/artifact.json`, `ycsf materialize` читает store/`--artifacts` | §22–24, §39 | ✅ | 021, 028 |
| 032 | materializer-provider-shapes — **закрыто в 028 (Fix-3)**: `yandex_function` += `name`/`memory`, `yandex_api_gateway` += `name`, companion → `<rootDir>/infra/generated/` | §22, §27 | ✅ | 019, 028 |
| 033 | registry-workspace-resolution — **закрыто в 028 (Fix-5)**: consumer-graph резолюция из корня проекта, pnpm-aware subpath exports | §21 | ✅ | 013, 028 |
| 034 | composer-path-level-refs — **закрыто в 028 (Fix-1)**: ресурсный индекс объединяет app-identities C-модели, `${resources.<domain>.<app_id>.<property>}` валиден без resources.yaml | §23, §27 | ✅ | 016, 028 |
| 036 | apigw-http-transport — HTTP transport для события Yandex API Gateway `cloud_functions` (v1): расширение `http`-транспорта nest-bridge, закрытие 502-гэпа reference e2e | §2 | ✅ | 024, 003 |

## Волна 7 — облачной e2e

| # | Spec | Scope (IDEA.md) | Статус | Зависимости |
|---|------|-----------------|--------|-------------|
| 037 | cloud-e2e — воспроизводимый облачной e2e: отдельный standalone тест-проект в `e2e/` реально разворачивается в YC (functions/container/bucket/gateway/MQ), живые HTTP/MQ/S3/KMS-проверки, moved/cache/overrides/resources/env, teardown; e2e в CI не подключается | §30, §41 | ✅ | 024, 025–028, 036 |

## Волна 8 — connector transport follow-ups (найдено e2e 037)

| # | Spec | Scope (IDEA.md) | Статус | Зависимости |
|---|------|-----------------|--------|-------------|
| 038 | apigw-scalar-params — API Gateway материализует OpenAPI-дефолт типизированного параметра (`type: integer` → JSON-число) в v1-карту `params`; валидатор A требует только строки → 502 на вызове без параметра. Приём `string\|number\|boolean` в картах параметров + единственная точка нормализации скаляров в строки на границе транспорта; fail-fast к структурным аномалиям сохранён; шлюзовые дефолты в app-запрос не мёржатся | §2 | 🚧 | 036 |
