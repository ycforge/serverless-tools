# Spec 025: pilot e2e enablement — значения артефактов, artifact-типы в реестре, suspicious-keys в `ycsf check`

| | |
|---|---|
| Spec ID | 025 |
| Название | pilot e2e enablement |
| Feature branch | `025-pilot-e2e-enablement` (от `dev`) |
| Status | 🚧 In progress |
| Created | 2026-09-12 |
| Inputs | roadmap row (Волна 5) + BIG-1..BIG-6 из 024 |
| Dependencies | 013, 014, 016, 020, 021, 022 |
| IDEA.md | §24 (ycsf plan), §26 (auto-outputs), §28 (ycsf check), §36 (Frontend, suspicious keys) |
| Packages | `packages/pilot` (Project C) |
| Owns contract | `@ycforge/pilot/contracts` (additive) |

## 1. Проблема и цель

Три разрыва не позволяют reference-проекту (spec 024) дойти до `terraform plan` на реальных артефактах:

**BIG-1 (значения артефактов не проходят через materialize).** Pipeline `ycsf plan/build` собирает артефакты с `value` (builders-core классы `ycforge:function`, `ycforge:docker-image`, `ycforge:frontend` возвращают `BuiltArtifact { appId, artifact: { type, value } }`), но стадия materialize получает только `type`:
- `pipeline.ts:102` передаёт в `buildOutputs` пустой `materializerOutputs: new Map()` — все auto-outputs реальных materializers молча теряются;
- `runBuildAndMaterialize` (`pipeline.ts:141-164`) не передаёт `buildResult.artifacts` в стадию materialize;
- `ArtifactDescriptor` (`contracts/materialize.ts:22-26`) = `{ id, name, type }` — значения нет;
- `dispatch(projectModel, registry)` (`dispatch.ts:24-27`) создаёт свой `OutputBuilder`, собирает только `duplicateNames`, а объявленные outputs (`declared`) выбрасывает.

Итог: реальные materializers (yandex-function требует `value.archivePath`/`entryPoint`, иначе `YMT_INVALID_ARTIFACT_VALUE`) не могут работать, а `99-ycsf-outputs.tf.json` не получает auto-outputs.

**BIG-2 (реестр builders не принимает artifact-типы).** `KEY_RE = /^[\w-]+$/` (`builders-yaml.ts:15`) отвергает ключи вида `ycforge:function`, тогда как контракт materialize трактует `app.builder` как `artifact.type`, и `ARTIFACT_TYPE_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` уже определяет допустимую форму. Следовательно `<pkg-scope>:<kind>` (например `ycforge:function`) нельзя объявить ни в `builders`, ни в `materializers` секциях builders.yaml.

**BIG-6 (нет проверки секрето-подобных ключей в конфигурациях).** IDEA §36: «`ycsf check` может предупреждать на suspicious keys (`SECRET`, `PASSWORD`, `TOKEN`)». Категории `ycsf check` покрывают грамматику и связи, но не лёгкий отлов неаккуратных секретных ключей в `.ycsf/*.yaml` и `build_config.yaml`. Подробности в US-4.

**Цель.** Reference-проект 024 на реальных builders-core + materializers-core проходит `ycsf plan`: build → материализация с реальными значениями → auto-outputs в `99-ycsf-outputs.tf.json` → Terraform-манифест, который `terraform validate`/`plan` принимает без структурных ошибок (spec 020, 021 сохранены); при этом `ycsf check` ловит секрето-подобные ключи конфигураций.

## 2. Метрика успеха (measurable)

