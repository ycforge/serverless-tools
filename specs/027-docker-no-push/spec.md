# Spec 027: docker-no-push — локальная сборка `ycforge:docker-image` без публикации в registry

| | |
|---|---|
| Spec ID | 027 |
| Название | docker-no-push |
| Feature branch | `027-docker-no-push` (от `dev`) |
| Status | 🚧 In progress |
| Created | 2026-09-13 |
| Inputs | BIG-5 из `specs/024-e2e-reference/plan.md` + NG-2 из 025 (docker `no_push` — «собственный spec-цикл → 027») |
| Dependencies | 013 (builder-registry ✅), 018 (builders-core ✅), 025 (e2e-enablement 🚧 — values через materialize) |
| IDEA.md | §37 (Serverless Containers: docker builder, immutable `@sha256:`) |
| Packages | `packages/builders-core` (`@ycforge/builders-core`, builder `docker`, subpath `./docker`) |
| Owns contract | `DockerBuildConfig`/`DockerArtifactValue` build_config-формат (additive amendment 018-контракта `contracts/builders-core.json`) |

## 1. Проблема и цель

**BIG-5 — docker-builder всегда push.** Builders-core docker builder выполняет **build + push как единое целое** и резолвит digest через registry (`packages/builders-core/src/docker/index.ts:16-22` → `buildAndPush` в `cli.ts:56-99`: `docker build` → `docker push <repository>:<tag>` → digest из push-output → fallback `docker image inspect '{{index .RepoDigests 0}}'`). Опции «собрать без push» не существует; `BLC_IMAGE_DIGEST_UNAVAILABLE` наступает только если push удался, а digest не резолвится. Контракт `DockerArtifactValue.image = "<repository>@sha256:<hex>"` — «never a mutable tag» (`packages/materializers-core/src/types.ts:66-68`, `packages/builders-core/src/types.ts:47-49`).

Последствия:

- Reference-проект spec 024 (контейнер `analytics`, FR-020 «сборка без push») физически нельзя собрать локально: для каждого build требуются credentials и доступ к registry.
- Окружение без работающего docker daemon (например darwin/arm64, где `docker` CLI есть, а daemon выключен — проверено 2026-09-13: `unix:///Users/mimbol/.docker/run/docker.sock` не существует) не может пройти docker-стадию пайплайна даже для локального `terraform plan`.
- CI, который только строит образ для последующего отдельного шага публикации, вынужден иметь доступ к registry на шаге сборки.

**Цель.** Аддитивная опция local-only сборки docker-образа **без публикации** в registry: `docker build` в локальный daemon + digest из **локального inspect**, возвращаемый в `DockerArtifactValue.image` той же immutable-строкой `"<repository>@sha256:<hex>"`. Инвариант «never a mutable tag» сохраняется; контрактная строка не меняется. Поведение по умолчанию (без опции) — ровно текущее: push продолжается. Опция не требует правок в pilot, composer, materializers, vite/nestjs-function: это чистое расширение docker builder в packages/builders-core.

## 2. Метрика успеха (measurable)

- **SC-001**. На reference-проекте 024 контейнер `analytics` с опцией `image.no_push: true` собирается локально без сети и без registry: bit-совместимый артефакт `{ type: 'ycforge:docker-image', value: { image: "<repository>@sha256:<hex64>" } }`.
- **SC-002**. Ни одна инвокация с включённой опцией не обращается к registry: журнал CLI-вызовов не содержит ни одного subcommand `push`; артефакт валиден без внешних сервисов.
- **SC-003**. Локальный digest детерминирован для идентичных входных данных: повторная сборка с тем же Dockerfile/context даёт тот же `image` (content-адресуемая ссылка), а не случайный tag.
- **SC-004**. Когда локальная сборка невозможна (CLI отсутствует, daemon не запущен, digest недоступен) — fail-fast диагностика с кодом и пояснением, ни одного частичного артефакта, ни одного тихого пропуска; 0% «молчаливых» деградаций.
- **SC-005**. Поведение по умолчанию не изменено: та же конфигурация, что и раньше (без `no_push`), даёт прежний build→push→digest→artifact бит-в-бит; существующий тест-набор docker.spec.ts остаётся зелёным без изменений.
- **SC-006**. Материализатор контейнера (019, `yandex-serverless-container`) потребляет артефакт no-push без каких-либо правок: `value.image` — та же immutable-форма.
- **SC-007**. Контракт аддитивен: добавлено только optional-поле `image.no_push` (тип + JSON-schema); ни один существующий тип/константа не изменён; контракт-агрегат схождения (type-tests) легитимирует аддитивность.

