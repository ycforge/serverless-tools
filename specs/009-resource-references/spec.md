# Feature Specification: Resource references — IDL/IDT/IDR, `${resources...}` template syntax, ENV-only mode (Project B)

**Feature Branch**: `009-resource-references`

**Created**: 2026-09-05

**Status**: Draft — greenfield; описывает ЧТО и ЗАЧЕМ, а не КАК

**Input**: Roadmap row 009 — «resource-references — IDL/IDT/IDR, `${resources...}` template syntax, ENV-only mode» (§15–19). Источник требований: `IDEA.md` §15 (Resource model), §16 (IDL/IDT/IDR), §17 (`.ycsf/resources.yaml`), §18 (ENV-only mode `.ycsf/env.yaml`), §19 (Interpolation namespaces); принципы: `.specify/memory/constitution.md` (особенно I — границы B, III — версионирование контрактов, V — явное вместо магии, VI — ownership apps/external resources). Зависимости: spec 002 (контрактный тип `ResourceReference` в `@ycforge/pilot/contracts`), шов к spec 008 (authorizer-эмиссия эмитит логические `functions.<name>`).

> B — составной слой API composition. 009 добавляет в B модель logical resource references: чтение и валидацию `.ycsf/resources.yaml` (external resources) и `.ycsf/env.yaml` (ENV-only mode), парсинг/валидацию логического template-синтаксиса `${resources.<domain>.<name>.<property>}` (форма §19, B → Materializer) и эмиссию этого синтаксиса в артефакты композиции вместо «голых» логических ссылок `functions.<name>`. Terraform-сторона (трансляция IDL → `data`-source / `data.yandex_function.*` адресов, IDT) — зона materializers 019/014, НЕ B (Constitution I/IV).
>
> B работает только с logical references (IDL по `ResourceReference`, §16): B НЕ знает Terraform variable naming, `$${...}` escaping и в логическом пути никогда не интересуется реальными IDR (они появляются только после `terraform apply`, Constitution IV). В ENV-only режиме (§18) B может выпустить fully materialized OpenAPI-спецификацию: для выделенных reference-bearing полей артефакта при наличии декларации `env:` B читает `process.env[<VAR>]` В МОМЕНТ КОМПИЛЯЦИИ и записывает фактическое значение (например `d4e123...`) прямо в поле — без Terraform и без `${VAR}`-строк в артефакте.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Автор объявляет external-ресурсы в `resources.yaml`, B валидирует декларацию (Priority: P1)

Разработчик описывает внешние ресурсы проекта — очередь, bucket, legacy-функцию, которые НЕ собираются как приложения (Constitution VI): например `queues.events`, `buckets.frontend`, `functions.legacy_authorizer`. Эти ресурсы живут в `.ycsf/resources.yaml` (`version: 1`). B (в составе композиции) читает файл, валидирует его структуру (version, известные домены, уникальность имён, известные property) и строит индекс logical references, который затем использует для валидации ссылок в композиции. Некорректная декларация — deterministic fail-fast с указанием домена/имени/поля.

**Why this priority**: spine — без загруженного и провалидированного индекса ресурсов B не может ни проверить ссылки, ни разрешить их в ENV-only режиме. Конституционная же модель ownership (VI) требует явного отделения external (`resources.yaml`) от managed (apps), а fail-fast (V) — отвергать битые декларации до использования.

**Independent Test**: фикстура с каноническим `resources.yaml` (все известные домены); фикстуры с каждой ошибкой структуры/коллизии — каждая отклоняется deterministic diagnostic.

**Acceptance Scenarios**:

1. **Given** `.ycsf/resources.yaml` с `version: 1` и записями `queues.events`, `buckets.frontend`, `functions.legacy_authorizer`, **When** B инициализирует индекс ресурсов композиции, **Then** запись читается без ошибок, logical references (`queues.events.qurl`, `buckets.frontend.name`, `functions.legacy_authorizer.id`) доступны/валидны по контрактному парсеру 002; входной YAML не мутирован.
2. **Given** `resources.yaml` с `version: 2`, **When** B его читает, **Then** fail-fast ошибка с отсутствием поддержки версии (детерминированная).
3. **Given** `resources.yaml`, где имя ресурса объявлено в `resources.yaml` дважды (две записи с одинаковым `domain.name`), **When** B читает, **Then** fail-fast ошибка, указывающая дублирующуюся identity (Constitution V — коллизия, не silent merge).
4. **Given** `resources.yaml`, где в family-секции объявлено property вне допустимого набора свойства домена (например `queues.events` с property `name`, тогда как для `queues` валидно только `qurl`), **When** B читает, **Then** fail-fast ошибка с именем ресурса и неприемлемым property.
5. **Given** `resources.yaml` с неизвестным доменом (`databases: {legacy: {}}` вне fixed-набора контракта 009), **When** B читает, **Then** fail-fast ошибка, указывающая неизвестный домен `databases`.

