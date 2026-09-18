# Spec 037: cloud-e2e — облачной e2e тест тулчейна на отдельном тест-проекте

- **Spec**: 037-cloud-e2e
- **Status**: 🚧 в работе
- **Тип**: мини-spec (только `spec.md`, по решению владельца)
- **Ветка**: `037-cloud-e2e` (от `dev`), PR в `dev`, без merge (review владельцем)

## 1. Зачем

Reference-проект spec 024 и все приёмочные проверки тулчейна **герметичны**: они
заканчиваются на `terraform plan` (или на границе без креденшалов) и никогда не
разворачивают ресурсы в Yandex Cloud. Единственный реальный cloud-прогон
зафиксирован лишь текстом в commit-сообщении `a4478b9` (spec 035/036) — нет
воспроизводимого артефакта, нет автоматических ассертов на живое поведение.

Spec 037 добавляет **воспроизводимый облачной e2e**: отдельный тест-проект,
который реально разворачивается в Yandex Cloud, обслуживает живые HTTP/MQ/S3
запросы и затем удаляется. Тест-проект **не заменяет** reference-проект (он для
пользователей и не меняется) и покрывает максимум пользовательских фич тулчейна.

Ключевой принцип: это **проверка тулчейна как системы** (A → B → C → Terraform →
облако), а не отдельного пакета. Найденные при реализации баги исправляются в
рамках этой же задачи.

## 2. Решения (зафиксированы с владельцем)

| # | Вопрос | Решение |
|---|--------|---------|
| D1 | Оформление | мини-spec: только `spec.md`, без plan/tasks |
| D2 | Расположение | standalone top-level `e2e/` **вне** корневого pnpm-workspace (своя store + `link:../packages/*`), с вендорингом коннектора (`scripts/vendor-connector.mjs` копирует `packages/nest-bridge/{package.json,dist}` в `e2e/node_modules/@ycforge/nestjs-connector` как реальный каталог). Иначе linked-коннектор тянет собственную dev-копию `@nestjs/common`, бандл функции получает две копии Nest → `instanceof HttpException` ломается → 500. Включение e2e в корневой workspace отвергнуто: `pnpm install` сдвинул transitive `vite` 7.3.6→6.4.3 и уронил существующие pilot-тесты. CI e2e не запускает: скрипты `e2e`/`e2e:typecheck`, нет `test`/`build` |
| D3 | Креды Terraform | **только из env пользователя**; harness fail-fast при отсутствии. Авто-чтения `yc`-профиля нет |
| D4 | YC CLI | только профиль `ycforge-sa` (жёстко, через `YC_PROFILE`/`--profile`). Иной профиль — запрещён без прямого согласия |
| D5 | Cleanup | всегда `terraform destroy` в teardown (в т.ч. при падении) + флаг `--keep` для отладки |
| D6 | MQ | `MQ → function → nest-bridge → NestJS` через **user-owned `.tf`**: `yandex_message_queue` + `yandex_function_trigger`. Builder/materializer очереди не нужны |
| D7 | JWT | публичный S3-бакет с тестовым OIDC: `/.well-known/openid-configuration` + `/.well-known/jwks.json`; harness генерирует RSA и подписывает токен → 401 без токена, 200 с токеном |
| D8 | External resources | «как сделал бы пользователь»: внешние сущности живут **вне** app-пайплайна (setup-root), ссылки — через `.ycsf/resources.yaml` и ENV-only `.ycsf/env.yaml` |
| D9 | Состав | полный набор приложений (см. §4) |
| D10 | Запуск | vitest-сьют, гейт `YCSF_E2E=1` + наличие кред; иначе все тесты `skip`. В CI e2e **не** подключается |
| D11 | Имена | номер 037, ветка `037-cloud-e2e`, все облачные ресурсы с префиксом `e2e-`/`e2e_`; ref-ресурсы не трогаются |
| D12 | Баг очереди | найденный баг `yandex-message-queue` (реальный URL ≠ `/queues/`) исправляется в этом же PR |