## 3. Исследование (проверено по коду на 2026-09-13)

- Текущий поток: `src/docker/index.ts:16-22` — `parseDockerConfig` → `buildAndPush` → `Artifact { type: 'ycforge:docker-image', value: { image: \`\${repository}@\${digest}\` } }`. Опции «только build» нет.
- `src/docker/cli.ts:56-99`: `runDocker(['build', '-f', dockerfile, '-t', ref, sourcePath])` → `runDocker(['push', ref])` → `digestFromPushOutput` (регексовое извлечение из stdout push) → fallback `docker image inspect --format '{{index .RepoDigests 0}}'`. Локального (без push) пути резолва digest нет; `RepoDigests` у непушенного локального образа пуст.
- `src/docker/config.ts:26-46` (`parseDockerConfig`): `image.repository` обязателен (`BLC_INVALID_CONFIG`), `tag` default `latest`, `dockerfile` default `Dockerfile`; поля `no_push` нет.
- `src/types.ts:64-68`: `DockerBuildConfig { image?: { repository, tag? }, dockerfile? }`; `DockerArtifactValue.image` — «never a mutable tag (FR-011)».
- `src/diagnostics.ts`: семейство `BLC_*`; `BLC_BUILD_FAILED` — CLI недоступен / build/push ненулевой exit (stderr-tail DQ-6); `BLC_IMAGE_DIGEST_UNAVAILABLE` — «push succeeded but digest not resolved» (const, non-breaking).
- Контракт 018 — `specs/018-builders-core/contracts/builders-core.json` `#/definitions/dockerBuildConfig` (image.properties: repository, tag) и `#/errorCodes` (BLC_*); дополнения — аддитивные.
- Потребитель — `packages/materializers-core/src/yandex-serverless-container/index.ts:10-30`: читает `value.image` as-is, кладёт в `yandex_serverless_container.image`; правок не требует (NG-3).
- Проброс конфигурации в C — `packages/pilot/src/build/index.ts:258-296`: `buildConfig = projectModel.build_configs.get(appId)?.build_config ?? {}` передаётся builder'у `unknown`-ом; per-app `build_config.yaml` (wrapper `build_config: {…}`) для docker builder versionless (spec 011) — **C не валидирует поля docker**; значит, `image.no_push` доезжает до builder'а без правок pilot (D-6).
- Тесты — `packages/builders-core/test/unit/docker.spec.ts` (fake-docker через `test/helpers/fake-bins.ts`: журнал argv `ARG …`, режимы `build`/`push`/`image`, digest только из push-пути) — характеристические, Constitution II exception (тонкая оркестрация CLI).
- Окружение: `docker version` 29.5.2 (client, darwin/arm64) присутствует; `docker info` → daemon НЕ запущен. Приёмка в текущей среде — только hermetic через fake-docker; smoke на реальном daemon — опционально вне unit-цикла.

## 4. Non-goals (что НЕ делаем в 027)