- SC-001. Сквозной пайплайн: на 4-app reference-проекте (user_service, analytics, frontend, openapi) `ycsf plan` запускает build → materialize как единый конвейер; стадия materialize исполняется с built-значениями, а не с заглушкой; `.tf.json` генерируется детерминированно после `git stash`/`git stash pop` (бит-в-бит идентично).
- SC-002. Auto-outputs: 100% outputs, объявленных реальными materializers (например `user_service_function_id`, `user_service_bucket_id`, `openapi_gateway_id`), попадают в `99-ycsf-outputs.tf.json`; на реальном проекте не возникает ошибки `OUT_INVALID_AUTO_PREFIX`.
- SC-003. `terraform validate` на сгенерированных манифестах reference-проекта даёт 0 структурных ошибок на `path.module` (для ресурсов, доступных без облачных кредов); где провайдер недоступен — генерация не падает в pilot и не содержит артефактов `null`/`undefined` в значениях tf.json.
- SC-004. Реестр: builders.yaml с ключами-артефакт-типами (`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`) валидируется и материализуется 1:1 с реальными materializers (yandex-function → `ycforge:function`, yandex-api-gateway → `ycforge:api-gateway`); legacy-файлы с голыми id (`user_service_builder`) продолжают работать без изменений (0 регрессий).
- SC-005. `ycsf check` с секрето-подобным ключом (`api_key`, `db_password`, `access_token`) в `.ycsf/apps.yaml` или `build_config.yaml` выходит с кодом 1 и выдаёт `YCK_SUSPICIOUS_KEY`-диагностики; чистый проект — код 0.
- SC-006. Каждый FR из списка закрыт тестом RED→GREEN; существующие тесты pilot'а остаются зелёными (fixture-семантики сохранены, см. §13).
- SC-007. Контракт аддитивен: добавлены только новые/optional-поля (`ArtifactDescriptor.value`, `DispatchResult.ok.materializerOutputs`, `YCK_SUSPICIOUS_KEY`); ни один существующий тип не изменён (тип-тесты test-d).

## 3. Исследование (проверено по коду на 2026-09-12)

BIG-1..BIG-6 получены из 024; подлинность подтверждена чтением кода (см. ниже). `specs/024-e2e-reference/` ещё не создан (план.md не существует — 024 только запланирован), поэтому все выводы сверены только с исходниками.

- `Artifact` = `{ type, value }` (`contracts/builder.ts:34-37`); `BuiltArtifact { appId, artifact }` (`contracts/build.ts:22-25`). `value` уже есть в контракте — в pilot не пробрасывается.
- `materialize.ts:53` строит `ArtifactDescriptor { id, name, type }` без `value`; `select.ts` подбирает materializer по `supports(type)` (materializers-core решают по типу, значение не смотрят).
- `dispatch.ts:24-27`: создаёт `OutputBuilder`, считывает `duplicateNames`, result ok — без outputs. Весь `declared` теряется.
- `pipeline.ts:102`: `buildOutputs(model, generated, materializerOutputs: new Map(), registry)` — литерал пустой карты. `runBuildAndMaterialize` (`:141-164`) не передаёт значения.
- Real materializers (packages/materializers-core): yandex-function `supports('ycforge:function')`, требует `value.archivePath`/`entryPoint`; yandex-api-gateway `supports('ycforge:api-gateway')`, требует `value.specPath`; при отсутствии — `YMT_INVALID_ARTIFACT_VALUE`.
- builders-core: `ycforge:function` (value `{archivePath, entryPoint}`), `ycforge:docker-image`, `ycforge:frontend`.
- `builders-yaml.ts:15` `KEY_RE = /^[\w-]+$/`; `ARTIFACT_TYPE_PATTERN` в `contracts/artifact-type.ts` ровно `namespace:kind`.
- `outputs/build.ts`: для auto-outputs требует префикс `ycsf_` → `OUT_INVALID_AUTO_PREFIX`; real materializers объявляют без префикса (`user_service_function_id`, `user_service_bucket_id`, `openapi_gateway_id`, …). Противоречие обязательно для устранения — см. D-3 (§8).
- `check/categories/*.ts` — точки расширения для US-4; `pilot/package.json` bin `ycsf`; `@ycforge/builders-core`/`materializers-core` — devDependencies (используются в тестах).
- standalone `ycsf materialize` (`cli/materialize.ts`) не имеет доступа к built values (без кэша 022) — поведение документируется как «descriptor без value» (см. D-2, US-5).

## 4. Non-goals (что НЕ делаем в 025)

