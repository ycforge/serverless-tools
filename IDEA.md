 # YCSF — архитектура экосистемы для production NestJS / Serverless в Yandex Cloud

## 1. Цель проекта

YCSF — экосистема инструментов для запуска обычных приложений, прежде всего NestJS, в Yandex Cloud Serverless-инфраструктуре без превращения NestJS в отдельный framework.

Основная идея — разделить ответственность между тремя проектами:

* **Project A — `@ycforge/ycsf-nestjs-connector`**: runtime/transport adapter между Yandex Cloud Function и обычным NestJS-приложением.
* **Project B — API Gateway / OpenAPI Composition Builder**: собирает API Gateway specification из нескольких приложений, их OpenAPI metadata, auth-конфигурации, overrides и integration/resource references.
* **Project C — Build/Deployment Orchestrator**: управляет сборкой проекта, вызывает builders, собирает artifacts, вызывает materializers и генерирует Terraform-конфигурацию; deployment engine — только Terraform.

Главный архитектурный принцип:

> **A отвечает за runtime, B — за API composition, C — за orchestration/build, Terraform — за provisioning/deployment.**

Не нужно превращать C в "god tool", A — в Yandex framework, а B — в Terraform builder общего назначения.

---

# 2. Project A — `@ycforge/ycsf-nestjs-connector`

## Назначение

A — тонкий runtime adapter, позволяющий обычному NestJS-приложению работать внутри Yandex Cloud Functions.

Типовой HTTP flow:

```text
Client
  ↓
Yandex API Gateway
  ↓
Yandex Cloud Function
  ↓
YCSF Connector (A)
  ↓
NestJS application
```

MQ flow:

```text
Yandex Message Queue
  ↓
Cloud Function trigger
  ↓
YCSF Connector
  ↓
NestJS queue handler
```

## Что умеет A

A должен:

* запускать/reuse NestJS application в Cloud Function;
* адаптировать HTTP invocation из API Gateway payload 2.0 к NestJS;
* адаптировать Message Queue invocation;
* поддерживать queue handlers;
* поддерживать `@QueueHandler()` и `@QueueMessage()`;
* нормализовывать single/batch queue messages;
* предоставлять unified execution context с runtime metadata/raw event, условно через `@YandexContext()`;
* сохранять стандартный NestJS lifecycle:

  * guards;
  * pipes;
  * interceptors;
  * exception filters;
  * decorators;
  * middleware;
  * DI;
  * и т.д.;
* переиспользовать NestJS application между warm invocations;
* предоставлять unified logger (в вывод `stdout`) и `trace_id` приложению в контексте;
* маппить ошибки/исключения NestJS (exception filters) в корректный HTTP-ответ в формате API Gateway payload 2.0 (включая статус, тело, `trace_id`);
* определять семантику ошибок batch MQ processing: по умолчанию any-failure = retry всего batch (at-least-once; идемпотентность — ответственность приложения); опционально — per-message partial-failure response, если это поддерживается trigger-ом;
* применять guard из `@RequireAuth` через global guard с делегированием (см. раздел 11).

## Что A принципиально не делает

A не отвечает за:

* deployment;
* Terraform;
* API Gateway configuration;
* OpenAPI compilation;
* provisioning Yandex Cloud resources;
* JWT/JWKS management;
* key generation/rotation;
* Lockbox/Object Storage setup;
* frontend;
* migrations;
* CI/CD.

HTTP → MQ также не является функцией A. Это задача API Gateway integration.

Serverless Containers не требуют изменения A: для них существует отдельный Docker/container build + Terraform deployment path.

## Authentication

Основная авторизация приложения остаётся в обычном NestJS Guard.

Gateway может выполнять дешёвую предварительную authentication-проверку, чтобы не запускать Nest runtime для заведомо неавторизованных запросов и тем самым не тратить invocation resources.

Но полноценная application-level authorization, особенно динамическая:

```text
org:read:12345
org:write:98765
```

остаётся внутри NestJS/application layer.

---

# 3. Project B — API Gateway / OpenAPI Composition Builder

## Назначение

B — standalone library + CLI + builder plugin.

Условные команды:

```bash
ycsf-api compile
ycsf-api check
```

Разграничение ответственности CLI:

* `ycsf-api check` валидирует только API-composition contracts (auth schemes, конфликты path/operationId, наличие OpenAPI sources) и может работать без C/Terraform;
* `ycsf check` (см. раздел 28) валидирует project-level contracts (build env, resource refs, extensions targets) и при наличии openapi-приложения делегирует composition-проверки B.

B можно использовать:

1. самостоятельно, без C;
2. как builder внутри C.

B не знает Terraform и не знает внутреннюю архитектуру C.

Главная задача B:

> построить единую Yandex API Gateway OpenAPI specification из нескольких NestJS applications и YCSF configuration.

---

# 4. Организация проекта

Базовая структура проекта:

```text
repo/
├── .ycsf/
│   ├── apps.yaml
│   ├── resources.yaml
│   ├── extensions.yaml         # user patches к generated resources
│   ├── outputs.yaml            # user-defined outputs с IDL-refs
│   ├── env.yaml                # optional, ENV-only mode
│   ├── builders.yaml           # optional, explicit builder/materializer mapping
│   └── moved.yaml              # optional
│
├── user_service/
│   ├── src/
│   └── build_config.yaml
│
├── orders/
│   ├── src/
│   └── build_config.yaml
│
├── frontend/
│   ├── src/
│   └── build_config.yaml
│
├── openapi/
│   ├── build_config.yaml
│   ├── auth.yaml
│   └── overrides.yaml
│
└── infra/
    ├── *.tf                  # user-owned
    └── generated *.tf.json   # C-owned
```

`deploy.yaml` отсутствует и не используется.

Также не существует специального:

```text
builders/api-gateway/.ycsf-builder.yaml
```

Builder-specific configuration хранится рядом с application/source unit.

Builders — внешние npm-пакеты/plugins.

---

# 5. `.ycsf/apps.yaml`

`apps.yaml` должен быть максимально простым.

Пример:

```yaml
apps:
  user_service:
    source_path: user_service
    builder: nestjs-function

  analytics:
    source_path: analytics
    builder: docker

  frontend:
    source_path: frontend
    builder: vite

  openapi:
    source_path: openapi
    builder: yandex-api-gateway
```

