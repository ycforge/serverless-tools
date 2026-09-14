# Data Model — reference-проект (spec 024, Phase 1)

**Branch**: `024-e2e-reference` | **Статус**: Phase 1 design | **Связанные артефакты**: [plan.md](./plan.md) (§Project Structure, §Канонические конфигурации, §Golden-контракт), [spec.md](./spec.md) (FR-001..FR-025, D-1..D-10), [contracts/reference-project.json](./contracts/reference-project.json)

Данный документ фиксирует **канонические конфигурации** и **golden-контракт** reference-проекта `examples/reference-project`. Все формы проверены против текущего состояния `packages/` (registry, model loader, builders, materializers, outputs, extensions). Источник истины для примеров в docs/specs 001–023 — FR-021, D-10.

---

## 1. Layout (каноническое дерево)

```text
examples/reference-project/
├── package.json                  # @ycforge/reference-project (FR-001), private, scripts: plan/check/test
├── README.md                     # RU: назначение, границы, пошаговый запуск (FR-025)
├── .env.example                  # документирует ОПЦИОНАЛЬНЫЕ YC_TOKEN/SERVICE_ACCOUNT_KEY_FILE
├── tsconfig.json                 # strict (только тесты; эталон не публикует build-выходов)
├── vitest.config.ts              # include test/**/*.spec.ts, без сети
├── .gitignore                    # .env*, .terraform/, .ycsf/artifacts/, .ycsf/cache/
├── .ycsf/
│   ├── apps.yaml                 # MAP-form; builder = artifact-type (ycforge:*)
│   ├── builders.yaml             # builders keyed ycforge:*; materializers keyed yandex-*
│   ├── extensions.yaml           # только IDL-адресуемые functions.*/gateways.* (spec 015)
│   ├── outputs.yaml              # user outputs через IDL (functions.*/gateways.*)
│   └── (НЕТ resources.yaml — FR-007/FR-010 amendment: logical refs → apps)
├── user_service/
│   ├── build_config.yaml         # <root>/<appId>/build_config.yaml (discovery Project C, §6)
│   └── src/                      # A runtime: NestJS через @ycforge/nestjs-connector
├── analytics/
│   ├── build_config.yaml         # docker no_push (spec 027)
│   ├── Dockerfile                # nodejs22 container runtime
│   └── src/
├── frontend/
│   ├── build_config.yaml         # vite; public-only build_env (D-7)
│   ├── index.html
│   └── src/                      # статика
├── openapi/
│   ├── build_config.yaml         # openapi_entry: openapi.yaml (composer unjust safe mode)
│   ├── openapi.yaml              # routes на apps (Lock-топология, §7)
│   └── auth.yaml                 # defaultScheme: none (требуется composer как вход)
├── apps/                         # источники приложений (source_path из apps.yaml)
│   ├── user_service/
│   ├── analytics/
│   ├── frontend/
│   └── openapi/
└── infra/
    ├── main.tf                   # USER-owned: providers + provider "yandex" {} (C не читает)
    ├── *.ycsf.tf.json            # C-generated (в исходниках отсутствуют; golden — в test/fixtures/)
    ├── generated/openapi-openapi.yaml   # companion gateway-спеки (пишет materializer, при cwd=infra)
    └── .terraform.lock.hcl       # коммитится (FR-014, FR-018)
```

Нюанс ownership: `infra/main.tf` — user-owned, C его никогда не читает/пишет; C-owned только `*.ycsf.tf.json` (письмо через `write.ts`; `infra/generated/*` — companion materializer-а, тоже C-owned). Golden-эталоны кладутся в `test/fixtures/` (не в `infra/`, infra — результат конвейера).

---

## 2. `.ycsf/apps.yaml` — проект-модель C (MAP-form)

FR-007/FR-010 amendment (решение владельца фичи 2026-09-13): logical-ссылки направлены на **apps**; `<name>` в `${resources.<type>.<name>.id}` — это `app_id` из `apps.yaml`; индекс резолвинга — C-модель (map-form); `.ycsf/resources.yaml` отсутствует; `PML_IDENTITY_COLLISION` не возникает (нечего декларировать в resources.yaml).

```yaml
version: 1
apps:
  user_service:
    source_path: apps/user_service
    builder: ycforge:function
    depends_on: []
  analytics:
    source_path: apps/analytics
    builder: ycforge:docker-image
    depends_on: []
  frontend:
    source_path: apps/frontend
    builder: ycforge:frontend
    depends_on: []
  openapi:
    source_path: apps/openapi
    builder: ycforge:api-gateway
    depends_on: [analytics, frontend, user_service]
```