| # | Тема | Почему не здесь | Куда |
|---|---|---|---|
| NG-1 | dialect apps.yaml (в т.ч. оформление секции `builder` reference-проекта) | собственный spec-цикл | 026 |
| NG-2 | docker `no_push` у build-артефактов | собственный spec-цикл | 027 |
| NG-3 | правки packages/materializers-core: cwd-зависимость companion-файла api-gateway, `hash` куда архивов; переименование объявляемых `ycsf_*`-имён | C фиксирует контракт передачи значений и приём имён — исправления самих materializers-core лежат в пакете B-слоя (отдельная правка/spec) | coordination note |
| NG-4 | правки packages/composer и packages/builders-core | B-слой; C довольствуется существующими `value` | — |
| NG-5 | чтение built-значений из кэша для standalone `ycsf materialize` | кэш 022 пишется в build-ветке; standalone-материализация из кэша — отдельный сценарий | future |
| NG-6 | изменения форматов `.ycsf/*.yaml` (кроме аддитивного приёма ключей-артефактов в builders.yaml) | 025 не вводит новых форматов | — |
| NG-7 | Terraform provisioning/дрифт-логика, `ycsf apply` | за пределами e2e enablement | — |
| NG-8 | auto-pattern в `build_config.yaml` и прочие фичи 022 вне объёма | 022 уже реализован | — |

## 5. Домен и ключевые сущности

- **ArtifactDescriptor** `{ id, name, type, value? }` — контрактный дескриптор, который materializers получают из materialize-фазы; `value` — opaque (`unknown`), прошивается из built-артефактов.
- **AppIdArtifactMap** — `ReadonlyMap<appId, Artifact>`; результат build сохраняется и пробрасывается в стадию materialize.
- **DispatchOptions.artifacts?** — аддитивное поле входа dispatch; при отсутствии (standalone materialize) поведение идентично текущему.
- **DispatchResult.ok.materializerOutputs** — объявленные outputs (`OutputBuilder.declared`) в порядке объявления; автоматические outputs конвейера извлекаются отсюда, а не из пустой карты.
- **builders.yaml** — секции `builders`/`materializers`: ключ = либо legacy `\w[\w-]*`, либо artifact-type `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*` (concordant `ARTIFACT_TYPE_PATTERN`).
- **suspicious-keys** — категория `ycsf check`: сканирование имён ключей (не значений) в raw-YAML конфигурациях по детерминированному denylist.

## 6. User stories

### US-1 (P1) — Сквозной пайплайн на реальных артефактах

Как разработчик reference-проекта я хочу, чтобы `ycsf plan` довёл build-артефакты с `value` через стадию materialize до генерируемых файлов Terraform, чтобы не вставлять значения вручную.

Когда запущен `ycsf plan` на проекте с builders-core артефактами (function/container/frontend) и реальными materializers-core:
- build завершается артефактами `BuiltArtifact { appId, artifact: { type, value } }`;
- стадия materialize исполняется единым проходом по приложениям с передачей `value` (descriptor `{ id, name, type, value }`), materializers получают реальные значения (`value.archivePath`, `value.entryPoint`, `value.specPath`);
- запускается существующий до-валидационный check и финальный `terraform validate`;
- на выходе — полный набор артефактов `.tf.json` и `99-ycsf-outputs.tf.json` с auto-outputs, пригодный для `terraform plan`.
→ {US-1} AC-наборы: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-009, FR-011.

### US-2 (P1) — Реестр принимает artifact-типы как ключи builders.yaml

Как автор builders.yaml reference-проекта я хочу объявлять маппинг `ycforge:function: ./frontend` и ссылаться из apps.yaml `builder: ycforge:function`, чтобы C отбирал материализатор по `supports(artifact-type)` без обходных псевдонимов.

Когда в builders.yaml в секции `builders` объявлен ключ `ycforge:function`, а apps.yaml задаёт `app.builder: ycforge:function`:
- парсер принимает ключ (additive-расширение грамматики), `validateBuilders` не ругается, registry возвращает запись по ключу;
- materialize-фаза отбирает материализатор `supports('ycforge:function')` (yandex-function) — ровно один кандидат;
- legacy-ключ (например `user_service_builder`) и legacy-конфигурации продолжают работать без изменений;
- коллизия одного и того же ключа в `builders` и `materializers` по-прежнему → `BRG_KEY_COLLISION`.
→ {US-2} AC-наборы: FR-009, FR-010, FR-011.

### US-3 (P2) — Auto-outputs от реальных materializers попадают в сгенерированный terraform

Как пользователь, я хочу чтобы выходы, которые объявляют materializers, попали в `99-ycsf-outputs.tf.json`, чтобы `frontend` мог адресовать функциям результативные идентификаторы.