Здесь находятся только:

* logical application ID;
* source path;
* builder identifier.

Builder-specific configuration сюда не попадает.

Application ID одновременно является стабильным logical identity application.

### Зависимости между приложениями

Для контроля порядка сборки:

```yaml
apps:
  orders:
    source_path: orders
    builder: nestjs-function
    depends_on:
      - user_service
```

C учитывает `depends_on` при планировании build graph.

`depends_on` задаёт только build order. Полный build/materialize graph C строит также из resource references артефактов: например, openapi-app неявно зависит от всех `functions.*`, на которые ссылается его spec.

Циклы в `depends_on` — error на загрузке project model. Самоссылки и ссылки на несуществующий app — тоже error.

---

# 6. App-level `build_config.yaml`

Каждый app имеет собственный:

```text
<app>/build_config.yaml
```

C автоматически загружает его.

Пример Docker app:

```yaml
build_config:
  image:
    repository: "cr.yandex/ya_mob_ya_lublu_yandex"
    tag: "{{$ANALYTICS_IMAGE_TAG}}"
  dockerfile: "{{$ANALYTICS_DOCKERFILE}}"

build_env:
  NPM_TOKEN:
  HELLO_TEXT: "привет, мир!"
```

Смысл:

* `build_config` — конфигурация builder-а;
* `build_env` — environment variables, передаваемые builder-у.

### ENV interpolation

В build config используется отдельный синтаксис:

```text
{{$ENV_NAME}}
```

Он означает:

> взять значение из environment текущего процесса.

Все такие ENV-переменные обязательны. Default values не поддерживаются: если переменная указана — она должна существовать, иначе C выдаёт error до запуска builder.

Например:

```yaml
dockerfile: "{{$ANALYTICS_DOCKERFILE}}"
```

означает, что `ANALYTICS_DOCKERFILE` должен существовать.

`build_env`:

```yaml
NPM_TOKEN:
```

означает:

```text
NPM_TOKEN ← взять из ENV NPM_TOKEN
```

Также возможны literal values:

```yaml
HELLO_TEXT: "привет, мир!"
```

или interpolation:

```yaml
REGISTRY: "{{$DOCKER_REGISTRY}}"
```

C должен предварительно проверить наличие всех необходимых ENV до запуска builder-а.

Credentials не должны попадать в build config. CI/runtime environment отвечает за Docker/npm/cloud credentials.

### OpenAPI entry point

Для safe build mode:

```yaml
build_config:
  openapi_entry: src/ycsf-openapi.ts
```

`openapi_entry` — это поле `build_config` приложения с NestJS-функцией (его читает builder B при composition), а не конфигурация openapi-приложения; у openapi-приложения в `build_config` — список `apps` (см. раздел 9).

Если не указан, C/B использует fallback chain (см. раздел 10).

---

# 7. Единый Builder API

Все builders получают project root.

Нет отдельного API scope вида "B receives precomputed swagger" и нет специальных C-specific namespace contracts.

Базовый контекст:

```ts
interface BuildContext {
  projectRoot: string;
  sourcePath?: string;
  buildConfig: unknown;
  buildEnv: Record<string, string>;
  outputDir: string;
}
```

Builder:

```ts
interface Builder {
  build(context: BuildContext): Promise<Artifact>;
}
```

Один builder invocation возвращает **один Artifact**.

Builder не обязан знать C internals.

---

# 8. Generic Artifact

Artifact должен быть полностью расширяемым.

```ts
export interface Artifact<T = unknown> {
  type: string;
  value: T;
}
```

C не анализирует `value` по конкретным типам.

Примеры:

```ts
Artifact<{
  archivePath: string;
  entryPoint: string;
}>
```

для Function,

```ts
Artifact<{
  image: string;
}>
```

для Container,

```ts
Artifact<{
  directory: string;
}>
```

для Frontend,

```ts
Artifact<{
  specPath: string;
  resourceReferences: ResourceReference[];
}>
```

для API Gateway.

`type` используется для выбора соответствующего materializer-а. Один artifact type — один materializer. При коллизии (два materializer заявляют `supports` для одного типа) C выдаёт error.

Конвенция именования artifact type — `<package-scope>:<kind>` (например, `ycforge:function`, `ycforge:api-gateway`), чтобы сторонние плагины не конфликтовали по глобальным строкам; коллизия типов по-прежнему error.

---

# 9. Project B configuration

Для B используется, например:

```text
openapi/
├── build_config.yaml
├── auth.yaml
└── overrides.yaml
```

`openapi/build_config.yaml` описывает, какие applications входят в конкретную API composition.

Например:

```yaml
build_config:
  apps:
    - user_service
    - orders
```

B получает project root и сам:

* читает `.ycsf/apps.yaml`;
* находит apps;
* читает их source directories;
* извлекает Nest Swagger/OpenAPI metadata;
* читает собственный `build_config.yaml`;
* читает `auth.yaml`;
* читает global overrides;
* находит per-app overrides;
* собирает итоговую API specification.

C не передаёт B готовые Swagger documents.

---

# 10. OpenAPI generation и safe build mode

При генерации OpenAPI B может запускать NestJS application/bootstrap.

Это потенциально опасно, потому что обычный bootstrap может:

* подключать DB;
* запускать migrations;
* ходить во внешние сервисы;
* выполнять side effects.

### Primary path: explicit entry point

Приложение экспортирует из указанного `openapi_entry`:

```ts
export async function buildYcsfOpenApi(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder().setTitle('API').build();
  return SwaggerModule.createDocument(app, config);
}
```

B вызывает эту функцию, получает готовый `OpenAPIObject`. B не лезет в reflection самостоятельно — он читает обычный OpenAPI spec, где `security` уже проставлен стандартным `SwaggerModule`.

Рекомендация: в `buildYcsfOpenApi` не вызывать `app.init()`/`app.listen()` и по возможности использовать metadata-only генерацию (`SwaggerModule.createDocument` без полной инициализации провайдеров), чтобы избежать подключений к БД даже при импорте `AppModule` целиком. Холодный старт и размер бандла NestJS-функции — ответственность builder-а `nestjs-function` (bundling через esbuild/webpack, tree-shaking), а не пользователя (см. раздел 21).