| # | Тема | Почему не здесь | Куда |
|---|---|---|---|
| NG-1 | Изменение формата image-string `"<repository>@sha256:<hex>"` / введение mutable-тегов, локальных алиасов или «другого» контракта value | Инвариант «never a mutable tag» (018/019) сохраняется; любой слом формата — breaking change для materializer-контракта | — |
| NG-2 | Собственный registry, кэш-реестров, имитация registry локально, offline-дистрибуция слоёв | Задача — локальная сборка, а не приватный registry | future |
| NG-3 | Правки packages/materializers-core (в т.ч. yandex-serverless-container) и контрактов `@ycforge/pilot/contracts` | Materializer уже потребляет `value.image`; C не знает и не должен знать про `no_push` | — |
| NG-4 | Правки vite / nestjs-function builder-ов | Опция специфична для docker | — |
| NG-5 | Правки packages/pilot / packages/composer / форматов `.ycsf/*.yaml` | `build_config` — versionless и opaque для C; аддитивное поле не требует изменений C | — |
| NG-6 | Запуск/менеджмент docker daemon как обязанность инструмента | Инфраструктура хост-окружения, вне toolchain | docs/руководство |
| NG-7 | Изменение push-семантики (multi-platform, digest-based push, mirror-пушки, credentials-флоу) | Вне объёма; push-режим только ради сохранения поведения | future |
| NG-8 | Деплой образа в облако / гарантия pullability no-push артефакта | No-push артефакт — для локальной разработки/плана/валидации; публикация — отдельный осознанный шаг | assumption A-2/A-5 |

## 5. Домен и ключевые сущности

- **`image.no_push`** — аддитивная опция docker `build_config.yaml` (app-level, versionless): `{ image: { repository, tag?, no_push? }, dockerfile? }`. `true` → only-build режим; `false`/отсутствует → текущее push-поведение.
- **DockerArtifactValue** — `{ image: "<repository>@sha256:<hex64>" }`; контракт не меняется; в no-push-режиме `<hex64>` — content-digest из локального daemon.
- **Локальный digest** — content-адресуемый идентификатор образа, который выдаёт локальный docker daemon после build, **без** обращения к registry (см. D-3, A-2).
- **`BLC_IMAGE_DIGEST_UNAVAILABLE`** — существующий код, привлекаемый в no-push-ветке для «build успешен, но локальный digest недоступен» (message уточняет локальный scope; const не меняется).
- **fake-docker** — тестовый хост-бинарник (характеризация CLI), расширяемый режимом `localDigest` и журналом argv для доказательства «push не вызывался».

## 6. User stories

### US-1 (P1) — Локальная сборка контейнера без registry

Как разработчик reference-проекта 024 (контейнер `analytics`) на машине с **локальным docker daemon**, но без доступа/credentials к registry, я хочу собирать образ и получать артефакт, чтобы пройти локальный `ycsf plan`/валидацию без сети.

Когда в build_config контейнера выставлено `image.no_push: true`:
- docker builder выполняет `docker build` в локальный daemon (dockerfile/tag/sourcePath — как обычно);
- digest резолвится из локального daemon, **не** из registry;
- возвращается `Artifact { type: 'ycforge:docker-image', value: { image: "<repository>@sha256:<hex64>" } }`;
- ни одного вызова `docker push` / сетевого обращения к registry не выполняется.
→ {US-1} АС-наборы: FR-001, FR-002, FR-003, FR-006.

**Why this priority**: без опции docker-стадия вообще неисполнима локально (BIG-5); это и есть ядро фичи.

**Independent Test**: fixture-проект `analytics`, fake-docker с режимом локального digest; проверка артефакта и журнала argv (нет `ARG push`).

**Acceptance Scenarios**:

1. **Given** `build_config: { image: { repository: "cr.yandex/crp/analytics", tag: "v1", no_push: true }, dockerfile: "Dockerfile" }` и локальный daemon (fake), **When** `build()` выполнен, **Then** `Artifact.type === 'ycforge:docker-image'`, `value.image === "cr.yandex/crp/analytics@sha256:<hex64>"` (матчит `/@sha256:[a-f0-9]{64}$/`).
2. **Given** журнал argv fake-docker, **When** build с `no_push: true` выполнен, **Then** журнал содержит subcommand `build`, но **не содержит** subcommand `push` (ни один `ARG push` на строку журнала).
3. **Given** повторный build с идентичными входными данными (тот же sourcePath/Dockerfile), **When** второй build выполнен, **Then** `value.image` совпадает посегментно (детерминированный локальный digest, не случайный tag).
4. **Given** build_config **без** `no_push`, **When** build выполнен, **Then** поведение прежнее: subcommand `push` присутствует в журнале (compat, SC-005).