---

### User Story 2 — Композиция ссылается на ресурс; B валидирует ссылку по индексу и проверяет имён (Priority: P1)

В артефакте композиции (например, authorizer `function_id` или будущая integration-цель) появляется логическая ссылка в template-форме `${resources.functions.legacy_authorizer.id}`. B разбирает строку по грамматике §19 (канонический `ResourceReference` 002: `domain.name.property`) и валидирует её против индекса `resources.yaml`: домен/имя/property должны существовать. Неизвестный домен, неизвестное имя или неприемлемое property — deterministic fail-fast. B никогда не пытается выяснить реальный IDR.

**Why this priority**: без валидации ссылок по индексу внешних ресурсов в композицию «утекут» опечатки, которые всплывут только на `terraform plan` (Constitution V — fail-fast, явное вместо магии; B — не Terraform compiler, Constitution I).

**Independent Test**: фикстуры со ссылкой на существующий ресурс (валидна), на несуществующее имя, на неизвестный домен, на неприемлемое property — каждая даёт свой deterministic результат.

**Acceptance Scenarios**:

1. **Given** индекс ресурсов содержит `functions.legacy_authorizer`, **When** B получает ссылку `${resources.functions.legacy_authorizer.id}` в композиции, **Then** ссылка валидна: распарсена по контракту 002 на `{domain: functions, name: legacy_authorizer, property: id}` и найдена в индексе (IDL существует).
2. **Given** тот же индекс, **When** B получает ссылку `${resources.functions.nonexistent.id}`, **Then** fail-fast ошибка, указывающая имя ресурса `nonexistent` (не существует).
3. **Given** тот же индекс, **When** B получает ссылку `${resources.databases.events.id}` с незнакомым доменом `databases`, **Then** fail-fast ошибка, указывающая неизвестный домен.
4. **Given** задекларированный `queues.events` и ссылка на `${resources.queues.events.name}` (свойства `name` у домена `queues` нет — валидно только `qurl`), **When** B получает ссылку, **Then** fail-fast ошибка, указывающая неприемлемое property для данного домена.

---

### User Story 3 — B эмитит logical template-синтаксис в артефакт композиции (шов к 008) (Priority: P1)

Authorizer схемы `function` (шов 007/008) ссылается на функцию. Вместо «голой» логической ссылки `functions.<name>` (008, FR-013) B эмитит template-форму `${resources.functions.<name>.id}` (форма §19), которую материализатор (019) впоследствии транслирует в Terraform-выражение. Изменение артефакта 008 аддитивное (Constitution III): меняется значение поля `function_id` authorizer-конфигурации, семантика «логическая ссылка, не IDR» сохраняется. B не эмитит ссылок на ресурсы, отсутствующие в индексе `resources.yaml`.

**Why this priority**: формальный шов 008→009 — самая агрессивная зависимость (008 уже ✅ и её артефакт контрактно фиксирует `functions.<name>`); перенос на `${resources...}` — обязательный результат 009, без него 019 не сможет материализовать authorizer-ссылку как Terraform-выражение.

**Independent Test**: фикстура композиции с function-схемой и валидным индексом ресурсов; сравниваются артефакты до/после (008 verbatim vs 009 template), проверяется bytes-сдвиг строго в поле `function_id`.

**Acceptance Scenarios**:

1. **Given** композиция со схемой `function` (`functions.internal_authorizer`) и индексом ресурсов, объявляющим `functions.internal_authorizer`, **When** B компилирует, **Then** в `components.securitySchemes.<scheme>.x-yc-apigateway-authorizer.function_id` находится строка `${resources.functions.internal_authorizer.id}` (не `functions.internal_authorizer`).
2. **Given** та же композиция, но `internal_authorizer` НЕ объявлен в `resources.yaml`, **When** B компилирует, **Then** fail-fast ошибка «неизвестный ресурс» с именем функции (шов 008 не эмитит ссылку на несуществующий external-resource).
3. **Given** успешно скомпилированный артефакт с template-ссылкой (логический путь, без `env.yaml`), **When** проверяется содержимое, **Then** в нём НЕТ реальных IDR, Terraform-выражений `$${...}` и любых следов провижининга (Constitution I/IV); только logical template-синтаксис (в ENV-only режиме реальные значения подставляются по US4/FR-009).
4. **Given** компиляция выполняется повторно и с другим порядком участников, **When** сравниваются артефакты, **Then** результат детерминирован (template-ссылки идентичны).

---

### User Story 4 — ENV-only режим: B подставляет реальные значения вместо логических ссылок (Priority: P2)