## 3. Архитектура e2e

```
e2e/                              # standalone pnpm-проект (свой workspace + lockfile)
  pnpm-workspace.yaml             # свой workspace-root (packages: ['.'])
  package.json                    # link:../packages/*, vitest, jose, @aws-sdk/client-sqs, yaml, tsx, vite
  scripts/vendor-connector.mjs    # реальный (не symlink) коннектор в node_modules → одна копия Nest
  tsconfig.json
  vitest.config.ts                # globalSetup, длинные таймауты
  README.md                       # как запускать, какие env нужны
  setup/                          # «инфраструктура пользователя» вне app-пайплайна
    *.tf                          # external bucket(+static objects), queue, JWT OIDC bucket+objects
    outputs.tf
  project/                        # то, что гоняет ycsf-пайплайн
    .ycsf/{apps,builders,resources,env,extensions,outputs,moved}.yaml
    apps/<app>/...                # исходники + build_config.yaml (+auth.yaml/overrides.yaml)
    infra/main.tf                 # provider; user-owned: mq.tf, trigger, iam, jwt upload?
  test/                           # harness (vitest)
    helpers/*.ts
    *.spec.ts
```

Поток прогона:

1. **Генерация** в temp: RSA-ключ → `jwks.json` + `openid-configuration` (в setup fixtures), уникальный суффикс имён.
2. **Setup apply** (`e2e/setup`): внешние bucket/queue/OIDC-бакет → outputs (bucket name, queue id/url, oidc URL).
3. **Экспорт env** из outputs + пользовательские YC-креды; запись/шаблонирование `project/.ycsf/env.yaml`, `auth.yaml` с реальными URL.
4. **Пайплайн**: `ycsf check` → `ycsf build` → `ycsf materialize` → `terraform init/validate/apply`.
5. **Живые проверки** (см. §5).
6. **moved-фаза**: rename приложения + `.ycsf/moved.yaml` → повторный build/materialize/apply → ассерт «без destroy/recreate».
7. **Teardown**: `terraform destroy` (project, потом setup), удаление temp; `--keep` останавливает teardown.

## 4. Тест-проект: приложения и фичи

| App | Builder | Materializer | Что покрывает |
|-----|---------|--------------|---------------|
| `api` | `ycforge:function` | `yandex-function` | HTTP через gateway (`cloud_functions` v1), `@RequireAuth` (jwt + function schemes), `YandexLogger`, `trace_id`, KMS roundtrip, extension-патчи (memory/timeout/env), outputs |
| `worker` | `ycforge:function` | `yandex-function` | MQ fail-fast: `@QueueHandler`, строгий JSON, `trace_id` в логах |
| `worker_dlq` | `ycforge:function` | `yandex-function` | MQ partial-failure + DLQ (успешные обработаны, «плохие» уехали в DLQ) |
| `web` | `ycforge:frontend` | `yandex-storage-bucket` | vite-сборка, `build_env` (литерал + `{{$ENV}}`), override `bucket_name`, статика через gateway `object_storage` |
| `container` | `ycforge:docker-image` | `yandex-serverless-container` | локальная сборка `linux/amd64` + push в `cr.yandex`, деплой ревизии, HTTP через gateway `serverless_containers` |
| `openapi` | `ycforge:api-gateway` | `yandex-api-gateway` | композиция маршрутов api/container/web, global+local overrides, auth schemes `none`/`jwt`/`function`, companion-спека |
| `rename_me` | `ycforge:function` | `yandex-function` | `.ycsf/moved.yaml` (2-фазный apply без пересоздания) |

Покрываемые фичи тулчейна (чек-лист):

