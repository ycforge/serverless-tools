# @ycforge/cloud-e2e — облачной e2e тест тулчейна (spec 037)

Отдельный тест-проект (`e2e/project`) реально разворачивается в Yandex Cloud,
обслуживает живые HTTP/MQ/S3/KMS-запросы и затем удаляется. Это **не** reference-проект
(`examples/reference-project`): reference — для пользователей и остаётся неизменным.

## Что покрывается

- `build_env`: литерал, `{{$ENV}}`, `null` из `process.env`.
- `resources.yaml` (external bucket) + ENV-only `.ycsf/env.yaml`.
- `overrides.yaml`: global (`openapi/overrides.yaml`) + local (`apps/e2e_openapi/overrides.yaml`).
- `auth.yaml`: `none`, `jwt` (реальный JWT против тестового OIDC/JWKS в S3), `function` (только отказ — см. ограничения).
- `extensions.yaml`: memory/timeout/environment/service_account_id.
- `outputs.yaml` + auto-outputs, идемпотентность `terraform plan`, инкрементальный кэш.
- `moved.yaml`: переименование приложения без пересоздания ресурса (2 фазы).
- docker builder: сборка `linux/amd64` + push в `cr.yandex`, деплой ревизии контейнера.
- nest-bridge: HTTP v1 transport через API Gateway, `@RequireAuth`, MQ transport (real trigger), `trace_id` в error-ответе, `YandexLogger`.

## Требования

- Node ≥ 22, pnpm 11, Terraform ≥ 1.5, Docker daemon, `yc` CLI, `aws` CLI/SDK-креды.
- Собранные пакеты монорепы: `pnpm build` в корне репозитория.
- Права SA в целевом каталоге: создание functions/containers/buckets/gateways/queues/triggers,
  `kms.editor`, `ymq.reader`/`ymq.writer`, `storage.viewer`/`storage.admin`,
  `functions.functionInvoker`, `container-registry` push.
- `yc` CLI: используется **только профиль `ycforge-sa`**.

## Установка и запуск

```bash
# из корня репозитория
pnpm build
pnpm --filter @ycforge/cloud-e2e install   # отдельная e2e-store

export YCSF_E2E=1
export YC_FOLDER_ID=<folder-id>
export YC_CLOUD_ID=<cloud-id>
export YC_SERVICE_ACCOUNT_ID=<sa-id>
export YC_SERVICE_ACCOUNT_KEY_FILE=/abs/path/to/sa-key.json   # или YC_TOKEN
export AWS_ACCESS_KEY_ID=<static-key>        # YMQ/S3 (SQS API)
export AWS_SECRET_ACCESS_KEY=<static-secret>

pnpm --filter @ycforge/cloud-e2e e2e
```

Без `YCSF_E2E=1` все тесты пропускаются (CI ничего не запускает). При `YCSF_E2E=1`
отсутствие любой переменной — fail-fast.

- `e2e/scripts/vendor-connector.mjs` (запускается в `pnpm e2e`) кладёт реальный (не symlink)
  `@ycforge/nestjs-connector` в `e2e/node_modules`, чтобы в бандл функции попала одна копия Nest.
- `E2E_KEEP=1` — не удалять облачные ресурсы и временный каталог (для отладки).
- `E2E_KMS_KEY_ID=<id>` — использовать существующий ключ KMS вместо создаваемого в setup.
- `E2E_RUN_ID=<hex>` — зафиксировать суффикс имён (иначе случайный).

## Внутреннее устройство

- `setup/` — «инфраструктура пользователя»: внешние bucket/queue/OIDC-бакет+JWKS/KMS, применяется до пайплайна.
- `project/` — то, что гоняет `ycsf`: `.ycsf/*`, `apps/*`, `infra/*.tf`.
- `test/` — harness (vitest, один spec): deploy → живые проверки → teardown.
- Временный каталог прогона: `e2e/.tmp/run-<runId>/` (gitignored).

## Известные ограничения (см. `specs/037-cloud-e2e/spec.md` §8)

- Function-authorizer allow-path недоступен: composer не эмитит `service_account_id` авторизатора.
- App-level DLQ (`DlqSender`) использует `Bearer`-авторизацию; реальный YMQ требует AWS SigV4.
- Чтение логов функций (`yc serverless function logs`) недоступно с текущими ролями —
  MQ/observability проверяются permission-free (глубина очереди, прямой invoke, `trace_id`).