Разработчик запускает композицию без Terraform. Он кладёт `.ycsf/env.yaml` (`version: 1`), объявляющий для конкретного property внешнего ресурса имя переменной окружения: например, для `functions.legacy_authorizer.id` — `env: LEGACY_AUTHORIZER_ID`. Когда в выделенном reference-bearing поле артефакта (в 009 — только authorizer `function_id`, FR-019) встречается ссылка, чьё property прозадекларировано в `env.yaml`, B читает `process.env[LEGACY_AUTHORIZER_ID]` **в момент компиляции** и записывает ФАКТИЧЕСКОЕ значение (например `function_id: "d4e123..."`) прямо в поле — артефакт становится fully materialized OpenAPI-спецификацией (§18, буквально), без Terraform и без `${VAR}`-строк. Если переменная не установлена/пуста — deterministic fail-fast, называющий переменную и ссылку (Constitution V). Если для ссылки НЕТ декларации `env:` (файла нет или entry отсутствует) — поле сохраняет логический template-синтаксис `${resources...}` (путь module/Terraform, материализуется 019/014). Поле `default:` в `env.yaml` не поддерживается и отвергается fail-fast (explicit-over-magic, Constitution V). При переходе на Terraform сама B-конфигурация не меняется (§18).

**Why this priority**: §18 — вторая половина roadmap-строки и ключевая ценность 009: B может работать standalone (без C/Terraform). P2 по сравнению с базовой валидацией/эмиссией US1–US3, но без неё ENV-only невозможен.

**Independent Test**: фикстура с `env.yaml` и установленной переменной (подстановка реального значения); фикстура с пропущенным/пустым значением ENV (fail-fast); фикстура с `default:` (fail-fast); фикстура без `env.yaml` и с `env.yaml` без entry для ссылки (логический template сохраняется).

**Acceptance Scenarios**:

1. **Given** `env.yaml` объявляет `functions.legacy_authorizer.id: {env: LEGACY_AUTHORIZER_ID}` и `process.env.LEGACY_AUTHORIZER_ID = "d4e123..."`, **When** B компилирует в ENV-only режиме, **Then** authorizer `function_id` в артефакте равен ФАКТИЧЕСКОМУ значению `"d4e123..."` (не `${LEGACY_AUTHORIZER_ID}`, не `${resources...}`) и в артефакте нет ни одной `${VAR}`-строки — спецификация fully materialized.
2. **Given** `env.yaml` не существует в проекте, **When** B компилирует, **Then** артефакт содержит logical template-синтаксис `${resources.functions.legacy_authorizer.id}` (не резолвится; ENV-only — необязательный режим, §18).
3. **Given** `env.yaml` декларирует property ресурса, но переменная окружения не установлена / пуста в момент компиляции, **When** B компилирует в ENV-only режиме, **Then** fail-fast ошибка, указывающая имя переменной и ссылку (не «тихий» пропуск).
4. **Given** `env.yaml` существует, но НЕ содержит entry для property, на которое ссылается reference-bearing поле, **When** B компилирует, **Then** поле сохраняет logical template-синтаксис `${resources.functions.legacy_authorizer.id}` (отсутствие декларации = путь Terraform, не ошибка).
5. **Given** `env.yaml` содержит entry с полем `default:` (например `functions.legacy_authorizer.id: {env: LEGACY_AUTHORIZER_ID, default: d4e...}`), **When** B читает, **Then** fail-fast ошибка — `default:` не поддерживается (значение задаёт только окружение).
6. **Given** один и тот же набор `resources.yaml`+композиция, **When** B переходит с ENV-only на Terraform-путь (убирается `env.yaml`), **Then** B-конфигурация (resources.yaml, композиция) не меняется; меняется только форма ссылки в артефакте (template вместо фактического значения).

---

### Edge Cases