Когда любое приложение с материализатором, объявляющим output (например `user_service_function_id`):
- `buildOutputs` получает НЕ пустую карту, а реальные объявленные outputs из materialize-фазы;
- auto-output с лексемой, валидной по грамматике `[a-z][a-z0-9_]*` и уникальной в merged-файле, попадает в `99-ycsf-outputs.tf.json` БЕЗ ошибки про обязательный префикс `ycsf_`;
- дубликат имени (в т.ч. с user output) → `OUT_DUPLICATE_NAME`; некорректная грамматика → `OUT_INVALID`; user-ключ с префиксом `ycsf_` → `OUT_RESERVED_PREFIX` (без изменений).
→ {US-3} AC-наборы: FR-006, FR-008.

### US-4 (P2) — `ycsf check` детектит suspicious keys в конфигурациях

Как разработчик, я хочу чтобы `ycsf check` предупреждал (FAIL, как все категории) о секрето-подобных ключах в `.ycsf/*.yaml` и `build_config.yaml`, чтобы подобные имена не попадали в git-конфигурации вместе с потенциально секретными значениями.

Когда в `.ycsf/apps.yaml` есть ключ `api_key`/`db_password`/`access_token` или в `build_config.yaml` app-ключ `DB_TOKEN`:
- категория suspicious-keys находит все такие ключи (collect-all, без остановки на первом);
- по каждому выдается диагностика `YCK_SUSPICIOUS_KEY` с файлом, путём к ключу (через точку/индексы), `key` и машино-читаемым `reason`;
- значений ключей сканер НЕ читает и не отображает (value-free);
- `ycsf check` заканчивается кодом 1 при любой находке; на чистом проекте — категория «зелёная», код 0.
→ {US-4} AC-наборы: FR-012, FR-013, FR-014, FR-015.

### US-5 (P3) — standalone `ycsf materialize` не ухудшается

Как пользователь legacy-фикстур, я хочу сохранить возможность запускать materialize без построенного проекта, чтобы не сломать существующие сценарии (см. §8 fixture-семантики).

Когда `ycsf materialize` запущен без предшествующего build (нет built-артефактов):
- descriptor генерируется без `value` (ровно как сегодня), fixture-материализаторы (не требующие value) работают как раньше;
- реальный материализатор, требующий value, завершается с документированной ошибкой (`YMT_INVALID_ARTIFACT_VALUE` → `MTL_MATERIALIZE_FAILED`), а не TypeError/`unknown`-сюрпризом и не молча;
- при наличии `--target` стадия materialize по-прежнему материализует все приложения проекта (селекция остаётся проектной); значения есть только для приложений с built-артефактом.
→ {US-5} AC-наборы: FR-007.

## 7. Exact claims (FR)

В скобках — привязка к теме.