### Fallback chain

Если `openapi_entry` не указан:

1. Проверить `<app>/swagger.json` или `<app>/openapi.json` (уже собранный артефакт).
2. Попытаться `require('./dist/main')` и вызвать `buildYcsfOpenApi` (convention).
3. **Error** с сообщением: `Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.`

### Safe mode env

B **всегда** устанавливает `YCSF_OPENAPI_BUILD=1` перед вызовом entry point. Приложение может использовать это для условного отключения side effects, но primary защита — отдельный entry point, где разработчик явно контролирует импортируемые модули.

---

# 11. `@RequireAuth`

Утверждённый decorator:

```ts
@RequireAuth(
  scheme: string,
  guard: Type<CanActivate> | null,
)
```

Реализация:

```ts
export const RequireAuth = (scheme: string, guard: Type<CanActivate> | null) => {
  return applyDecorators(
    SetMetadata('ycsf:auth:guard', guard),
    SetMetadata('ycsf:auth:scheme', scheme),
    scheme === 'public' ? () => {} : ApiSecurity(scheme),
  );
};
```

Примеры.

Controller-level:

```ts
@RequireAuth('user', UserAuthGuard)
@Controller('users')
export class UsersController {}
```

Method-level:

```ts
@RequireAuth('admin', AdminGuard)
@Delete(':id')
remove() {}
```

Public route:

```ts
@RequireAuth('public', null)
@Get('/health')
health() {}
```

Семантика:

### Первый аргумент

```text
scheme
```

— имя authentication scheme из `auth.yaml`.

Он определяет generated API Gateway/OpenAPI security configuration.

### Второй аргумент

```text
guard
```

— настоящий NestJS Guard, который должен выполняться во runtime.

`null` означает намеренное отсутствие Nest authentication guard. Это сделано специально, чтобы public route была визуально очевидна.

### Precedence

```text
method > controller > project default
```

Нельзя выводить Guard из default scheme.

B проверяет, что scheme существует, но **не пытается доказать**, что конкретный `AdminGuard` действительно соответствует semantic meaning `'admin'`.

Можно создавать project-local wrappers:

```ts
export const UserOnly = () =>
  RequireAuth('user', UserAuthGuard);

export const Public = () =>
  RequireAuth('public', null);
```

Это позволяет приложениям не зависеть напрямую от YCSF-specific terminology.

Декоратор живёт в Project A как отдельный подпакет: `@ycforge/ycsf-nestjs-connector/auth` (subpath export). Приложение импортирует auth-контракты точечно (`import { RequireAuth } from '@ycforge/ycsf-nestjs-connector/auth'`), не поднимая весь connector. Аналогично оформляются и остальные декораторы A — `@QueueHandler`/`@QueueMessage` (подпакет `.../queue`), `@YandexContext` (подпакет `.../context`). B читает только OpenAPI metadata (`ApiSecurity`) из сгенерированного spec и не импортирует ни user-код, ни подпакеты A.

Runtime-применение guard: metadata `ycsf:auth:guard` сама по себе guard не активирует — A регистрирует глобальный guard, который читает metadata (method > controller) и делегирует указанному guard через DI; если guard равен `null`, проверка пропускается.

---

# 12. `auth.yaml`

Пример:

```yaml
defaultScheme: user

schemes:
  public:
    type: none

  user:
    type: jwt
    issuer: https://auth.example.com
    audience:
      - my-api
    jwksUri: https://auth.example.com/jwks.json

  internal:
    type: function
    function: functions.internal_authorizer
```

Минимальные scheme types:

```text
none
jwt
function
```

Модель должна быть extensible.

`function` authorizer может реализовывать:

* Bearer authentication;
* API key;
* Basic auth;
* DB-backed tokens;
* другие custom authentication mechanisms.

B не занимается:

* созданием key pairs;
* rotation;
* JWKS publishing;
* Lockbox;
* Object Storage;
* provisioning authorizer Function.

Он только генерирует соответствующую API Gateway configuration.

---

# 13. API composition

B — не просто Swagger merger.

Он формирует composition layer, включающий:

* Nest-generated OpenAPI operations;
* auth configuration;
* global overrides;
* per-app overrides;
* API Gateway extensions;
* integrations;
* resource references;
* manually declared gateway routes/integrations.

Поддерживаться потенциально могут:

* Cloud Functions;
* Serverless Containers;
* Message Queue;
* Object Storage;
* HTTP;
* dummy integration;
* другие Yandex API Gateway-compatible targets.

Например:

```text
HTTP → Message Queue
```

или direct static serving из Object Storage.

### Provenance

OpenAPI itself не знает, какая часть specification принадлежит какому source application. Provenance route→app B отслеживает **внутренне** во время composition — она нужна самому B для fail-fast диагностики конфликтов (см. раздел 14) и применения per-app overrides; после compile она downstream не требуется и в Artifact не включается. В интеграциях используются logical references (IDL) — реальные IDR существуют только после `terraform apply`.

Одна API composition (один `openapi/`-app) = один API Gateway (`gateways.<app>`). Несколько gateway в проекте допустимы: несколько openapi-приложений в `apps.yaml`, каждое со своим `build_config.yaml`/`auth.yaml`. Примеры в этом документе используют один gateway — `gateways.openapi`.

---

# 14. Overrides

B должен поддерживать:

```text
openapi/overrides.yaml
```

и local:

```text
<app>/overrides.yaml
```

Global override применяется к общей API specification.

Local override применяется к соответствующему subtree/path-space application.

Приоритет:

```text
local app override > global override
```

B должен сохранять provenance:

```text
route → app
```

Обычный generic deep YAML merge для OpenAPI нежелателен.

**MVP: fail-fast на conflict.** Если два app декларируют один и тот же `operationId` или пересекающийся `path` — B выдаёт error с понятной диагностикой (composition-конфликты — зона B и в standalone-режиме, и в pipeline C). Semantic merge / IR с пониманием OpenAPI semantics — post-MVP.

---

# 15. Resource model

Ресурсы имеют namespace.

Примеры:

```text
functions.user_service
containers.analytics
queues.events
buckets.frontend
```

Ссылка на конкретное свойство:

```text
functions.user_service.id
containers.analytics.id
queues.events.qurl
buckets.frontend.name
```

Logical resource domain выводится из artifact type builder-а, а не из имени app: `nestjs-function` → `functions.<app>`, `docker` → `containers.<app>`, `vite`/static frontend → `buckets.<app>`, `yandex-api-gateway` → `gateways.<app>`. Точный mapping определяется materializer-ом; имя ресурса совпадает с app ID.

Используется единый canonical representation:

```ts
interface ResourceReference {
  ref: string;
}
```

Например:

```ts
{
  ref: "functions.user_service.id"
}
```

Отдельного public mapping "IDL ↔ property" не требуется.

Внутри системы строка при необходимости разбирается на:

```text
domain
name
property
```

но canonical contract остаётся одной string reference.

---

# 16. IDL / IDT / IDR

Термины:

### IDL — logical resource identity

Например:

```text
functions.user_service
```

### IDT — Terraform resource address

Например:

```text
yandex_function.user_service
```

### IDR — real cloud resource

Например:

```text
d4e123...
```

или queue URL, bucket name и т.п.

Связь:

```text
IDL
 ↓
IDT
 ↓
IDR
```

Например:

```text
functions.user_service
    ↓
yandex_function.user_service
    ↓
actual Yandex Function ID
```

B работает с logical resource references.

Terraform materializer знает, как превратить logical resource references в Terraform expressions.

---

# 17. `.ycsf/resources.yaml`

Resources — это logical external/infrastructure resources, которые не обязательно производятся из application build.

Например:

```yaml
queues:
  events: {}

buckets:
  frontend: {}

functions:
  legacy_authorizer: {}
```

Application и resource — разные сущности.

`apps`:

> buildable source units.

`resources`:

> logical infrastructure/external resources.

Например:

```text
apps.user_service
    →
functions.user_service
```

А legacy Function, которой нет в repository как buildable app:

```text
functions.legacy_authorizer
```

может быть объявлена отдельно.

### Ownership semantics

Модель ownership жёсткая, без флагов:

* Ресурс описан в `apps.yaml` — **managed**: C генерирует Terraform resource через materializer.
* Ресурс описан в `resources.yaml` — **всегда external**: C **не генерирует** Terraform resource, а только создаёт reference для использования другими ресурсами (например, API Gateway может ссылаться на `functions.legacy_authorizer`). В Terraform-режиме materializer разрешает такой reference в `data`-source либо требует значение из `.ycsf/env.yaml`.

Следствие: `resources.yaml` никогда не является входом для materializer-ов из раздела 22. Yandex Message Queue / Object Storage materializers обслуживают artifacts приложений (например, vite-builder frontend-а → `buckets.frontend` как managed resource app-а), а не записи `resources.yaml`.

Одна и та же logical identity не может быть одновременно в `apps.yaml` и `resources.yaml` — это error на `ycsf check`.

---

# 18. ENV-only mode

B должен уметь работать без Terraform.

Для этого существует необязательный:

```text
.ycsf/env.yaml
```

Пример:

```yaml
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID

queues:
  events:
    qurl:
      env: EVENTS_QUEUE_URL

buckets:
  frontend:
    name:
      env: FRONTEND_BUCKET_NAME
```

Тогда:

```text
functions.legacy_authorizer.id
```

резолвится в:

```text
ENV[LEGACY_AUTHORIZER_ID]
```

и B может выпустить уже полностью materialized OpenAPI spec.

При переходе с ENV-only на Terraform сама B configuration не меняется.

`.ycsf/env.yaml` нужен только для простого non-Terraform сценария.

### Множественные окружения

YCSF не имеет env-профилей. Различия staging/prod выражаются через Terraform (workspaces, `*.tfvars`, variables) и build-time `{{$ENV}}`; `.ycsf/*.yaml` едины для всех окружений.

---

# 19. Interpolation namespaces

В системе существуют три разных interpolation mechanisms.

## YCSF build ENV

```text
{{$ENV_NAME}}
```

Используется в build_config/build_env.

## Terraform

```text
${...}
```

Используется Terraform.

## API Gateway variables

```text
${var.foo}
```

Используется непосредственно API Gateway.

### Logical template syntax (B → Materializer)

B генерирует **logical template syntax**:

```text
${resources.functions.user_service.id}
```

Materializer (Terraform) транслирует это в `$${yandex_function.user_service.id}` для `templatefile()`.

Так B вообще не знает о `$${...}` escaping и Terraform variable naming convention.

Особый случай:
если Terraform использует `templatefile()`, чтобы вывести API Gateway variable:

```text
$${var.foo}
```

в `.tftpl`

после обработки Terraform становится:

```text
${var.foo}
```

---

# 20. Project C — Build/Deployment Orchestrator

Project C — orchestration layer.

Он отвечает за:

1. загрузку project model;
2. discovery applications;
3. чтение app-level `build_config.yaml`;
4. разрешение `build_env`;
5. ENV validation;
6. invocation builders;
7. collection of generic artifacts;
8. invocation Terraform materializers;
9. запись generated Terraform;
10. orchestration:

* `terraform init`
* `terraform plan`
* `terraform apply`
* `ycsf destroy` (обёртка над `terraform destroy`)

11. frontend build/orchestration;
12. собственные checks/diagnostics;
13. при необходимости — orchestration migrations, если это будет отдельно окончательно утверждено.

C должен знать concepts:

```text
App
Builder
Artifact
Materializer
Terraform
Project model
```

C **не должен знать внутренние схемы**:

* NestJS;
* Docker;
* Go;
* Python;
* OpenAPI;
* auth.yaml;
* provider-specific Yandex Terraform fields;
* semantics конкретного builder/materializer.

### CLI

Команды C:

* `ycsf build` — builders → artifacts;
* `ycsf materialize` — artifacts → generated `.tf.json`;
* `ycsf check` — валидация project-level contracts (см. раздел 28);
* `ycsf plan` — build + materialize + `terraform plan`;
* `ycsf apply` — build + materialize + `terraform apply`;
* `ycsf destroy` — обёртка над `terraform destroy` (см. раздел 40).