Валидируется `extractApps` (`model/apps.ts`): разрешены только ключи `source_path`/`builder`/`depends_on` (FR-012); `app_id` — `[A-Za-z][A-Za-z0-9_]*`. `builder` обязан присутствовать в `builders:`-мапе реестра (BRG_UNKNOWN_BUILDER, `registry/validate.ts:14`). Значения `builder` — artifact-типы (BIG-2/025): `ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`, `ycforge:api-gateway` (соответствуют `builders-core/src/catalog.ts:21-33` и composer `ARTIFACT_TYPE`).

Порядок сборки/материализации — топологический (`deterministicOrder`, `materialize/select.ts:26-63`): openapi только после всех трёх deps (US-5, SC-002).

## 3. `.ycsf/builders.yaml` — явный registry-маппинг (Constitution V, FR-008/009)

Ключи двух секций **не пересекаются** (`BRG_KEY_COLLISION` при совпадении, `registry/builders-yaml.ts:119-126`): builder-ключи — artifact-типы `ycforge:*`; materializer-ключи — семантические `yandex-*` (в selection не участвуют; selection идёт по `materializer.supports(descriptor)`, завязанному на `artifact.type`, — `materialize/select.ts:106-137`).

```yaml
version: 1
builders:
  ycforge:function: "@ycforge/builders-core/nestjs-function"
  ycforge:docker-image: "@ycforge/builders-core/docker"
  ycforge:frontend: "@ycforge/builders-core/vite"
  ycforge:api-gateway: "@ycforge/composer/builder"
materializers:
  yandex-function: "@ycforge/materializers-core/yandex-function"
  yandex-serverless-container: "@ycforge/materializers-core/yandex-serverless-container"
  yandex-storage-bucket: "@ycforge/materializers-core/yandex-storage-bucket"
  yandex-api-gateway: "@ycforge/materializers-core/yandex-api-gateway"
```

Все subpath-exports проверены в `package.json`: builded-подпаки `./nestjs-function`, `./docker`, `./vite`; materializer-подпаки `./yandex-function`, `./yandex-serverless-container`, `./yandex-storage-bucket`, `./yandex-api-gateway`; composer — `./builder` (spec 026). Реестр делает `await import(entry.packageName)` (`registry/load.ts:18`); резолюция субпатча — по экспортам пакетов (`BRG_PACKAGE_NOT_FOUND` при отсутствии).

## 4. `.ycsf/extensions.yaml` — provider-патчи через IDL (Constitution IV, spec 015)

IDL-адресуемы **только** `functions.*` и `gateways.*` (`extensions/idl.ts:10-13`: `IDL_DOMAIN_BY_TF_TYPE` = `yandex_function→functions`, `yandex_api_gateway→gateways`); containers/buckets НЕ адресуемы — попытка дать `containers.analytics` → `EXT_UNRESOLVED_TARGET` (fail-fast). Форма — список правил `{target, patch}`:

```yaml
version: 1
extensions:
  - target: functions.user_service
    patch:
      memory: 128
      execution_timeout: 5
  - target: gateways.openapi
    patch:
      connectivity_type: PRIVATE
```

Deep-merge: скаляры/массивы заменяются, объекты сливаются (`extensions/deep-merge.ts`); применение all-or-nothing после materialize (`extensions/apply.ts:90-100`). Это демонстрация «Terraform остаётся Terraform» (IV): provider-поля — не в C-логике, а в IDL-патчах.

## 5. `.ycsf/outputs.yaml` — user outputs (spec 016)

```yaml
version: 1
outputs:
  user_service_id:
    value: functions.user_service
    description: "Yandex Function id (user service)"
  gateway_id:
    value: gateways.openapi
    description: "API Gateway id (front entry)"
```

Правила (проверены по `outputs/build.ts`):
- Имена user outputs НЕ пересекаются с auto-outputs materializers (`<app>_function_id`, `<app>_container_id`, `<app>_bucket_id`, `<app>_gateway_id` — по одному из каждого `yandex-*/index.ts` через `context.output.declare`). Совпадение → `OUT_DUPLICATE_NAME` (fail-fast). Поэтому `user_service_function_id` как user-output НЕДОПУСТИМ (план amended, см. plan.md); используется `user_service_id`.
- `value` — IDL-ссылка на IDL-адресуемый ресурс (`functions.user_service`, `gateways.openapi`); резолв через `resolveIdlReference` (`outputs/resolver.ts`) → `${yandex_function.user_service.id}`; оборачивание `${...}` происходит в единой точке сборки (`outputs/build.ts:112`).
- Итоговый файл `99-ycsf-outputs.tf.json` = user + auto outputs, ключи сортируются лексикографически (`serializeJson`).