- FR-001. `ArtifactDescriptor` пополняется опциональным полем `value: unknown` (аддитивно). (BIG-1)
- FR-002. `dispatch` принимает опциональные built-артефакты (`DispatchOptions.artifacts`) и прошивает их значения в descriptors materialize-фазы; приложение без артефакта в карте — descriptor без `value` (прежнее поведение). (BIG-1)
- FR-003. materialize-фаза исполняется по built-артефактам: каждое приложение, для которого в карте есть `Artifact { type, value }`, получает descriptor с `value`; оба шага — отбор materializer'а (`supports`) и исполнение — проходят values. (BIG-1)
- FR-004. `DispatchResult.ok` возвращает `materializerOutputs` — объявленные outputs в порядке объявления (`OutputBuilder.declared`); пустая карта, когда ничего не объявлено. (BIG-1)
- FR-005. Pipeline `runBuildAndMaterialize` передаёт built-артефакты (и их значения) в стадию materialize; `runMaterializeGeneration` принимает `artifacts` и пробрасывает в dispatch и `buildOutputs`. (BIG-1)
- FR-006. `99-ycsf-outputs.tf.json` включает auto-outputs из `materializerOutputs` (не «пустой карты»): изменения содержимого генерации идут от реальных объявлений materializers. (BIG-1)
- FR-007. Поведение без built-артефактов не изменяется: descriptor без `value`, fixture-материализаторы работают, требующий значения материализатор завершается документированной ошибкой через `MTL_MATERIALIZE_FAILED` (без каскада по приложениям). (BIG-1)
- FR-008. Auto-output валидируется по грамматике `[a-z][a-z0-9_]*` и уникальности в merged-файле (`OUT_DUPLICATE_NAME`, `OUT_INVALID`); требование префикса `ycsf_` для auto-outputs снято — `OUT_INVALID_AUTO_PREFIX` объявлен superseded (код сохраняется frozen, правило-легитимная поправка к 016). Reserved-префикс для user outputs (`ycsf_` → `OUT_RESERVED_PREFIX`) — без изменений. (BIG-1)
- FR-009. Парсер builders.yaml принимает в обеих секциях ключи `\w[\w-]*` И `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*`, concordant `ARTIFACT_TYPE_PATTERN`; прочие ключи (заглавные буквы в namespace/kind, отсутствие колонки, пробелы) → `BRG_INVALID`. (BIG-2)
- FR-010. `BRG_KEY_COLLISION` (одинаковый ключ в `builders` и `materializers`) сохраняется неизменным: аддитивность грамматики не отменяет запрет дублирования. (BIG-2)
- FR-011. Registry store из секции `builders` ключуется по полному ключу builders.yaml, включая artifact-типы; `app.builder` буквально является этим ключом; `validateBuilders`, выбор материализатора по `support` и семантика `MTL_UNHANDLED_ARTIFACT`/`MTL_COLLISION` — без концептуальных изменений. (BIG-2)
- FR-012. У `ycsf check` появляется категория suspicious-keys, сканирующая имена ключей (не значения) в присутствующих `.ycsf/apps.yaml`, `.ycsf/builders.yaml`, `.ycsf/outputs.yaml`, `.ycsf/extensions.yaml`, `.ycsf/moved.yaml`, `.ycsf/resources.yaml` и per-app `build_config.yaml`. (BIG-6)
- FR-013. Детекция детерминирована: ключ нормализуется (`lowercase` + удаление не-`[a-z0-9]`) и проверяется по фиксированным set'ам EXACT и SUFFIX (см. §8 D-4); значения ключей не читаются. (BIG-6)
- FR-014. Каждая находка — диагностика `YCK_SUSPICIOUS_KEY` (семья `YCK_*`) с полями `file`, путь ключа, `key` и `reason`; категория собирает ВСЕ находки за один запуск (collect-all без остановки на первом). (BIG-6)
- FR-015. `ycsf check` при наличии любой находки suspicious-keys завершается кодом 1 (как и прочие категории fail-fast); отсутствующие файлы пропускаются; синтаксическая ошибка файла не дублируется этой категорией (делегируется штатным валидаторам). (BIG-6)
- FR-016. Набор кодов `@ycforge/pilot/contracts` пополнен `YCK_SUSPICIOUS_KEY` (additive); `OUT_INVALID_AUTO_PREFIX` снабжён frozen-комментарием «superseded by FR-008»; тип-тесты легитимируют аддитивность (value?, materializerOutputs, новый код). (BIG-1/BIG-6 контракт)

## 8. Edge cases

- **Нет built-артефакта, а materializer требует value** — документированный `MTL_MATERIALIZE_FAILED` (не `TypeError`, не молчание): message говорит о значении и способе (полный build). Покрывается тестом.
- **`--target app` при реальных materializers** — build идёт по таргету, но стадия materialize (как и сегодня) охватывает все приложения проекта; приложения без артефактов в карте получают descriptor без `value` → реальный материализатор на них завершится ошибкой. Это сохраняет интерфейс `--target` и честно требует полного build для real-материализации (см. Assumption A-2).
- **Коллизия artifact-типа в обеих секциях** → `BRG_KEY_COLLISION` (не тихий merge).
- **Uppercase artifact-тип `YC:Function`** → `BRG_INVALID` (не «проходит» и не auto-lowercase).
- **Auto-output, конфликтующий с user output** (`OUT_DUPLICATE_NAME`) — сохраняется fail-fast 016.
- **Авто-имя с заглавными** (`User_Service_Function_Id`) → `OUT_INVALID` по грамматике.
- **Пограничные denylist-ключи** — `token_endpoint` НЕ подсвечивается (suffix `token` обязан быть концом и имя длиннее суффикса), `api_key` (normalized `apikey`) — подсвечивается (exact-set). Примеры закрепляются тестами.
- **YAML-ключ не-строка** (числовой ключ) — игнорируется (сканируются только строковые).
- **`ycsf check` на отсутствующих файлах** — категория молчит, не падает.
- **Пустой `materializerOutputs`** — `{"output": {}}` стабильно (семантика 016 preserved).
- **builders-core не имеет materializer-поддержки типа** — существующая семантика `MTL_UNHANDLED_ARTIFACT` (не новая ошибка).