`ycsf plan`/`apply`/`destroy` — тонкие обёртки над Terraform CLI, а не отдельный deployment engine.

---

# 21. Builder registry

Концептуально:

```text
C
 ├── Builder registry
 │    ├── nestjs-function
 │    ├── go-function
 │    ├── python-function
 │    ├── docker
 │    ├── vite
 │    └── yandex-api-gateway
```

`yandex-api-gateway` — это Project B, подключённый в C как builder plugin.

Для C B — просто builder, который возвращает Artifact.

C не должен разбирать внутренний OpenAPI IR B.

Builder `nestjs-function` отвечает также за bundling (esbuild/webpack, tree-shaking): холодный старт и размер бандла NestJS-функции — его зона, а не пользователя.

### Explicit mapping

Builder discovery — только через explicit mapping в `.ycsf/builders.yaml`:

```yaml
builders:
  nestjs-function: "@ycforge/builder-nestjs-function"
  docker: "@ycforge/builder-docker"
  yandex-api-gateway: "@ycforge/ycsf-api"

materializers:
  yandex-function: "@ycforge/materializer-yandex-function"
  yandex-api-gateway: "@ycforge/materializer-yandex-api-gateway"
```

Materializers регистрируются ключом `materializers:` в том же `builders.yaml`. Вариант регистрации через `package.json` не поддерживается: один источник истины, и `package.json` не версионирует схему.

C не делает auto-discovery по имени в `node_modules`.

---

# 22. Materializer plugins

Materializer — отдельный plugin extension point.

Базовый API:

```ts
export interface Materializer<A extends Artifact = Artifact> {
  supports(
    artifact: A,
    context: MaterializationContext,
  ): boolean;

  materialize(
    artifact: A,
    context: MaterializationContext,
  ): Promise<TerraformResource>;
}
```

Ключевой принцип:

> Materializer непосредственно возвращает TerraformResource. C записывает полученный Terraform representation.

Нет отдельного обязательного abstraction layer типа `Materialization`.

Материализаторы могут быть внешними npm packages.

Например:

```text
Yandex Function Terraform materializer
Yandex Container Terraform materializer
Yandex API Gateway Terraform materializer
Yandex Message Queue Terraform materializer
Yandex Object Storage Terraform materializer
```

C только:

* находит materializer;
* вызывает `supports`;
* вызывает `materialize`;
* получает TerraformResource;
* сериализует его в generated `.tf.json`.

### Collision policy

Один artifact type — один materializer. При коллизии (два materializer заявляют `supports` для одного типа) C выдаёт error.

---

# 23. Terraform model

Минимальный generic representation:

```ts
interface TerraformResource<T = unknown> {
  type: string;
  name: string;
  configuration: T;
}
```

При необходимости общий Terraform model может включать другие блоки:

```ts
type TerraformBlock =
  | TerraformResource
  | TerraformMoved
  | TerraformVariable
  | TerraformData
  | TerraformOutput;
```

Но C не должен пытаться моделировать полноценную Terraform provider schema.

Provider-specific schema знает materializer.

---

# 24. Generated Terraform

Принято разделение:

```text
infra/
  *.tf         # user-owned
  *.tf.json    # C-generated
```

Например:

```text
infra/
├── 00-ycsf-generated.tf.json
├── 01-ycsf-generated-gateway.tf.json
├── 99-ycsf-outputs.tf.json
├── user_service.tf
├── ydb.tf
└── ...
```

Terraform воспринимает `.tf` и `.tf.json` как одну module configuration.

Это специально позволяет:

* визуально различать ownership;
* не смешивать user-owned HCL с generated configuration;
* regeneration C не уничтожает пользовательский Terraform.

---

# 25. `.ycsf/extensions.yaml` — User extensions

Пользователь может декларативно расширять/переопределять generated resources без использования Terraform `*_override.tf`.

### Формат

```yaml
extensions:
  - target: "functions.user_service"     # IDL
    patch:
      environment:
        CUSTOM_VAR: "value"
      execution_timeout: "30s"
      service_account_id: "${yandex_iam_service_account.custom.id}"

  - target: "gateways.openapi"
    patch:
      custom_domains:
        - domain_id: "${yandex_api_gateway_domain.main.id}"
```

### Merge semantics

1. **Target resolution**: C ищет generated `TerraformResource`, у которого logical IDL соответствует `target`.
2. **Deep merge**: `extension.patch` рекурсивно мержится с `resource.configuration`.
   - Object: recursive merge.
   - Array: **replace** (predictable, no magic append).
   - Scalar: override.
3. **Interpolation**:
   - `{{$ENV}}` — не используется в extensions (это build-time).
   - `${...}` — Terraform expressions проходят как есть.
4. **Validation**: `ycsf check` проверяет, что `target` существует в generated model.

### Почему не Terraform override

| Terraform `*_override.tf` | YCSF extension |
|---------------------------|----------------|
| Заменяет **весь** nested block одного типа | Мержит поля на любом уровне вложенности |
| Адресация по Terraform IDT | Адресация по стабильному IDL |
| Нет валидации со стороны C | `ycsf check` валидирует target |
| Ломается при rename в C | IDL-stable |

### User-owned `.tf`

Пользователь пишет обычный Terraform в `*.tf` — generated resources живут в том же модуле:

```hcl
resource "yandex_iam_service_account" "custom" {
  name = "custom-sa"
}

resource "yandex_function_iam_binding" "users" {
  function_id = yandex_function.user_service.id
  role        = "serverless.functions.invoker"
  members     = ["serviceAccount:${yandex_iam_service_account.custom.id}"]
}
```

C не читает и не анализирует `*.tf`.

---

# 26. `.ycsf/outputs.yaml` — User outputs

Пользователь может декларировать outputs, ссылаясь на IDL:

```yaml
outputs:
  frontend_api_url:
    value: "gateways.openapi.domain"   # IDL reference
    description: "Public API endpoint"
```

C резолвит IDL → Terraform expression через materializer mapping и записывает в `99-ycsf-outputs.tf.json`:

```json
{
  "output": {
    "frontend_api_url": {
      "value": "${yandex_api_gateway.openapi.domain}",
      "description": "Public API endpoint"
    }
  }
}
```