- **Дубликат identity в `resources.yaml`**: `domain.name`, объявленный дважды — error (Constitution V), never silent merge (US1/AC3).
- **Коллизия identity between `apps.yaml` и `resources.yaml`**: одна logical identity не может быть и managed (app), и external (resource) (Constitution VI, §17). B НЕ читает `apps.yaml` (Constitution I, зона C/011); поэтому в 009 проверка «app-vs-resource-коллизия» НЕ выполняется B — она формализована в spec 011 (project model) и исполняется `ycsf check`/C. Это явно документированный seam 009→011 (Assumptions; не «забытая» проверка).
- **Неизвестный домен в `resources.yaml`**: домен вне fixed-набора контракта 009 (`functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}`) — fail-fast (US1/AC4–AC5; РЕШЕНО Q1 2026-09-05).
- **Template-ссылка без `resources`-префикса**: строка вида `functions.user_service.id` БЕЗ `${resources...}` в контексте, где ожидается template-ссылка — валидна как `ResourceReference` (002), но как template-ссылка для резолва — обрабатывается по шову 008: до ретаргета 008 эмитит её verbatim, после — только `${resources...}`. (см. «Точки неоднозначности» №2, №4.)
- **Прочие interpolation-пространства**: `${var.foo}` (API Gateway variables, §19), `${...}` (Terraform), `{{$ENV}}` (build ENV, spec 012) — НЕ являются logical template-ссылками 009 и не обрабатываются/не валидируются B; они проходят или генерируются другими слоями (§19). Неинтерполированная строка, содержащая `{{`, не является ссылкой 009.
- **ENV-only для property, не объявленного в `resources.yaml`**: `env.yaml` ссылается на домен/имя/property, отсутствующий в индексе — fail-fast (симметрия с US2; `env.yaml` не может «придумать» ресурс).
- **`env.yaml` с неиспользуемыми записями** (property задекларирован, но ни одно reference-bearing поле композиции на него не ссылается): не ошибка — декларация безвредна; резолвятся только используемые поля (US4; targeted resolution FR-019).
- **Поле — носитель `default:` в `env.yaml`**: не поддерживается — fail-fast (US4/AC5; FR-020; РЕШЕНО Q2 2026-09-05).
- **Значение ENV — снимок на момент компиляции**: значение, записанное B в артефакт, — снимок `process.env` в момент компиляции; если окружение меняется после компиляции, артефакт не пересчитывается автоматически (US4/AC1; FR-009).
- **`${resources...}` в НЕ-reference-поле артефакта** (например, внутри текста `description`): НЕ резолвится и НЕ валидируется — targeted resolution применяется только к полям из контрактного списка (в 009 — authorizer `function_id`); строка проходит verbatim, универсальное сканирование — с 019 (FR-019; РЕШЕНО Q3 2026-09-05).
- **Пустой `resources.yaml`/`env.yaml`** (нет записей): файл допустим (нет ресурсов — нет ссылок); `version` всё равно обязателен и должен быть 1.
- **Строгая форма ссылки**: path-like элементы (`/`), hyphen в имени ресурса или пробелы — отклоняются контрактным парсером 002 как malformed (`ContractError` `InvalidResourceReference`), т.е. malformed-ссылка — fail-fast с причиной синтаксиса, а не «тихо не найдена».

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE COMPOSER SHALL читать `.ycsf/resources.yaml` (external, `version: 1`) при инициализации композиции и строить индекс external-ресурсов по логическим identity `domain.name`; файл отсутствует — пустой индекс (не ошибка); файл присутствует, но не является валидным YAML-map — fail-fast. (US1/AC1; §17; 011 ownership seam.)
- **FR-002**: THE COMPOSER SHALL fail-fast на `resources.yaml` с `version != 1` (детерминированная диагностика с отсутствием поддержки версии). (US1/AC2; Constitution III.)
- **FR-003**: THE COMPOSER SHALL fail-fast на коллизии identity внутри `resources.yaml`: один `domain.name` объявлен более одного раза — error (никогда не silent merge). (US1/AC3; Constitution V; §17.)
- **FR-004**: THE COMPOSER SHALL валидировать секции `resources.yaml` по фиксированному набору доменов и допустимых property из контракта 009: `functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}` (по §15/§17); неизвестный домен или неприемлемое property — fail-fast с именем ресурса и полем. (US1/AC4–AC5; Constitution V; РЕШЕНО Q1 на clarify 2026-09-05.)
- **FR-005**: THE COMPOSER SHALL разбирать logical template-ссылку `${resources.<domain>.<name>.<property>}` через контрактный канонический `ResourceReference` (002, `parseResourceReference`): `domain.name.property` с lowercase-сегментами `[a-z][a-z0-9_]*`; malformed-строка — fail-fast (`ContractError`). (US2/AC1; §19, §15; 002/FR-010.)
- **FR-006**: THE COMPOSER SHALL валидировать всякую template-ссылку `${resources...}` в композиции против индекса `resources.yaml`: домен/имя/property должны существовать; неизвестный домен, неизвестное имя или неприемлемое property — fail-fast с указанием ссылки. (US2/AC2–AC4; §17; Constitution V.)
- **FR-007**: THE COMPOSER SHALL эмитить в артефакт композиции logical template-синтаксис `${resources.<domain>.<name>.<property>}` для ссылок на external-ресурсы, а НЕ «голые» `domain.name.property` и НЕ реальные IDR; никакого Terraform-выражения `$${...}`, variable naming и провижининга в артефакте быть не должно — за единственным исключением ENV-резолва reference-bearing полей по FR-009/FR-019. (US3; §16, §19; Constitution I/IV.)
- **FR-008**: THE COMPOSER SHALL НЕ эмитить template-ссылку на ресурс, отсутствующий в индексе `resources.yaml`: любая ссылка композиции на undeclared external-ресурс — fail-fast. (US3/AC2; Constitution V.)
- **FR-009**: THE COMPOSER SHALL в ENV-only режиме для reference-bearing поля (список FR-019) с декларацией `env: VAR_NAME` в `.ycsf/env.yaml` читать `process.env[VAR_NAME]` В МОМЕНТ КОМПИЛЯЦИИ и записывать в поле артефакта ФАКТИЧЕСКОЕ значение (например `d4e123...`); никакой `${VAR}`-строка не остаётся — артефакт fully materialized (§18, буквально). (US4/AC1; §18; Constitution V; РЕШЕНО Q2 на clarify 2026-09-05.)
- **FR-010**: THE COMPOSER SHALL сохранять logical template-синтаксис `${resources.<domain>.<name>.<property>}` БЕЗ резолва, когда у reference-bearing поля НЕТ декларации `env:` — файл `.ycsf/env.yaml` отсутствует ИЛИ в нём нет entry для данного property; отсутствие декларации = путь module/Terraform (материализация 019/014), не ошибка. Переход между режимами не меняет B-конфигурацию (resources.yaml/композиция). (US4/AC2, AC4, AC6; §18.)
- **FR-011**: THE COMPOSER SHALL fail-fast в ENV-only режиме, если переменная окружения для декларированного `env:` не установлена или пуста в момент компиляции: диагностика называет имя переменной и ссылку. (US4/AC3; Constitution V.)
- **FR-012**: THE COMPOSER SHALL fail-fast, если `env.yaml` декларирует домен/имя/property, отсутствующие в индексе `resources.yaml` (env.yaml не порождает ресурсы). (Edge cases; §17/§18; Constitution V.)
- **FR-013**: THE COMPOSER SHALL (шов к 008) перенаправлять эмиссию authorizer `function_id` схемы `function` (007/008, FR-013) с «голой» логической ссылки `functions.<name>` на template-форму `${resources.functions.<name>.id}`; изменение аддитивное (контракт 008), семантика «логическая ссылка, не IDR» сохраняется. (US3; §19; Constitution III.) [РЕШЕНО на этапе specify — см. «Точки неоднозначности» №2/№4.]
- **FR-014**: THE COMPOSER SHALL NOT обрабатывать/валидировать прочие interpolation-пространства: `${var.foo}` (API Gateway), Terraform `${...}`, `{{$ENV}}` (build ENV, spec 012) — они не являются ссылками 009 и проходят через B без интерпретации. (Edge cases; §19.)
- **FR-015**: THE COMPOSER SHALL NOT выполнять трансляцию IDL → Terraform (data-source/IDT) и не интересоваться реальными IDR; трансляция — зона materializers 019/014; B работает только с logical references. (US3/AC3; Constitution I/IV; §16.)
- **FR-016**: THE COMPOSER SHALL NOT валидировать коллизию «app-vs-resource» (`apps.yaml` vs `resources.yaml`) — это проверка проекта, зона spec 011/`ycsf check`; B не читает `apps.yaml`. (Edge cases; Constitution I/VI; §17.) [документированный seam 009→011]
- **FR-017**: THE COMPOSER SHALL NOT поддерживать multi-env-профили и NOT различать staging/prod в `.ycsf/*.yaml`; различия окружений — зона Terraform (workspaces/tfvars/variables) и build-интерполяций, единые `.ycsf`-файлы для всех сред. (§18; Assumptions.)
- **FR-018**: THE COMPOSER SHALL гарантировать детерминизм: результат (включая template-ссылки и ENV-резолв при одном и том же окружении) инвариантен к порядку участников и повторам компиляции. (US3/AC4; §13/17.)
- **FR-019**: THE COMPOSER SHALL применять ENV-резолв ТОЛЬКО к явно перечисленным reference-bearing полям артефакта 008; список фиксируется в контракте 009 (в рамках данной спецификации — единственное поле authorizer `function_id` схемы `function`). Строки `${resources...}` в прочих полях артефакта НЕ сканируются и НЕ резолвятся — универсальное сканирование вводится с 019 (integrations). (US4; Constitution V; РЕШЕНО Q3 на clarify 2026-09-05.)
- **FR-020**: THE COMPOSER SHALL fail-fast, если декларация `env.yaml` содержит поле `default:` — не поддерживается; значение задаёт только окружение. (US4/AC5; Constitution V; РЕШЕНО Q2 на clarify 2026-09-05.)