### US-2 (P1) — Инвариант image-string сохраняется и в no-push-режиме

Как потребитель контракта (materializer yandex-serverless-container, plan-фаза), я хочу, чтобы артефакт no-push оставался immutable-ссылкой `"<repository>@sha256:<hex>"`, чтобы нижележащие стадии не знали и не могли узнать о существовании «локального режима».

Когда build выполнен с `no_push: true`:
- `value.image` — ровно та же форма, что и в push-режиме (левый префикс — `image.repository` из конфига, `@sha256:<64hex>`);
- mutable `image.tag` (default `latest`) в `value.image` **не попадает** ни при каких обстоятельствах;
- `BLC_IMAGE_DIGEST_UNAVAILABLE` не бросается при наличии локального digest.
→ {US-2} АС-наборы: FR-003, FR-008, FR-007.

**Why this priority**: «never a mutable tag» — защищаемый контракт (018/019); его слом был бы breaking change поверх innocent-фичи.

**Independent Test**: табличный unit-тест: для каждой контрольной конфигурации `value.image` матчит `/@sha256:[a-f0-9]{64}$/` и не содержит `:` перед `@` (нет «:latest@sha256:…»).

**Acceptance Scenarios**:

1. **Given** `no_push: true` и tag `v1` в конфиге, **When** build успешен, **Then** `value.image` не содержит `:v1` и не содержит `:latest`; форма строго `<repository>@sha256:<hex64>`.
2. **Given** `no_push: true`, tag из конфига отсутствует (default `latest`), **When** build успешен, **Then** локально образ тегирован `…:latest` (для адресности в daemon), но `value.image` — строго digest-форма без `latest`.
3. **Given** материализатор `yandex_serverless_container` получает `{ type: 'ycforge:docker-image', value: { image } }` от no-push build, **When** `materialize` вызван, **Then** правок материализатора не требуется; `configuration.image === value.image` as-is.

### US-3 (P1) — Честный fail-fast, когда локальная сборка невозможна

Как разработчик на машине **без работающего docker daemon** (e.g. darwin/arm64) или с битым CLI, я хочу явную и понятную ошибку, а не молчаливый результат или псевдо-успех.

Когда `no_push: true`, но локальная сборка невозможна:
- CLI `docker` отсутствует / процесс не запускается → fail-fast `BLC_BUILD_FAILED` с пояснением (существующая семантика);
- daemon не доступен (build падает с connect-ошибкой) → `BLC_BUILD_FAILED` с хвостом stderr (сообщение daemon видно), **без** попытки push;
- build успешен, но daemon не отдал digest → `BLC_IMAGE_DIGEST_UNAVAILABLE` с сообщением про локальный scope;
- ни в одном случае не возвращается частичный/невалидный Artifact.
→ {US-3} АС-наборы: FR-004, FR-005.

**Why this priority**: BIG-5 явно требует «fail-fast при невозможности собрать локально с явной диагностикой, а не молча»; это второе ядро фичи после US-1.

**Independent Test**: fake-docker в режимах `buildExit≠0` (с socket-ошибкой в stderr) и «нет локального digest»; утверждение кодов без реального daemon.

**Acceptance Scenarios**:

1. **Given** fake-docker отсутствует в PATH (spawn error), **When** build с `no_push: true`, **Then** reject с `BLC_BUILD_FAILED`; сообщение содержит «docker CLI unavailable».
2. **Given** fake-docker с `buildExit: 1` и stderr `Cannot connect to the Docker daemon…Is the docker daemon running?`, **When** build, **Then** reject с `BLC_BUILD_FAILED`; сообщение содержит хвост stderr (daemon-диагностика видна); push не вызывался.
3. **Given** build успешен (exit 0), но локальный digest не отдаётся, **When** build, **Then** reject с `BLC_IMAGE_DIGEST_UNAVAILABLE`; сообщение говорит о локальном daemon; `Artifact` не возвращён.
4. **Given** любой из провалов выше, **When** проверяется журнал argv, **Then** subcommand `push` отсутствует (провал не маскируется push-попыткой).