## 9. Decisions (D)

- **D-1 (значения прошиваются через dispatch-опции, по descriptor).** Стадия materialize не получает значения «напрямую» из build; вместо этого они идут через типизированный контракт: `DispatchOptions.artifacts` → descriptor с `value` → `DispatchResult.materializerOutputs`. Это оставляет standalone-материализацию и тесты fixture-материализаторов неизменными.
- **D-2 (единственный источник auto-outputs).** Auto-outputs пишутся из `DispatchResult.ok.materializerOutputs`; обязательства pipeline (`buildOutputs(..., materializerOutputs, ...)`) выполняются реальными данными, а не литералом `new Map()`. Так убирается «тихий сброс» объявлений.
- **D-3 (поправка к 016: требование префикса `ycsf_` у auto-outputs снято).** Реальные materializers (019) объявляют имена без префикса (`user_service_function_id`, …), и проект 024 обязан их принять. Relaxation строгая: ранее валидные входы остаются валидными, invalid → valid («strict relaxation»); за fail-fast отвечают грамматика + уникальность. `OUT_INVALID_AUTO_PREFIX` сохраняется как константа (frozen + комментарий superseded) — для обратной совместимости ссылок. Reserved-префикс для user outputs не трогаем (защита от коллизий user↔auto частично сохраняется).
- **D-4 (suspicious-keys: deterministic denylist).** EXACT = {token, password, passwd, secret, apikey, accesskey, secretkey, clientsecret, privatekey, authorization, credential, sessionid}; SUFFIX = {token, password, passwd, secret, apikey, accesskey, secretkey, clientsecret, privatekey}. Ключ suspicious, если normalized ∈ EXACT или normalized заканчивается на любой SUFFIX с length > len(suffix). Гранулярность «по имени» осознанна: возможные false positives (например `refresh_token`) — принимаемая плата за fail-fast; набор аддитивно расширяем.
- **D-5 (builders-секция — источник идентичности `app.builder`).** `app.builder` буквально адресует ключ секции `builders` (в т.ч. artifact-тип); materializers хранят свои ключи отдельно (семантика `BRG_KEY_COLLISION`, selection по поддержке типа не меняется).
- **D-6 (проверка выполняется по raw-YAML, value-free).** suspicious-keys сканирует исходные файлы, а не валидированные модели: это даёт полное покрытие всех ключей независимо от того, прошёл ли файл остальные категории, и гарантирует нечитание значений.

## 10. Что CAN'T быть сделано (кваб-категория)

- Не вводится новый формат `.ycsf/*.yaml` (никакой version bump сверх существующего `version: 1`).
- Не меняется семантика существующего контракта `@ycforge/pilot/contracts`: всё новое — additive (`value?`, `artifacts?`, `materializerOutputs`, новый код `YCK_SUSPICIOUS_KEY`); существующие типы не редактируются (тип-тесты test-d это проверяют).
- Не удаляются константы/диагностики, с которыми связаны действующие тесты или доков; `OUT_INVALID_AUTO_PREFIX` — только переосмысление (superseded + frozen comment), удаление недопустимо.
- Не делается auto-переименование/imperative-правка значений или ключей: злоупотребление входом не «чинится» молча (Constitution V).
- Не вводится механизм «предупреждение-но-продолжить» для suspicious-keys: категория FAIL-семейства `ycsf check` и завершение с кодом 1.

## 11. Assumptions