### Auto-generated outputs

Materializer может декларировать outputs через `OutputBuilder` в `MaterializationContext`:

```ts
context.output.declare('ycsf_function_user_service_id', {
  value: 'yandex_function.user_service.id',
  description: 'YCSF generated: functions.user_service.id',
});
```

`value` передаётся как Terraform expression-строка без `${}`; C при сериализации в `.tf.json` оборачивает её в `${...}`.

C пишет auto-generated outputs с префиксом `ycsf_` в `99-ycsf-outputs.tf.json`. User-defined outputs — без префикса.

---

# 27. Минимальные generated resources

C/materializer должен генерировать только минимально необходимый Terraform resource.

Например:

```hcl
resource "yandex_function" "user_service" {
  runtime    = "nodejs22"
  entrypoint = "index.handler"
  user_hash  = "..."

  content {
    zip_filename = ".ycsf/artifacts/user_service.zip"
  }
}
```

Пользователь может в собственном Terraform добавить provider-specific configuration:

* service account;
* environment;
* secrets;
* mounts;
* Object Storage mounts;
* YDB configuration;
* Lockbox;
* IAM;
* VPC;
* scaling;
* другие поля provider-а.

Или через `.ycsf/extensions.yaml` (см. раздел 25).

C не должен создавать вторую абстракцию над Yandex Terraform provider.

Ключевой принцип:

> Terraform остаётся настоящей Terraform configuration, а не "Terraform-like schema" YCSF.

Если Yandex добавляет новый provider field, пользователь может использовать его сразу, не дожидаясь изменения C.

### Extensions на практике

На практике функции почти всегда требуют `service_account_id` (доступ к Lockbox/YDB/SQS), поэтому `extensions.yaml` — фактически обязательная часть реального проекта. Компактный пример:

```yaml
extensions:
  - target: "functions.user_service"
    patch:
      service_account_id: "${yandex_iam_service_account.app.id}"
      environment:
        APP_ENV: "production"
      # secrets-паттерн yandex_function: секрет из Lockbox в env-переменную
      secrets:
        - id: "${yandex_lockbox_secret.db.id}"
          version_id: "${yandex_lockbox_secret_version.db.id}"
          key: "password"
          environment_variable: "DB_PASSWORD"
```

Полный пример будет в docs.

---

# 28. `ycsf check`

C должен иметь lightweight validation layer.

`ycsf check` проверяет прежде всего собственные contracts.

В частности:

### Override targets

Если пользователь пытается override через `extensions.yaml`:

```text
functions.user_service
```

C проверяет, что такой generated resource действительно существует.

### Template variables

C проверяет, что все variables, которые используются generated `.tftpl`, имеют соответствующие mappings/values.

### Build ENV

C проверяет обязательные `{{$ENV}}`.

### Resource consistency

C проверяет базовую согласованность logical resource references/generated Terraform addresses.

### Extensions validation

C проверяет:
* `target` в `extensions.yaml` существует в generated model (по IDL);
* нет конфликтов target (один IDL — один patch);
* в `patch` нет `{{$ENV}}` (extensions работают с Terraform expressions, не с build env).

Но:

> C не должен превращаться в Terraform provider validator.

Глубокая валидация Terraform остаётся:

```bash
terraform validate
```

C может вызвать её как финальную проверку.

---

# 29. Terraform state

Terraform configuration описывает desired state.

Terraform state хранит mapping:

```text
Terraform address
    ↓
real cloud resource
```

Например:

```text
yandex_function.user_service
    ↓
d4e123...
```

`terraform plan` вычисляет изменения.

`terraform apply` применяет их.

Terraform expressions создают dependency graph.

Например API Gateway может ссылаться на Function:

```text
yandex_function.user_service.id
```

и Terraform сам понимает dependency/order.

Некоторые значения на plan-time могут быть:

```text
known after apply
```

и это нормально.

CI runners являются ephemeral, поэтому для production нужен remote Terraform backend.

Для Yandex Cloud возможен S3-compatible backend в Object Storage, при необходимости с locking через YDB.

C не обязан автоматически bootstrap-ить backend. Backend configuration остаётся Terraform concern.

---

# 30. B + C + Terraform

В production Terraform mode pipeline выглядит так:

```text
Project
  ↓
C loads project model
  ↓
discover apps
  ↓
load build_config.yaml
  ↓
resolve build_env
  ↓
validate ENV
  ↓
run builders
  ↓
Artifacts
  ↓
run materializers
  ↓
TerraformResource
  ↓
apply extensions.yaml patches
  ↓
write infra/*.tf.json
  ↓
terraform init
  ↓
terraform plan
  ↓
terraform apply
```

Для API Gateway:

```text
C
 ↓
B builder
 ↓
B reads projectRoot
 ↓
B discovers apps
 ↓
B reads Nest OpenAPI
 ↓
B reads auth.yaml
 ↓
B reads overrides
 ↓
B resolves/composes API
  (using logical template syntax ${resources.functions.user_service.id})
 ↓
API Gateway Artifact
 ↓
Yandex API Gateway Terraform materializer
  (translates logical refs to $${yandex_function.user_service.id})
 ↓
generated *.tf.json
```

Terraform materializer связывает API Gateway с другими Terraform-managed resources.

---

# 31. B Artifact и Terraform boundary

B Artifact может содержать, например:

```ts
interface ApiGatewayArtifactValue {
  specPath: string;
  resourceReferences: ResourceReference[];
}
```

B logical model использует **logical template syntax**:

```text
${resources.functions.user_service.id}
```

и не содержит Terraform-specific variables вроде:

```text
YCSF__FUNCTIONS__USER_SERVICE__ID
```

Такие Terraform variable names являются внутренним materialization detail C/materializer.

То есть:

```text
B:
${resources.functions.user_service.id}
```

↓

```text
Terraform materializer:
$${yandex_function.user_service.id}
```

и уже затем materializer может создать нужное template variable binding.

B не должен генерировать Terraform syntax.

---

# 32. API Gateway template materialization

Возможная схема:

```text
B produces:
  API Gateway spec/template
  + ResourceReferences (в logical syntax)
```