### US-4 (P2) — CI build-only: сборка без credentials registry

Как автор CI-пайплайна, я хочу на шаге сборки только построить и зафиксировать immutable-артефакт, а публикацию вынести отдельным шагом (задеплоить шлёт тот, у кого есть credentials), чтобы шаг сборки работал на runner'ах без доступа к registry.

Когда в CI собран образ с `image.no_push: true`:
- шаг сборки надёжен без `docker login`/credential-helper/kредов;
- артефакт `ycforge:docker-image` содержит детерминированный digest для downstream-валидации/планирования;
- отдельный (поздний) шаг публикации может выполнить реальный push того же контекста.
→ {US-4} АС-наборы: FR-002, FR-003, FR-007.

**Why this priority**: официальный use-case «CI-среда build-only» из описания фичи; расширяет зону применения кроме локальной разработки.

**Independent Test**: hermetic: fake-docker, отсутствие каких-либо ENV kредов не требуется — ни один секрет/кред не читается (FR-012 018 сохраняется).

**Acceptance Scenarios**:

1. **Given** пустое/минимальное buildEnv без кредов (нет `DOCKER_*`, `~/.docker/config.json` не при чём), **When** build с `no_push: true`, **Then** build успешен; журнал argv и env не содержат секретов/kредов.
2. **Given** успешный build с `no_push: true`, **When** артефакт передаётся в materialize (025: values через materialize), **Then** `.tf.json` генерируется с image-строкой без правок материализатора.
3. **Given** CI-шаг с `no_push: true`, затем отдельный шаг `docker push` тем же пользователем со credentials, **When** оба выполнены, **Then** первый не требует registry, второй — публикует (027 не трогает и не дублирует push-путь).

### US-5 (P2) — 0 регрессий push-режима

Как существующий пользователь docker builder, я хочу чтобы добавление опции не изменило ни одно из моих текущих конфигураций и продолжение push повсеместно.

Когда конфигурация **не** содержит `no_push`:
- build→push→digest→artifact работает ровно как раньше (включая fallback `image inspect` и `BLC_IMAGE_DIGEST_UNAVAILABLE`);
- существующий тест-набор `packages/builders-core/test/unit/docker.spec.ts` проходит без изменений.
→ {US-5} АС-наборы: FR-007, FR-008.

**Why this priority**: additive contract (Constitution III) — фича не может ломать опубликованное поведение.

**Independent Test**: целиком существующий docker.spec.ts как регрессионный набор; поверх — новый no-push-набор.

**Acceptance Scenarios**:

1. **Given** `build_config` прежнего вида (только `image.repository`/`tag`/`dockerfile`), **When** build, **Then** журнал fake-docker содержит `ARG push`, digest из push-пути; артефакт digest-формы (все прежние тесты зелёные).
2. **Given** push успешен, digest не входит в push-output, но `image inspect` даёт digest, **When** build, **Then** fallback работает (прежний тест FR-011 fallback не изменён).
3. **Given** `no_push` в конфиге с non-boolean значением (`"true"`, `1`), **When** build, **Then** fail-fast `BLC_INVALID_CONFIG` (поле `image.no_push`), push не вызывается, поведение детерминировано.

## 7. Exact claims (FR)

В скобках — привязка к теме/решению.