- A-1. `app.builder` — произвольная строка-ключ секции builders; когда она принимает форму artifact-типа, контракт materialize работает как с любым другим ключом. Оформление самого dialect apps.yaml reference-проекта — зона ответственности 026, а не 025.
- A-2. `ycsf plan` reference-проекта выполняется без `--target` (полный build), что гарантирует значения для всех приложений; `--target` с реальными materializers документируется как требующее полного build (см. Edge cases).
- A-3. C-контракт передачи значений фиксируется в 025; materializers-core обязаны читать `value` из root-относительных/абсолютных путей. Текущая cwd-зависимость (companion-файл api-gateway из `resolve(process.cwd(), 'generated')`, хеш путей) — известный дефект пакета materializers-core (019), его починка выполняется в B-слое отдельной правкой (координационный note, вне объёма).
- A-4. suspicious-keys — denylist по имени; детерминирован, может давать осознанные false positives. Список — аддитивная константа (расширение не ломает предыдущие поведения).
- A-5. `ycsf check` НЕ ре-исполняет пересчёт auto-outputs (в check нет dispatch); их корректность гарантируется на этапе build в pipeline (единая точка проверки).
- A-6. В секциях builders.yaml ключи не дублируются (для всех форм — и legacy, и artifact-типа): грамматика не порождает «дубликат, но другой формы».
- A-7. Семантика кэша 022 не меняется manifest'ом: restored blobs дают `Artifact { type, value }` в build-ветке, чего достаточно для проброса значений (standalone-чтение из кэша — вне 025).
- A-8. Дерево директорий приложений в `build_config.yaml` определяется как `<rootDir>/<appId>/build_config.yaml` (загрузчик loaders текущий) — сканер suspicious-keys использует тот же путь.

## 12. Risks

- **Изменение семантики 016 (D-3)** → тест Sc4 quickstart (из spec 016), проверяющий `OUT_INVALID_AUTO_PREFIX`, становится неверен; обновление теста и комментария к константе фиксируется в этом же цикле. Малое число затронутых тестов (verify в plan).
- **Слишком агрессивный denylist** → false positives в легитимных конфигурациях. Мит.: EXACT/SUFFIX нормализацией, примеры позитивных и негативных кейсов фиксируются в тестах категории.
- **`--target` + реальные materializers** → ошибка на non-target приложениях может удивить пользователя; документируется (Edge cases, A-2) и покрывается тестом (фейл не тихий).
- **Аддитивность полей контрактов** — риск разъезда type-тестов; тест-d выступает guard'ом заморозки.
- **Подбор materializers при нескольких зарегистрированных на один тип** — существующая семантика `MTL_COLLISION` (не меняем); реально builders-core/materializers-core отбираются 1:1.

## 13. Тестовая стратегия

- **RED→GREEN по каждому FR** (за исключением thin orchestration, который получает characterization-тесты постфактум — конституция, exception для thin orchestration layers). Тесты сажаются в `packages/pilot/test/` рядом с существующими.
- **Fixture-семантики сохраняются**: quickstart fixture-материализаторы (не требующие value) продолжают работать без изменений — это гарантирует отсутствие регрессий при standalone materialize (US-5).
- **Е2Е-контракт через fake builders/materializers**: тест пайплайна build → materialize → outputs использует тестовые materializers, читающие `value` (аналог структуры реальных, но без cwd-вызовов), плюс 1 интеграционный тест с реальными builders-core/materializers-core (без внешних вызовов — их materializers в тестах уже работают с архивами в памяти).
- **Грамматические проверки** — unit-тесты парсера builders.yaml (legacy + artifact-типы + невалидные формы) и outputs (грамматика/дупликаты/prefix-запрет).
- **suspicious-keys** — табличный тест EXACT/SUFFIX (включая негативные кейсы `token_endpoint`), test над check-вызовом (exit code 1/0), тест на отсутствие файлов и на нестроковые ключи.
- **Задача сопровождения**: test-d проверяет, что `ArtifactDescriptor.value`, `DispatchResult.materializerOutputs` опциональны, а `YCK_SUSPICIOUS_KEY` присутствует в наборе кодов семьи `YCK_*`. Сохранение `OUT_INVALID_AUTO_PREFIX` (frozen) — отдельный тест.

## 14. Приемка (acceptance)

US-1..US-5 считаются приемлемыми, когда каждая приведённая When-последовательность даёт описанный результат на реальной конфигурации принятого тестового проекта; метрики SC-001..SC-007 измерены и равны заданным. Все FR-0xx закрыты тестами RED→GREEN. Никаких [NEEDS CLARIFICATION].