Terraform materializer генерирует resource, который использует B artifact через `templatefile()` либо эквивалентную Terraform mechanism.

Например generated Terraform должен логически связать:

```text
B-generated spec
```

с:

```text
yandex_api_gateway.openapi
```

и передать в template нужные Terraform resource values.

При этом:

* B знает resource references (в logical syntax);
* materializer знает Terraform;
* C только orchestrates;
* Terraform resolves actual resource IDs.

---

# 33. Resource reference lifecycle

Для Terraform mode допустима цепочка:

```text
B:
${resources.functions.user_service.id}

↓

materializer knows:
functions.user_service
    ↔
yandex_function.user_service

↓

Terraform expression:
$${yandex_function.user_service.id}
  (внутри templatefile)
  
↓

Terraform state:
actual Function ID
```

B не должен знать заранее actual ID.

Это важно, потому что actual resources могут быть созданы только во время `terraform apply`.

---

# 34. Resource naming and stability

Generated Terraform resource addresses должны быть стабильными.

Например:

```text
functions.user_service
→
yandex_function.user_service
```

Переименование logical ID или изменение Terraform address нельзя воспринимать как случайную замену resource.

Поэтому существует optional:

```text
.ycsf/moved.yaml
```

---

# 35. `.ycsf/moved.yaml`

Файл хранит исторические migrations логических resource identities и Terraform addresses.

Пример:

```yaml
moves:
  - from:
      idl: functions.users
      idt: yandex_function.users
    to:
      idl: functions.user_service
      idt: yandex_function.user_service

  - from:
      idl: functions.user_service
      idt: yandex_function.user_service
    to:
      idl: functions.accounts
      idt: yandex_function.accounts
```

Также возможно изменение только Terraform address:

```yaml
moves:
  - from:
      idl: functions.users
      idt: yandex_function.users
    to:
      idl: functions.users
      idt: yandex_function.user_api
```

C вычисляет current logical mapping из current project model, а `moved.yaml` является историческим источником migration information.

C может скомпилировать соответствующий Terraform:

```hcl
moved {
  from = yandex_function.users
  to   = yandex_function.user_service
}
```

Для цепочки migration C должен корректно учитывать history.

`moved.yaml` опционален.

Не требуется удалять/compact history в MVP.

C должен проверять:

* валидность move;
* отсутствие явно противоречащих bindings;
* соответствие target current resource;
* отсутствие dangling migration.

Смена Terraform resource type, например:

```text
functions.users
→
containers.users
```

не должна автоматически трактоваться как безопасный rename/move. Это потенциально другой resource type и обычно требует recreation/explicit migration semantics.

---

# 36. Frontend

Frontend является обычным `app`.

Например:

```yaml
apps:
  frontend:
    source_path: frontend
    builder: vite
```

Его:

```text
frontend/build_config.yaml
```

описывает frontend build.

C может передавать build-time environment variables, например:

```text
YANDEX_ID_APP_ID
```

через обычный `build_env` / `{{$ENV}}`.

Например:

```yaml
build_env:
  YANDEX_ID_APP_ID: "{{$YANDEX_ID_APP_ID}}"
```

Это build-time/public data.

Secrets нельзя помещать в frontend build environment, если они попадают в bundle. `ycsf check` может предупреждать на suspicious keys (`SECRET`, `PASSWORD`, `TOKEN`).

Специального:

```text
fromDeployment
```

механизма не предусматривается.

---

# 37. Serverless Containers

Architecture должна поддерживать Serverless Containers как полноценный deployment target.

Flow:

```text
app
 ↓
docker builder
 ↓
build/push image
 ↓
Artifact<{
  image: string
}>
 ↓
Yandex Serverless Container Terraform materializer
 ↓
yandex_serverless_container
```

Docker builder может работать с:

```text
cr.yandex/...
```

и желательно использовать immutable image reference:

```text
cr.yandex/...@sha256:...
```

вместо mutable:

```text
latest
```

Credentials остаются в CI/build environment.

A при этом не меняется.

API Gateway может использовать:

```text
serverless_containers
```

integration.

---

# 38. Local development

Локальная разработка реализуется в рамках `@ycforge/js-dev-tools`.

```ts
import { createYcsfLocalServer } from '@ycforge/js-dev-tools/server';

createYcsfLocalServer({
  entry: './src/main.ts',           // NestJS entry point
  apiGatewayV2: true,               // Эмуляция payload 2.0
  messageQueue: false,              // MQ trigger emulation
  port: 3000,
  yandexContext: {
    // IAM-token resolution:
    // 1. YC_IAM_TOKEN env
    // 2. ~/.yc/config.yaml (OAuth) → exchange
    // 3. ~/.yc/keys/... (SA key) → JWT → exchange
    token: await resolveIamToken(),
    folderId: process.env.YC_FOLDER_ID,
    cloudId: process.env.YC_CLOUD_ID,
  },
});
```

Сервер поднимает HTTP-сервер, транслирует входящие запросы в API Gateway v2 payload, вызывает handler из Project A, возвращает ответ. Прокидывает `trace-id` / IAM-токен в `@YandexContext()`.

---

# 39. Incremental builds

C может реализовывать кэширование на уровне C (content-addressed кэш артефактов):

* fingerprint source файлов app;
* skip build, если fingerprint не изменился и artifact существует;
* dependency graph через `depends_on` учитывается при инвалидации кэша.

---

# 40. Cleanup

Раз C поверх Terraform, а не наоборот:

```bash
ycsf destroy
```

является обёрткой над `terraform destroy` с дополнительной очисткой артефактов (zip, docker images в local registry, если применимо).

---

# 41. Общая architecture

Итоговая концептуальная схема:

```text
                         ┌───────────────────────────┐
                         │        Project C          │
                         │ Build / Orchestration     │
                         └─────────────┬─────────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 │                     │                     │
                 ▼                     ▼                     ▼
          Builder registry      Artifact<T>          Materializer registry
                 │                                         │
       ┌─────────┼─────────┐                      ┌─────────┼─────────┐
       │         │         │                      │         │         │
     Nest      Docker     Vite                    Function Container API GW
     Builder   Builder    Builder                 TF        TF       TF
       │         │         │                                         │
       │         │         │                                         │
       └─────────┴─────────┘                                         │
                 │                                                  │
                 ▼                                                  ▼
              Artifact                                        TerraformResource
                                                                  │
                                                                  ▼
                                                        generated *.tf.json
                                                                  │
                                                                  ▼
                                                           Terraform CLI
                                                         init / plan / apply
                                                                  │
                                                                  ▼
                                                            Yandex Cloud
```