### Key Entities *(include if feature involves data)*

- **External-ресурс (resources.yaml)**: логическая инфраструктура/external-сущность (Constitution VI) с identity `domain.name` и набором свойств (`id`, `qurl`, `name` и т.п.); НЕ buildable-приложение (это `apps`), всегда reference-only.
- **Индекс ресурсов (B)**: прочитанное и провалидированное представление `resources.yaml`; источник валидации ссылок FR-006/FR-008/FR-012.
- **Logical template-ссылка**: строка `${resources.<domain>.<name>.<property>}` (форма §19, B → Materializer); канонический `ResourceReference` 002 внутри; IDL-часть `domain.name` + property.
- **ENV-only декларация (env.yaml)**: связка property ресурса → `env: VAR_NAME` (форма §18); включает ENV-режим резолва: при декларации B читает `process.env[VAR_NAME]` в момент компиляции и записывает фактическое значение; поле `default:` не поддерживается (FR-020).
- **Reference-bearing поле**: поле артефакта композиции, занесённое в контрактный список 009 как носитель логической ссылки на ресурс; в 009 — единственное поле authorizer `function_id`. Только к этим полям применяется ENV-резолв (FR-019); строки `${resources...}` вне списка не трогаются.
- **Артефакт композиции**: скомпилированный OpenAPI-документ (тип по контрактам 002/019); автор этой спецификации — над полем `function_id` authorizer-конфигурации и будущими integration-полями (форма ссылки меняется с `functions.<name>` на `${resources...}`).
- **IDL / IDT / IDR** (модель §16): IDL — logical identity (`functions.legacy_authorizer`), IDT — Terraform address (`yandex_function.legacy_authorizer`, зона materializer), IDR — реальный cloud-ресурс (появляется после `terraform apply`). B оперирует только IDL+property (template-ссылка), IDT/IDR — вне B.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Каждый acceptance scenario US1–US4 покрыт минимум одним выполняемым тестом; test-suite `packages/composer` зелёный (traceability, Constitution II).
- **SC-002**: В 100% canonical фикстур `resources.yaml` (все известные домены, `version: 1`) B строит индекс без ошибок, а входной YAML остаётся byte-идентичным; в 100% битых фикстур (version/коллизия/домен/property) — deterministic fail-fast с указанием конкретного домена/имени/поля, без silent merge.
- **SC-003**: В 100% тестов каждая template-ссылка `${resources...>` распарсена по контракту 002 (round-trip без потерь) и, если она присутствует в композиции, валидирована против индекса; 100% ссылок на неизвестный домен/имя/property и 100% malformed-ссылок отклонены fail-fast.
- **SC-004**: В 100% тестов логического (не-ENV) пути эмитированный автор-артефакт содержит ссылки в форме `${resources.functions.<name>.id}` (а не `functions.<name>` и не реальные IDR); в артефакте нет Terraform-выражений `$${...}`, variable naming и следов провижининга; результат инвариантен к порядку участников.
- **SC-005**: В 100% тестов ENV-only режим корректен: reference-bearing поле с декларацией `env:` при установленной переменной получает ФАКТИЧЕСКОЕ значение (в артефакте нет ни одной `${VAR}`-строки); при неустановленной/пустой переменной — fail-fast с именем переменной и ссылки; поле БЕЗ декларации `env:` (файл отсутствует или entry нет) сохраняет logical template-синтаксис без ошибки; `default:` отвергается fail-fast; резолвятся только поля контрактного списка (вне-списочные `${resources...}` не трогаются); B-конфигурация между режимами не меняется.
- **SC-006**: В 100% тестов коллизия «app-vs-resource» НЕ обрабатывается B (сеam 009→011 задокументирован, поведение не заявлено), а прочие interpolation-пространства (`${var.foo}`, Terraform `${...}`, `{{$ENV}}`) проходят сквозь B без интерпретации и без ошибок.