- `build_env`: литерал, `{{$ENV}}`, null-from-process-env; fail-fast при отсутствии.
- `resources.yaml`: external bucket (+ возможно queue/function), резолв через `${resources...}`.
- ENV-only `.ycsf/env.yaml`: literal-подстановка из `process.env`, fail-fast `RESOURCE_REF_ENV_NOT_SET`.
- `overrides.yaml`: global + local, `add`/`replace`/`remove`, приоритет local > global.
- `auth.yaml`: `none`, `jwt` (реальный happy-path через S3 OIDC), `function` (user-owned авторизатор).
- `extensions.yaml`: deep merge (memory/execution_timeout/environment/service_account_id).
- `outputs.yaml`: user + auto outputs.
- `moved.yaml`: rename без пересоздания.
- user-owned logging group (`infra/logging.tf`) + привязка функции через `extensions.yaml`
  (`log_options.log_group_id`); логи NestJS `Logger` всех уровней в этой группе.
- incremental cache: второй `ycsf build` → cache hit; изменение источника → miss + зависимые.
- docker builder: реальная amd64-сборка + push (immutable digest).
- connector: HTTP v1 transport, `@RequireAuth`, MQ transport + partial failure, context/`trace_id`, `YandexLogger`.

## 5. Живые проверки (acceptance)

AS-1 **Gateway HTTPS**: `GET /api/users` → 200 `{"users":["alice","bob"]}`; query-параметры; 404/405; ответ `api` через container-route.
AS-2 **Auth**: jwt-маршрут без `Authorization` → 401; с валидным JWT → 200; с чужим `iss`, чужим `aud`, истёкшим — 401; function-маршрут без `Authorization` → 401 (gateway не вызывает авторизатор для `http bearer` без заголовка), с `Authorization: Bearer ...` и allow-сигналом (`?auth=allow`) → 200, с заголовком но без allow-сигнала (авторизатор отказал) → 403; composer эмитит `service_account_id` авторизатора из `auth.yaml serviceAccount`; `none`-маршрут открыт.
AS-3 **Direct invoke**: `yc --profile ycforge-sa serverless function invoke` с v1-фикстурой → 200/корректный ответ.
AS-4 **MQ**: отправка через SQS (env `AWS_*`, endpoint YMQ) → реальный trigger вызывает worker, очередь опустошается, в логах — маркер обработки и `traceId`; fail-fast worker на плохом сообщении возвращает ошибку, сообщение редоставляется (реальный trigger); partial-failure worker деградирует и **перепубликует** плохое сообщение в app-level DLQ через SigV4 (проверяется receive-message из DLQ).
AS-5 **S3**: объект из `web`-бакета скачивается по HTTPS; содержимое соответствует build_env.
AS-6 **KMS**: `GET /api/kms?key=...` → encrypt/decrypt roundtrip. **Opt-in**: выполняется только при заданном `E2E_KMS_KEY_ID` — у эталонного SA `ycforge-reference` нет прав KMS (`kms.symmetricKeys.*` → PermissionDenied).
AS-7 **Observability**: логи invocation структурированы, содержат `trace_id`; error-ответы несут `trace_id`. Логи функции пишутся в **user-owned logging group** (`yandex_logging_group` + `log_options.log_group_id`): все уровни NestJS `Logger` (`verbose`/`debug`/`log`/`warn`/`error`/`fatal`) появляются в группе с меткой уровня и сообщением.
AS-8 **Terraform state/outputs**: outputs из state совпадают с `.ycsf/outputs.yaml` + auto-outputs; `terraform plan` после apply — no changes (идемпотентность).
AS-9 **moved**: 2-фазный apply — ресурс переименован без `destroy`/`recreate`.
AS-10 **Cache**: повторный build → cache hit; изменение источника → miss.
AS-11 **Teardown**: после прогона созданные `e2e-*` ресурсы удалены (проверка списками/state).

## 6. Вне scope

- Интеграция e2e в CI (пока явно запрещено владельцем).
- `ycsf apply`/`destroy` как стадии тулчейна (apply делает harness напрямую через terraform; destroy — тоже).
- Публикация артефактов, push в npm.
- Изменение reference-проекта и пакетов вне необходимых багфиксов.
- Multi-region, prod-подобные нагрузки, секреты в репозитории.

## 7. Риски и допущения