Ожидаемый содержимое `99-ycsf-outputs.tf.json` (полный набор, sorted keys):

```json
{
  "output": {
    "analytics_container_id":  { "value": "${yandex_serverless_container.analytics.id}" },
    "frontend_bucket_id":      { "value": "${yandex_storage_bucket.frontend.id}" },
    "gateway_id":              { "value": "${yandex_api_gateway.openapi.id}", "description": "API Gateway id (front entry)" },
    "openapi_gateway_id":      { "value": "${yandex_api_gateway.openapi.id}" },
    "user_service_function_id":{ "value": "${yandex_function.user_service.id}" },
    "user_service_id":         { "value": "${yandex_function.user_service.id}", "description": "Yandex Function id (user service)" }
  }
}
```

## 6. Per-app `build_config.yaml` + `build_env`

Форма `build_config` — opaque для C (`model/build-config.ts:16-18`), валидируется builder-ом; `build_env` — map ENV→string|null. `{{$ENV}}` в value → `checkEnvRequirements` (`PML_ENV_NOT_SET`) fail-fast; в эталоне build_env не содержит ENV-литералов (FR-005, A-2).

### 6.1 `user_service/build_config.yaml` (nestjs-function, `builders-core/src/nestjs-function/config.ts`)

```yaml
build_config:
  entry: src/main.ts          # default
  runtime: nodejs22           # nodejs20 | nodejs22 (materializer фиксирует nodejs22)
  external: []                # default
  out_filename: function.zip  # default
build_env: {}                 # публично; {{$ENV}} absent
```

### 6.2 `analytics/build_config.yaml` (docker, spec 027; `builders-core/src/docker/config.ts`)

```yaml
build_config:
  image:
    repository: cr.yandex/ycforge/analytics  # локальный ref; tag default latest
    no_push: true                            # spec 027 — без registry
  dockerfile: Dockerfile                     # default
build_env: {}
```

`no_push: true` → локальный `docker build` + digest из `docker image inspect --format '{{.Id}}'` (`docker/cli.ts:76-88`), push не выполняется (FR-024, D-6). Артефакт: `{ type: 'ycforge:docker-image', value: { image: '<repository>@sha256:<digest>' } }`.

### 6.3 `frontend/build_config.yaml` (vite; `builders-core/src/vite/config.ts`)

```yaml
build_config:
  out_dir: dist         # default
  root: .               # default
  command: vite build   # default
build_env:
  VITE_ENV: public-only-banner    # ТОЛЬКО public literals (D-7, FR-005); VITE_API_BASE: /api — пример
```

suspicious-ключи (`SECRET|TOKEN|PASSWORD`) в build_env запрещены: `ycsf check` категория suspicious-keys (BIG-6/025) + собственный secret-scan (FR-023, LE:67).

### 6.4 `openapi/build_config.yaml` (composer → Project B safe mode, FR-006)

```yaml
build_config:
  openapi_entry: openapi.yaml
build_env: {}
```

+ `apps/openapi/openapi.yaml` — единственная точка входа API Gateway, routes на user_service/analytics **по Lock-топологии imperative refs на apps** (см. §7); safe mode: composer всегда ставит `SERVERLESS_TOOLS_OPENAPI_BUILD=1` (`compile-core.ts:28-46`).

## 7. Logical references: topология gateway → apps (FR-007/FR-010 amendment, D-4)

- `<name>` в `${resources.<type>.<name>.id}` — это `app_id` из `apps.yaml` (user_service, analytics).
- `.ycsf/resources.yaml` отсутствует в эталоне (FR-007); `PML_IDENTITY_COLLISION` не срабатывает.
- Маппинг `${resources.functions.user_service.id}` → `${yandex_function.user_service.id}` выполняет materializer `yandex-api-gateway` по зафиксированному D-4-столу (composer `builder/artifact.ts:28-35`):

| Domain | Terraform type |
|--------|----------------|
| `functions` | `yandex_function` |
| `queues` | `yandex_message_queue` |
| `buckets` | `yandex_storage_bucket` |
| `containers` | `yandex_serverless_container` |
| `gateways` | `yandex_api_gateway` |

- Проект B собирает `resourceReferences` из финального артефакта без обращения к resources.yaml (`composer/builder/artifact.ts:45`, `builder/index.ts:102`).
- **Документированная граница web-behavior**: ENV/PATH-композиция refs в `openapi.yaml` использует только Boolean-носителей refs (в т.ч. `x-yc-apigateway-integration.{function_id,container_id}` и authorizer `function_id`); БЭД-кейсы (несуществующий app в ref, provider-specific выражения в C-артефакте) — fail-fast/документированы в research.md (T002) и замыкаются тестом.