- **FR-001**. Docker `build_config.yaml` получает аддитивную опцию `image.no_push?: boolean` (default `false`): `true` → only-build, `false`/отсутствие → текущее push-поведение; опция объявлена в `DockerBuildConfig` и JSON-schema `dockerBuildConfig`. (BIG-5, D-1, D-2)
- **FR-002**. При `no_push: true` builder выполняет `docker build` (dockerfile/tag/sourcePath семантика не меняется) и **НЕ вызывает ни одного `docker push`**; обращение к registry не выполняется (наблюдаемо: журнал CLI-вызовов без subcommand `push`). (US-1, US-4, D-5)
- **FR-003**. При `no_push: true` digest резолвится из локального docker daemon (build-output/iidfile/image inspect), а не из registry; `Artifact.value.image = "<repository>@sha256:<hex64>"`, mutable-тег в `value.image` недопустим ни при каких обстоятельствах (инвариант DockerArtifactValue сохраняется). (US-1, US-2, D-3)
- **FR-004**. При `no_push: true` и успешном build, но недоступном локальном digest — fail-fast `BLC_IMAGE_DIGEST_UNAVAILABLE` с message о локальном daemon; `Artifact` не возвращается; константа кода сохраняется (const frozen, расширяется только описание в JSON-schema). (US-3, D-4)
- **FR-005**. При `no_push: true` и невозможности локальной сборки (CLI недоступен / build ненулевой exit, в т.ч. daemon не запущен) — fail-fast `BLC_BUILD_FAILED` с хвостом stderr (существующие семантики и `tailStderr` DQ-6); push-попытка не выполняется; частичного артефакта нет. (US-3, D-4)
- **FR-006**. Проверка конфигурации: `image.repository` по-прежнему обязателен в обоих режимах (`BLC_INVALID_CONFIG` — нет разумного дефолта для реестра); `tag`/`dockerfile` дефолты не меняются; `no_push` типизирован строго булевым (не-string, не-number) → иначе `BLC_INVALID_CONFIG` с полем `image.no_push`. (US-1, US-5-AC3, D-2, D-5)
- **FR-007**. Push-режим семантически неизменен: `no_push` отсутствует/false → build→push→digest→artifact ровно как в 018; fallback `image inspect`/`BLC_IMAGE_DIGEST_UNAVAILABLE` для push-пути без изменений; существующий docker.spec.ts зелёный без правок. (US-5, SC-005)
- **FR-008**. `DockerBuildConfig` и JSON-schema `dockerBuildConfig` расширены только additively (`image.no_push`, boolean, default false); no mutations существующих членов; type-tests легитимируют аддитивность и заморозку инварианта `value.image`. (US-2, US-5, SC-007)

## 8. Edge cases

- **`no_push: true`, но отсутствует `image.repository`** → `BLC_INVALID_CONFIG` (repository обязателен в любом режиме: без него image-string не построить).
- **`no_push` не boolean** (`"true"`, `1`, `null` в YAML-семантике) → `BLC_INVALID_CONFIG`, поле `image.no_push`; не угадывание (Constitution V).
- **Daemon недоступен** → `docker build` падает с connect-ошибкой → `BLC_BUILD_FAILED`, хвост stderr несёт «Cannot connect to the Docker daemon… docker.sock», push не пытается.
- **Build успешен, digests нет** → `BLC_IMAGE_DIGEST_UNAVAILABLE` (local scope в message).
- **Остаточный `{{$ENV}}` в `image.tag`** → `BLC_ENV_NOT_RESOLVED` до любого CLI-вызова — без изменений (префлайт `assertNoResidualEnv`, `src/docker/index.ts:14`).
- **Невалидный tag (пробелы, ведущий `-`)** → `BLC_INVALID_CONFIG`, arg-injection guard сохраняется и в no-push (tag используется в `-t`, D-5).
- **Inspect возвращает несколько строк/digest** → детерминированное извлечение первого `sha256:[a-f0-9]{64}` (аналогично push-пути).
- **`localDigest` инвариант при неоднозначности** — локальный digest может включать отличный от registry manifest-digest; артефакт остаётся честным (см. A-2); путаница не «чинится» молча.
- **Неизвестные top-level ключи build_config** (общие поля C) по-прежнему игнорируются (тест coexistence 018, без регрессий).
- **Нет daemon вообще** (как сейчас на машине автора) → фича не «включает» daemon (NG-6): диагностика честная, реальная сборка требует рабочего daemon.
- **Секреты** — no-push-путь не читает credentials (FR-012 из 018 сохраняется): новых обращений к секретам нет.

## 9. Decisions (D)