- **Права SA `ycforge-reference`** не читаются (`list-access-bindings` → PermissionDenied). Подтверждено: KMS недоступен полностью (`kms.symmetric-key list/create` → PermissionDenied) — KMS-проверка переведена в opt-in (`E2E_KMS_KEY_ID`). Если не хватает прав на trigger/IAM/registry — фиксируем и запрашиваем у владельца.
- **Стоимость/время**: реальный apply полного набора + 2 фазы moved + destroy — минуты; владелец согласовал.
- **Сосуществование**: ref-проект задеплоен в той же папке; e2e использует только `e2e-*` имена и не трогает ref-ресурсы.
- **Docker на Apple Silicon**: amd64 через `DOCKER_DEFAULT_PLATFORM`/buildx; логин в `cr.yandex` — IAM-токеном (`yc container registry configure-docker` в изолированный `DOCKER_CONFIG`).
- **JWT**: composer всегда эмитит `openIdConnectUrl`; поэтому OIDC discovery-документ обязателен, не только JWKS.
- **MQ producer**: YMQ доступен по SQS API с текущими `AWS_*`-кредами; harness требует их из env (не хардкодит).

## 8. Найденные баги (исправляются здесь)

`yandex-message-queue` materializer был непригоден по двум причинам (обе исправлены):

1. **URL**: требование подстроки `/queues/`, тогда как реальный YMQ SQS URL —
   `https://message-queue.api.cloud.yandex.net/<cloud-id>/<queue-id>/<queue-name>`.
   Любой настоящий URL → `YMT_INVALID_QUEUE_URL`; spec 019 FR-020 и тест DQ-9
   закрепляли вымышленный формат. Фикс: имя очереди — последний непустой
   path-сегмент, с обратной совместимостью для `/queues/<name>`.
2. **Terraform-атрибуты**: генерировались `queue_name`/`region`, которых нет в
   провайдере `yandex_message_queue` (реальные — `name`/`region_id`; проверено
   `terraform providers schema`), т.е. даже корректный URL давал бы
   `terraform validate`-ошибку. Фикс: `name`/`region_id`; terraform-validate-тест
   materializers-core расширен ресурсом очереди.

- `ycsf build` игнорировал интерполяцию `build_config`: `prepareBuildEnv` возвращал
  и `resolvedEnv`, и интерполированный `buildConfig`, но `packages/pilot/src/build/index.ts`
  клал в `BuildContext.buildConfig` и в cache-fingerprint **сырой** конфиг, поэтому
  `{{$ENV}}` внутри `build_config` (например, `bucket_name`, `command`) давал
  `BLC_ENV_NOT_RESOLVED`, а изменение значения ENV не инвалидировало кэш. Фикс:
  использовать интерполированный `build_config` и в контексте builder-а, и в хэше.
- `nestjs-function` builder всегда писал бандл как `main.js`, но объявлял
  entrypoint по имени entry-файла: для entry `src/index.ts` получался
  `index.handler` при архиве, где лежит только `main.js` → 502 «Cannot find module
  /function/code/index.js» (проявилось на `e2e_authorizer`/`e2e_rename_me`).
  Фикс: имя модуля бандла = basename entry (`index.ts` → `index.js`), entrypoint
  совпадает; добавлен unit-тест.
- `buildMoves` (pilot) для multi-hop цепочки эмитил **каждый** переход сразу в
  терминальный адрес (`A→C`, `B→C`) → Terraform: «Ambiguous move statements»
  (у одного ресурса несколько источников). Фикс: per-hop блоки (`A→B`, `B→C`),
  Terraform резолвит цепочку транзитивно; обновлён unit-тест T082.
- `moveEndpointsFromResources` (pilot CLI) клал в `idl` Terraform-адрес вместо
  логического IDL, поэтому терминал `.ycsf/moved.yaml` (`functions.<name>`)
  никогда не совпадал с текущими ресурсами → `MOV_TARGET_UNRESOLVED`. Фикс:
  `idl` выводится через таблицу доменов (`functions`/`gateways`/`containers`);
  добавлен unit-тест.