## 8. `infra/main.tf` — user-owned

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.145.0"
    }
  }
}

provider "yandex" {}
```

C его не читает/пишет; `terraform init` пишет `infra/.terraform.lock.hcl` (коммитится, FR-014/FR-018); state/.terraform — никогда (AGENTS.md).

---

## 9. Golden-контракт: ожидаемые `infra/*.tf.json` (D-4, FR-017, FR-020)

Детерминизм: `serializeJson` сортирует ключи лексикографически на каждом уровне (`materialize/serialize.ts:17-28`); `user_hash` = детерминированный sha256 архива; `sanitizeFilename` стабилен; docker-digest `{{.Id}}` детерминирован. Формы ниже — структурный контракт (значения `<…>` заполняются в golden-фикстурах после `ycsf materialize`, T020/T021).

### 9.1 `infra/user_service.ycsf.tf.json` — `yandex_function.user_service`

```json
{
  "resource": {
    "yandex_function": {
      "user_service": {
        "runtime": "nodejs22",
        "entrypoint": "<entryPoint>",
        "user_hash": "<sha256-of-archive>",
        "content": { "zip_filename": "<archivePath>" }
      }
    }
  }
}
```

(материализует `yandex-function/index.ts`; auto-output `user_service_function_id`)

### 9.2 `infra/analytics.ycsf.tf.json` — `yandex_serverless_container.analytics`

```json
{
  "resource": {
    "yandex_serverless_container": {
      "analytics": { "image": "<repository>@sha256:<digest>", "name": "analytics" }
    }
  }
}
```

### 9.3 `infra/frontend.ycsf.tf.json` — `yandex_storage_bucket.frontend` + `yandex_storage_object.*` per-file

```json
{
  "resource": {
    "yandex_storage_bucket": {
      "frontend": { "bucket": "frontend", "acl": "public-read" }
    },
    "yandex_storage_object": {
      "frontend_<sanitized-file>": {
        "bucket": "yandex_storage_bucket.frontend.id",
        "key": "<relative-path>",
        "source": "<abs-path-in-artifacts>"
      }
    }
  }
}
```

### 9.4 `infra/openapi.ycsf.tf.json` — `yandex_api_gateway.openapi` + companion

```json
{
  "resource": {
    "yandex_api_gateway": {
      "openapi": {
        "spec": "file(\"${path.module}/generated/openapi-openapi.yaml\")"
      }
    }
  }
}
```

Companion: `infra/generated/openapi-openapi.yaml` (пишет materializer при cwd=`infra/` — BIG-1c: companion path resolves к `cwd/generated/`, поэтому стадия materialize исполняется с cwd=`infra/`).

### 9.5 `infra/99-ycsf-outputs.tf.json`

Полный набор — см. §5 (user + auto outputs, sorted keys).

### 9.6 Сводка (hard-ассерт SC-002/FR-017)

| App | Address в плане | Materializer | Auto-output |
|-----|-----------------|--------------|-------------|
| user_service | `yandex_function.user_service` | yandex-function | `user_service_function_id` |
| analytics | `yandex_serverless_container.analytics` | yandex-serverless-container | `analytics_container_id` |
| frontend | `yandex_storage_bucket.frontend` (и `yandex_storage_object.frontend_*`) | yandex-storage-bucket | `frontend_bucket_id` |
| openapi | `yandex_api_gateway.openapi` | yandex-api-gateway | `openapi_gateway_id` |

Ровно 4 managed-приложения, ноль external-сущностей из resources.yaml (Constitution VI; FR-007).

---

## 10. Границы, зафиксированные в формах (не «тихие»)

- **docker**: no-push режим; без daemon холодная сборка analytics → `BLC_BUILD_FAILED`/connect-to-daemon (fail-fast стадии `build`, FR-013); hermetic fake-docker даёт детерминированный `{{.Id}}` (research T006, tasks T006).
- **terraform-граница без кред**: init (единственная сеть — registry.terraform.io) → validate (offline, 0-диагностик) → plan без кред стоп на provider-конфиге `one of 'token' or 'service_account_key_file' should be specified` (FR-019; wording — quickstart §4 и contracts).
- **IDL-адресуемость**: extensions/outputs адресуют только `functions.*`/`gateways.*`; containers/buckets — не адресуемы (documented limitation, §4/§5).
- **User output names** не пересекаются с auto (OUT_DUPLICATE_NAME fail-fast).