- **D-1 (опция `image.no_push` в image-секции)**. Опция живёт в `image`-секции docker `build_config.yaml` рядом с `repository`/`tag`, имя `no_push`, default `false`, строго boolean. Разумный дефолт для registry не существует — repository обязателен всегда, no_push лишь отключает публикацию, а не адрес образа.
- **D-2 (additive contract, `version: 1` не трогается)**. `DockerBuildConfig` + `dockerBuildConfig` schema расширяются only additively; контракт 018 не сломан; существующие конфигурации валидны без изменений; миграции нет. (Constitution III)
- **D-3 (локальный digest из daemon, image-string инвариант)**. No-push digest резолвится из локального daemon (build-output / `--iidfile` / `image inspect` `.Id`), НЕ из registry (`RepoDigests` у локального образа пуст). Результат — content-адресуемый `sha256:<hex>`, детерминированный идентичными входами. Осознанное ограничение: локальный content-digest не обязан равняться будущему registry manifest-digest после реального push; «pullable откуда-бы-то-ни-было» не гарантируется (A-2). Это сохраняет инвариант «never a mutable tag» без лжи: строка остается immutable-формой, честно отражающей локальное содержимое.
- **D-4 (fail-fast семантика без новых кодов)**. CLI/daemon/build-провалы → существующий `BLC_BUILD_FAILED` (сообщение уже несёт причину через tail, DQ-6). Digest-недоступность после успешного build → существующий `BLC_IMAGE_DIGEST_UNAVAILABLE` с уточнённым message (const frozen; в JSON-schema расширяется description до обоих scope). Новые коды не вводятся: разделение «push-успех без digest» и «local-успех без digest» по коду не нужно — оба означает «сборка есть, digest нет», диагностика дифференцируется message. Тихой деградации не существует (Constitution V).
- **D-5 (tag-семантика не меняется: локальный тег для адресности)**. В no-push режиме образ по-прежнему тегируется локально `<repository>:<tag>` (default `latest`) — так build детерминирован и объект адресуем в daemon; `tag` в `value.image` не попадает (FR-002/FR-003). Продление валидации tag (без пробелов/`-`) сохраняется.
- **D-6 (0 правок C/B/materializers)**. Per-app `build_config` для docker builder — versionless и opaque для C (pilot/build dispatch передаёт `context.buildConfig` как есть); аддитивное поле доезжает до builder'а без изменений pilot. Materializer потребляет `value.image` (NG-3). Vite/nestjs-function в стороне (NG-4). Это чистое расширение `packages/builders-core`.

## 10. Что CAN'T быть сделано (кваб-категория)

- Не меняется формат `Artifact.value.image` (никаких изменений «never a mutable tag», никаких алиасов/тегов).
- Не вводится новый формат `.ycsf/*.yaml` (version bump сверх `version: 1`) и не меняется C-пайплайн; `no_push` — данные внутри существующих конфигураций.
- Не создаётся собственный registry / кэш-реестров и не реализуется оффлайн-дистрибуция образов.
- Не вводится «предупреждение-но-продолжить» при невозможности собрать локально: только fail-fast `BLC_*`.
- Не запускается docker daemon инструментальными средствами и не добавляются сервисные интеграции.
- Не удаляются/не переименовываются существующие константы `BLC_*`; `BLC_IMAGE_DIGEST_UNAVAILABLE` — только расширенное описание, не const.
- Не трогаются существующие push-тесты и их семантика (docker.spec.ts остаётся как есть).

## 11. Assumptions