## Assumptions

- **Владелец**: 009 — пакет `@ycforge/composer` (Project B). Модель логических ссылок, чтение/валидация `resources.yaml`+`env.yaml` и эмиссия template-синтаксиса — зона B; Terraform-сторона (IDL→IDT, `data`-source) — materializers 019/014, вне 009 (Constitution I/IV).
- **Расположение файлов**: `.ycsf/resources.yaml` и `.ycsf/env.yaml` — на корне проекта (плоскость `.ycsf/`, формализуется в spec 011); B получает к ним доступ через переданный project root (аналогично 006/007). Точная передача путей — решение уровня plan.
- **Отсутствие `resources.yaml`**: пустой индекс — не ошибка; B допускает композицию без external-ресурсов (все ссылки, если есть, разрешаются fail-fast как undeclared — Constitution V).
- **Набор доменов (РЕШЕНО Q1 на clarify 2026-09-05)**: фиксированный набор контракта 009 — `functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}` (по §15/§17); registry-driven отклонён; неизвестный домен/неприемлемое property — fail-fast (FR-004, Constitution V). 019 расширяет набор аддитивно при необходимости.
- **ENV-only — необязательный режим**: активен по наличию деклараций `env:` для reference-bearing полей; без декларации (файла нет или entry отсутствует) ссылки остаются logical template-синтаксисом (FR-010). Переход ENV→Terraform не меняет B-конфигурацию (§18).
- **Значение ENV — снимок на момент компиляции**: B читает `process.env` в момент компиляции; записанное в артефакт значение — снимок окружения на этот момент; окружение после компиляции артефакт не пересчитывает (US4/AC1; FR-009; РЕШЕНО Q2 2026-09-05).
- **`default:` не поддерживается**: декларация `env.yaml` с полем `default:` — fail-fast (US4/AC5; FR-020; РЕШЕНО Q2 2026-09-05); значение задаёт только окружение.
- **Reference-bearing поля (РЕШЕНО Q3 на clarify 2026-09-05)**: контракт 009 фиксирует список полей, к которым применяется ENV-резолв; в 009 — только authorizer `function_id` (FR-019); универсальное сканирование `${resources...}` по артефакту — с 019 (integrations).
- **Шов к 008 — ретаргет**: форма authorizer-ссылки в артефакте меняется с `functions.<name>` на `${resources.functions.<name>.id}` (FR-013). Изменение аддитивное по правилам contract versioning (Constitution III): контракт 008 остаётся версии 1, меняется форма значения поля `function_id` внутри стабильной границы authorizer-эмиссии. Полный уход от `functions.<name>` в пользу `${resources...}` — в пределах этой спецификации для authorizer; будущие integration-ссылки (FR-018 008) примут ту же форму при формализации (019).
- **MVП-граница**: валидация/эмиссия logical ссылок на основе `resources.yaml` + template-синтаксиса + ENV-резолв. API Gateway integration-ссылки на ресурсы (HTTP→MQ, static-Object-Storage) и вручную объявленные gateway-маршруты — НЕ входят (08 FR-018; формализуются с 019). `{{$ENV}}` build-интерполяция — spec 012. Terraform `data`-source генерация — materializers 019/014.
- **Прочие interpolation-пространства не трогаются**: B не интерпретирует `${var.foo}` (APIGW, §19), Terraform `${...}` и `{{$ENV}}` (build, 012); они генерируются/проходят другими слоями (FR-014).
- **Без multi-env**: `.ycsf/*.yaml` едины для всех сред; staging/prod — через Terraform-механизмы (§18, FR-017).
- **Парсинг canonical ссылки**: B использует контрактный `parseResourceReference` (002) как единственный парсер `domain.name.property`; грамматика (3 lowercase сегмента, underscore ok, hyphen не ok) — обязанность контракта, не B.
- **Индексация свойств (РЕШЕНО Q1/Q2 на clarify 2026-09-05)**: набор property per домен фиксирован в контракте 009 (`functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}`); B валидирует property по этому набору (US1/AC4, FR-004). Точная YAML-структура `resources.yaml`/`env.yaml` — решение уровня plan (data-model/contract 009).
- **Reference-проект в примерах**: внешняя функция `functions.legacy_authorizer`, очередь `queues.events`, bucket `buckets.frontend` (canonical §17); композиция-участники `user_service`, `analytics`.