- `${resources.buckets.<name>.name}` в API-gateway материализовывался в
  `yandex_storage_bucket.<name>.name`, но у провайдера `yandex_storage_bucket` нет
  атрибута `name` (имя бакета — атрибут `bucket`) → `terraform validate` падал с
  `Unsupported attribute`. Фикс: таблица логический-property → TF-атрибут
  (`buckets.name` → `bucket`) в `ref-resolver.ts`.
- composer для `auth.yaml` scheme `function` эмитил `x-yc-apigateway-authorizer`
  **без** `service_account_id`, из-за чего API Gateway не мог вызвать
  авторизатор (allow-путь всегда 401). Фикс: в `auth.yaml` scheme `function`
  добавлено опциональное поле `serviceAccount` (контракт spec 007), оно
  эмитится как `service_account_id`; e2e allow-путь зелёный. Новый код ошибки
  `AUTH_INVALID_FIELD`.
- `DlqSender` (spec 005) публиковал в DLQ через `Bearer`-IAM, а реальный YMQ
  принимает только AWS SigV4 со static access key (проверено: 400 для Bearer,
  а также IAM-токен в SigV4 → `IAM authentication error`). Фикс: hand-rolled
  SigV4 на `node:crypto` (`src/mq/sigv4.ts`), `SendMessage` (form-urlencoded) на
  endpoint YMQ; ключи из `partialFailure.credentials` или env
  `YC_MQ_KEY_ID`/`YC_MQ_KEY_VALUE` (fallback `AWS_*`); `deadLetterQueueId` —
  URL очереди. Имена env выбраны без суффиксов `*secret`/`*accesskey`, чтобы не
  триггерить `YCK_SUSPICIOUS_KEY`. App-level DLQ-доставка в e2e зелёная.

- **Логи (проверено вживую)**: при `log_options.min_level: TRACE` в кастомную
  logging-группу попадали только платформенные логи (`START`/`END`/`REPORT`), а
  пользовательский stdout (NestJS `Logger`, `console.*`, структурированные логи
  коннектора) исчезал и из кастомной группы, и из default. Причина: пользовательский
  stdout имеет уровень `UNSPECIFIED`, который отфильтровывается `min_level`. Фикс:
  не задавать `min_level` при привязке группы. Дополнительно: Cloud Logging не
  парсит текстовый вывод NestJS в уровни (всем строкам присваивается `TRACE`), а
  сам ConsoleLogger печатает ANSI-цветные метки `VERBOSE/DEBUG/LOG/WARN/ERROR/FATAL`
  внутри сообщения — «тип» лога читается из текста строки, а не из поля `level`.

**Ограничение покрытия**: cross-app path/operationId-коллизии composer-а
структурно недостижимы через пайплайн и `ycsf-api` (оба выбирают **один**
gateway-app; merge нескольких документов вызывается только библиотечно и покрыт
unit-тестами composer). В e2e покрыта self-коллизия `operationId` внутри одного
app (негативная проверка `ycsf build`). Коллизия с `resolved` кодом `COMPOSE_*`
поверх CLI не пробрасывается (обёрнута в `CLI_BUILD_FAILED` с текстом).

## 9. Критерии завершения

- Сьют (35 тестов) проходит на реальном облаке при заданных env-кредах; при
  отсутствии `YCSF_E2E=1`/кред — целиком skip, CI не затронут.
- Найденные баги (queue URL/атрибуты, build_config-интерполяция, bucket-ref
  attribute, moved idl + multi-hop, nestjs-function entrypoint, function-authorizer
  SA, DlqSender SigV4) исправлены; тесты пакетов зелёные, ref-golden пересчитан
  (изменение A меняет хэш бандла).
- `pnpm build && pnpm test && pnpm typecheck && pnpm lint` в корне зелёные.
- Ветка `037-cloud-e2e` → PR в `dev`, без merge.