- **A-1**. Имя опции — `no_push`, расположение — `image`-секция docker build_config (per feature description); пример: `{ image: { repository: "cr.yandex/…", tag: "v1", no_push: true }, dockerfile: "Dockerfile" }`.
- **A-2**. Локальный digest — content-digest локального daemon; детерминирован для идентичных входов; НЕ обязан совпадать с будущим registry manifest-digest; артефакт no-push не обязан быть pullable до реального push; материализатор/plan не требуют pullability.
- **A-3**. No-push по-прежнему требует работающий локальный docker daemon (build иначе невозможен); регистрация/credentials/сеть/интернет — НЕ требуются. На машине без daemon — честная диагностика (US-3), а не «включение» daemon (NG-6).
- **A-4**. Поведение по умолчанию не меняется; опция аддитивна, миграции/переключения конфигураций не требуются.
- **A-5**. Деплой образа в облако — вне spec; no-push целевой сценарий — локальная разработка, локальный plan/валидация (024 FR-020 «сборка без push»), CI build-only (US-4).
- **A-6**. Материализатор контейнера и дальше потребляет `value.image` as-is; проверка «never a mutable tag» живёт в builders-core (018 FR-011), materializer её не дублирует.
- **A-7**. Reference-проект 024 (контейнер `analytics`) — потребитель опции; оформление самого проекта — зона 024; 027 предоставляет возможность, не правит 024.
- **A-8**. Зависимости готовы: 013 (registry загружает builder по subpath), 018 (docker builder), 025 (values через materialize — контейнер получает `value`).

## 12. Risks

- **Локальный digest ≠ registry digest**: пользователь может ожидать, что no-push артефакт деплоится так же, как push-артефакт. Мит.: D-3 + A-2 явно документируют ограничение; имя опции и non-goal NG-8 закреплены.
- **Phantom-«бесплатный» push**: кто-то оставит `no_push: true` в бою и получит image, которого нет в registry. Мит.: опция явная, default противоположный; документированные последствия (NG-8, A-5); материал для README пакета фиксируется в plan.
- **Ambiguity digest-источника**: использование `RepoDigests` в no-push-ветке (пустой у локального образа) — тихая поломка. Мит.: D-3 требует локальный источник; тест с пустым RepoDigests, но доступным `.Id`.
- **Разъезд type/schema**: аддитивное поле в двух местах (types.ts + builders-core.json). Мит.: type-tests (SC-007) сравнивают; реестровый тест нулевой регрессии.
- **Описание `BLC_IMAGE_DIGEST_UNAVAILABLE`** — расширение описания (не const): риск, что сторона ожидает точный прежний текст message. Проверяется поиском по message в тестах; const остаётся стабильной.

## 13. Тестовая стратегия

- **RED→GREEN по каждому FR-001..FR-008**; docker CLI-оркестрация — характеристические тесты через fake-docker (Constitution II exception, как в 018). Требование к тестам: **hermetic** — в текущей среде (даemon не запущен) ни один тест не обращается к реальному docker (SC-001/SC-002 доказываются журналом argv, без сети).
- **Расширение fake-docker** (`test/helpers/fake-bins.ts`): режим локального digest (`localDigest`), поведение no-push (build exit 0 + локальный digest, без push); существующие режимы/логика не трогаются (0 регрессий).
- **Доказательства «без push»**: журнал argv по каждому no-push-тесту не содержит subcommand `push`; в тестах провалов — и push-строка отсутствует (FR-002, FR-004, FR-005).
- **Инвариант**: табличный тест форм `value.image` (digest-форма, отсутствие `:<tag>`, мягкие/жёсткие варианты тегов); тест на правильно string-`image` (FR-003, US-2).
- **Diagnostics**: тесты кодов `BLC_INVALID_CONFIG` (non-boolean no_push, отсутствующий repository), `BLC_BUILD_FAILED` (CLI недоступен, buildExit≠0 с daemon-диагностикой в stderr), `BLC_IMAGE_DIGEST_UNAVAILABLE` (build ok, digest absent).
- **Compat**: весь существующий `docker.spec.ts` без изменений — регрессионная база (FR-007, SC-005); тип-тесты (test-d) на optional `image.no_push` и заморозку `DockerArtifactValue`.
- **Интеграция (опционально, не unit-CI)**: smoke на реальном daemon — только на машине, где `docker info` успешен; в текущем окружении пропускается осознанно.

## 14. Приемка (acceptance)

US-1..US-5 считаются приемлемыми, когда каждая приведённая When-последовательность даёт описанный результат на конфигурации тестового проекта; метрики SC-001..SC-007 измерены и равны заданным. Все FR-001..FR-008 закрыты тестами RED→GREEN (ковариантно с планом 027). Существующий `packages/builders-core` тест-набор зелёный без правок. Никаких [NEEDS CLARIFICATION].