## Точки неоднозначности (для clarify)

| # | Зона | Вопрос | Резолюция |
|---|------|--------|-----------|
| 1 | §15 vs §17 | Какой синтаксис ссылки использует B в артефакте: «голый» IDL `functions.user_service.id` (§15/§17) или `${resources...}` template (§19)? | **РЕШЕНО на этапе specify**: template-форма `${resources.functions.user_service.id}` (§19) — артефактная форма B→Materializer; `domain.name.property` (§15/§17) — канонический `ResourceReference` 002, используется внутри (IDL+property), а в артефакт эмитится префикс `${resources...}` для отделения от Terraform/APIGW interpolation-пространств (FR-005/FR-007, §19). «Голый» `functions.<name>` остаётся в 008 как есть ДО 009-ретаргета (US3/AC1, шов). |
| 2 | §19 vs 008 | Меняет ли 009 форму authorizer-ссылки 008 с `functions.<name>` на `${resources.functions.<name>.id}`? | **РЕШЕНО на этапе specify**: ретаргет — да (FR-013). Артефакт 008 переходит на template-форму `${resources.functions.<name>.id}`; изменение аддитивное (внутри стабильной границы authorizer-эмиссии, contract versioning III), семантика «логическая ссылка, не IDR» сохраняется. До-ретаргет-синтаксис задокументирован как переходная форма в Assumptions/Edge cases. |
| 3 | §15 vs §19 | Нужен ли ключевое слово `resources` в ссылке B→Materializer, или достаточно префикса `$`? | **РЕШЕНО на этапе specify**: `${resources...}` целиком (ключевое слово `resources` обязательно) — по §19; это отделяет namespace логических ресурсов B от `${var.foo}` (APIGW) и Terraform `${...}`. B валидирует только грамматику с `resources`-префиксом; бес-префиксный `functions.x.y` — канонический IDL для `ResourceReference`, но не template-ссылка (US2, Edge cases). |
| 4 | §17/§18 vs 011 | Кто валидирует коллизию `apps.yaml` vs `resources.yaml` (одна identity и managed, и external)? | **РЕШЕНО на этапе specify**: НЕ B в 009 (FR-016). B не читает `apps.yaml` (Constitution I); проверка app-vs-resource-коллизии — зона spec 011 (project model)/`ycsf check`, отмечено как явный seam 009→011 в Edge cases/Assumptions. |
| 5 | §18 vs V | Что включает ENV-режим: наличие файла `env.yaml` или декларации для конкретной ссылки? | **РЕШЕНО на этапе clarify (2026-09-05, Q2/Q3)**: ENV-резолв активируется ПЕР-ПОЛЕ — наличием декларации `env:` для reference-bearing поля (файл без entry для ссылки не включает резолв данной ссылки; FR-010/FR-019); триггер детерминирован и наблюдаем по форме артефакта. Один файл на проект (multi-env вне скоупа, FR-017). |
| 6 | §18 | Что происходит, если переменная окружения для декларированного `env:` не установлена/пуста? | **РЕШЕНО на этапе clarify (2026-09-05, Q2)**: fail-fast (FR-011, Constitution V) — B не выпускает materialized артефакт без уверенности в значении; немедленно останавливается, диагностика содержит имя переменной и ссылку (US4/AC3). |
| 7 | §17 vs 019 | Каков авторитетный набор доменов в `resources.yaml` (и «known property» per домен)? | **РЕШЕНО на этапе clarify (2026-09-05, Q1)**: вариант A — фиксированный набор контракта 009 `functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}` (по §15/§17); registry-driven отклонён (ослабил бы fail-fast, Constitution V); 019 расширяет набор аддитивно (FR-004). |
| 8 | §18 | Когда именно B «выпускает fully materialized spec» в ENV-режиме и что остаётся без декларации `env:`? | **РЕШЕНО на этапе clarify (2026-09-05, Q2/Q3)**: трёх-состояние для reference-bearing полей: (1) декларация `env:` есть + переменная установлена → в артефакт записывается ФАКТИЧЕСКОЕ значение, `${VAR}`-строк нет (FR-009); (2) декларация есть + переменная пуста/не установлена → fail-fast (FR-011); (3) декларации НЕТ (файла нет или entry отсутствует) → поле сохраняет logical template-синтаксис `${resources...}`, это не ошибка (FR-010). Резолв применяется только к полям контрактного списка (FR-019). |