Отдельно:

```text
Project B
   │
   │ builder plugin
   ▼
Project C
   │
   │ Artifact
   ▼
API Gateway Terraform materializer
```

А runtime:

```text
Yandex Cloud Function
        ↓
Project A
        ↓
ordinary NestJS application
```

---

# 42. Plugin SDK

Builders и materializers предполагаются внешними npm packages.

Для external developers нужен небольшой public SDK, условно:

```text
@ycforge/ycsf-sdk
```

Он экспортирует contracts вроде:

```ts
Builder
Artifact
BuildContext

Materializer
MaterializationContext

TerraformResource

ResourceReference

OutputBuilder

diagnostics/contracts
```

C реализует orchestration/runtime для этих contracts.

Таким образом ecosystem extensibility выглядит так:

```text
third-party npm package
        ↓
implements Builder / Materializer
        ↓
registered/loaded by C
```

C не обязан знать внутреннюю семантику plugin-а.

---

# 43. Версионирование контрактов

Builder/Materializer API, форматы `.ycsf/*.yaml`, Artifact — контракты между независимыми npm-пакетами, поэтому они версионируются явно.

Каждый `.ycsf/*.yaml` имеет обязательное поле `version: 1` на верхнем уровне; C отклоняет неизвестные версии с понятной ошибкой.

`@ycforge/ycsf-sdk` версионируется semver. C объявляет поддерживаемый диапазон SDK major-версий и проверяет версию плагина при загрузке (peer-зависимость плагина на SDK); несовместимость = error до запуска builders.

Изменение контракта = новая major-версия SDK + migration guide.

---

# 44. Что принципиально НЕ должно попасть в architecture

## Не делать C GOD TOOL

C не должен:

* напрямую управлять Yandex API;
* иметь собственный provisioning engine;
* иметь несколько deployment backends;
* превращаться в Terraform replacement;
* знать внутренние provider schemas;
* знать Nest/OpenAPI internals.

Основной deployment engine:

```text
Terraform
```

и только Terraform находится в рамках текущей архитектуры.

## Не превращать A в framework

A остаётся runtime adapter.

Не добавлять в него:

* deployment;
* API Gateway compiler;
* resource provisioning;
* auth infrastructure management;
* infrastructure abstractions.

## Не превращать B в Terraform compiler

B отвечает за API composition и OpenAPI/API Gateway semantics.

Terraform-specific knowledge должен находиться в materializer.

## Не создавать вторую Terraform-систему

Нельзя проектировать собственный YCSF DSL, который пытается заменить:

```text
Terraform provider schema
```

Terraform остаётся источником истины для infrastructure configuration.

---

# 45. Основные architectural invariants

1. **Application и resource — разные сущности.**

2. **Builder строит Artifact.**

3. **Artifact generic:**

   ```ts
   Artifact<T = unknown>
   ```

4. **Materializer превращает Artifact непосредственно в TerraformResource.**

5. **C записывает TerraformResource в generated `.tf.json`.**

6. **B не знает Terraform.**

7. **C не знает внутреннюю семантику B.**

8. **A не занимается deployment/provisioning.**

9. **Terraform остаётся реальным deployment/provisioning engine.**

10. **User-owned Terraform и C-generated Terraform живут в одном module directory.**

11. **Generated files — `.tf.json`; user files — `.tf`.**

12. **Resource references в B используют canonical string:**

    ```text
    functions.user_service.id
    ```

13. **IDL → IDT mapping вычисляется из текущей project model.**

14. **`moved.yaml` хранит history, а не текущую resource mapping.**

15. **C выполняет только собственные lightweight checks; provider validation выполняет Terraform.**

16. **Все builders получают `projectRoot` и сами работают со своим project scope.**

17. **App-specific configuration находится рядом с app в `build_config.yaml`.**

18. **`{{$ENV}}` — единый YCSF build-time ENV interpolation syntax.**

19. **ENV values должны быть известны до invocation builder-а.**

20. **Frontend build environment — только public/build-time data, не secrets.**

21. **OpenAPI build должен иметь safe mode через explicit entry point.**

22. **User extensions через `.ycsf/extensions.yaml` используют IDL-адресацию и deep merge до записи `.tf.json`.**

23. **Logical template syntax (`${resources...}`) в B, Terraform syntax в materializer.**

24. **Один artifact type — один materializer. Коллизия = error.**

25. **Builder discovery — explicit mapping, не magic strings.**

26. **Apps — managed: C генерирует для них Terraform resources; ресурсы из `resources.yaml` — всегда external (reference only), Terraform resource для них не генерируется.**

---

# 46. Главная ментальная модель

Вся система должна восприниматься как pipeline:

```text
SOURCE
  ↓
BUILD
  ↓
ARTIFACT
  ↓
MATERIALIZE
  ↓
TERRAFORM CONFIG
  ↓
TERRAFORM STATE / PLAN / APPLY
  ↓
REAL YANDEX CLOUD RESOURCES
```

При этом API composition является отдельным compiler pipeline:

```text
NestJS metadata
      +
auth.yaml
      +
overrides
      +
resource references
      ↓
Project B
      ↓
API Gateway Artifact
      ↓
Terraform materializer
      ↓
yandex_api_gateway
```

А runtime application pipeline:

```text
API Gateway / MQ
      ↓
Cloud Function
      ↓
Project A
      ↓
ordinary NestJS
```

Таким образом система разделяет три совершенно разные проблемы:

```text
A = "как запустить приложение"
B = "каким должен быть API Gateway"
C = "как собрать проект и выразить инфраструктуру через Terraform"
Terraform = "как привести инфраструктуру к desired state"
```

Это является базовой архитектурной точкой отсчёта для дальнейшего проектирования API, file formats, plugin loading, resource ownership, Terraform materialization, diagnostics, CLI и implementation details.