## Clarifications

- **Сессия 2026-09-05** (фаза `/speckit-clarify`): три вопроса Q1–Q3 закрыты решениями пользователя. Резолюции зафиксированы в таблице «Точки неоднозначности» (№6–8) и в FR-004/FR-009/FR-010/FR-011/FR-019/FR-020.

  - **Q1** (набор доменов `resources.yaml`): принят **вариант A** — B валидирует FIXED-набор доменов по контракту 009: `functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}` (по §15/§17, property map per домен). Неизвестный домен / неприемлемое property — deterministic fail-fast (FR-004, US1/AC4–AC5). Registry-driven (вариант B) отклонён — перенёс бы детекцию опечаток в 019 и ослабил fail-fast (Constitution V); 019 позже расширяет набор аддитивно.
  - **Q2** (что такое «fully materialized» в ENV-режиме): принят **вариант C1** — когда reference-bearing поле имеет декларацию `env: <VAR>` в `.ycsf/env.yaml`, B ЧИТАЕТ `process.env[<VAR>]` В МОМЕНТ КОМПИЛЯЦИИ и записывает в поле ФАКТИЧЕСКОЕ значение (напр. `function_id: "d4e123..."`). Никакой `${VAR}`-строки в артефакте не остаётся; §18 «fully materialized» — буквально. Переменная не установлена/пуста → fail-fast с именем переменной и ссылки (FR-011). Поле `default:` НЕ поддерживается — fail-fast (FR-020). Если декларации `env:` для ссылки нет (файла нет или entry отсутствует) → поле сохраняет логический template-синтаксис `${resources...}` (путь module/Terraform, материализуется 019/014; FR-010).
  - **Q3** (скоуп ENV-резолва): принят **вариант B (targeted)** — ENV-резолв применяется ТОЛЬКО к явно перечисленным reference-bearing полям артефакта 008; список фиксируется в контракте 009 (в 009 — единственное поле authorizer `function_id`). Универсальное сканирование любых `${resources...}` по артефакту НЕ выполняется: строки вне списка полей проходят verbatim и не трогаются; расширение списка — с 019 (integrations). (FR-019.)

---

*Зависимости и разумные дефолты зафиксированы в Assumptions; решения Q1–Q3 зафиксированы в таблице «Точки неоднозначности» и Clarifications (2026-09-05). Решения уровня plan — контракт/формат `resources.yaml` и `env.yaml` (data-model, contract 009), вход в `packages/composer`.*
