# Phase 1 Data Model: `@ycforge/pilot/contracts`

Источник: `specs/002-pilot-contracts/spec.md` (FR-001…FR-020 после clarify 2026-09-03). Все сущности — type-level контракты и pure-функции; runtime-поведение только у парсера, форматтера, predicate и `ContractError`.

## Сущности и поля

### Builder / BuildContext / Artifact (FR-001…FR-004)

```ts
interface Builder {
  build(context: BuildContext): Promise<Artifact>;
}

interface BuildContext {
  projectRoot: string;
  sourcePath?: string;          // опционально; отсутствие — валидный вход
  buildConfig: unknown;         // непрозрачная для C конфигурация app-level
  buildEnv: Record<string, string>;
  outputDir: string;
}

interface Artifact<T = unknown> {
  type: string;                 // конвенция <package-scope>:<kind>, см. ArtifactType
  value: T;                     // непрозрачен для C
}
```

Правила: один `build` invocation → ровно один `Artifact` (контракт типа; enforcement зоны C). Никаких C-specific типов в сигнатурах (FR-015).

### ArtifactType (FR-004)

- Конвенция: `<package-scope>:<kind>` — примеры `ycforge:function`, `ycforge:api-gateway`.
- Грамматика (регэксп `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/`): scope — lowercase letter, затем letters/digits/hyphen; kind — то же. Нижнее подчёркивание в scope/kind не допускается (npm-scope-стиль); дефис допускается (`api-gateway`).
- Pure-функции: `isArtifactType(value: string): boolean`, `ARTIFACT_TYPE_PATTERN: RegExp` (frozen).
- Enforcement (error на нарушение) — зона C (specs 014/020); contracts даёт только predicate.

### Materializer / MaterializationContext / OutputBuilder (FR-005…FR-007)

```ts
interface Materializer<A extends Artifact = Artifact> {
  supports(artifact: A, context: MaterializationContext): boolean;   // синхронный отбор
  materialize(artifact: A, context: MaterializationContext): Promise<TerraformResource>;
}

interface MaterializationContext {
  output: OutputBuilder;        // единственное поле (clarify 2026-09-03)
}

interface OutputBuilder {
  declare(name: string, output: { value: string; description?: string }): void;
}
```

Правила: `value` — Terraform expression-строка БЕЗ `${...}`; обёртывание при сериализации — зона C. Повторный `declare` с тем же `name` — error (семантика зафиксирована в документации; реализация проверки — зона C, clarify 2026-09-03).

### Terraform model (FR-008, FR-009)

```ts
interface TerraformResource<T = unknown> {
  readonly kind: 'resource';
  type: string;                 // provider resource type, знает только materializer
  name: string;
  configuration: T;             // provider-specific schema — зона materializer-а
}

interface TerraformMoved   { readonly kind: 'moved';   from: string; to: string }
interface TerraformVariable{ readonly kind: 'variable'; name: string; configuration?: unknown }
interface TerraformData    { readonly kind: 'data';    type: string; name: string; configuration: unknown }
interface TerraformOutput  { readonly kind: 'output';  name: string; value: string; description?: string }

type TerraformBlock =
  | TerraformResource
  | TerraformMoved
  | TerraformVariable
  | TerraformData
  | TerraformOutput;
```

Правила: contracts НЕ моделирует Terraform provider schema (Constitution IV, FR-009). Дискриминант `kind` — решение R-05 research.md (IDEA §23 фиксирует состав блоков, не их поля; поля moved/variable/data/output минимальны и расширяются optional-полями). `TerraformResource` возвращается из `materialize` напрямую, без промежуточного abstraction layer (IDEA §22).

### ResourceReference и парсер (FR-010…FR-013)

```ts
interface ResourceReference {
  ref: string;                  // строго domain.name.property (clarify 2026-09-03)
}

interface ParsedResourceReference {
  domain: string;               // например 'functions'
  name: string;                 // например 'user_service'
  property: string;             // например 'id'
}

parseResourceReference(ref: string): ParsedResourceReference;  // бросает ContractError
formatResourceReference(parsed: ParsedResourceReference): string;
```

Грамматика canonical ref (три непустых сегмента): сегмент = `[a-z][a-z0-9_]*` (lowercase letter, затем letters/digits/underscore; hyphen НЕ допускается — имена ресурсов из IDEA §15: `user_service`, `events`, `frontend`; app ID из apps.yaml snake_case). Разделитель — точка; ровно 3 сегмента; двухсегментная форма `domain.name` отклоняется `ContractError` (clarify 2026-09-03). Парсер не различает managed/external ресурсы (Constitution VI — зона C).

Инварианты:
- round-trip: `formatResourceReference(parseResourceReference(r)) === r` для валидного `r`;
- парсер и форматтер — чистые функции, детерминированные, без I/O;
- невалидный вход → `ContractError` с `code` из фиксированного перечня (см. ниже), никогда `undefined`/null.

Канонические примеры (SC-004): `functions.user_service.id`, `containers.analytics.id`, `queues.events.qurl`, `buckets.frontend.name`.

### Diagnostics (FR-012, FR-016)

```ts
interface Diagnostic {
  code: string;
  message: string;
}

class ContractError extends Error implements Diagnostic {
  readonly code: string;
  // message наследуется от Error; name = 'ContractError'
}
```

Коды ошибок (константы, экспортируются): фиксируются в contracts/public-api.md; стартовый набор — `INVALID_RESOURCE_REFERENCE`. Расширение набора кодов — non-breaking (новые коды не меняют сигнатуры).

### Contract version (FR-017, FR-018)

```ts
const CONTRACT_VERSION = 1;     // = semver major пакета @ycforge/pilot
```

Две независимые линии (clarify 2026-09-03): plugin API (`CONTRACT_VERSION`, бампается только ломкой plugin API) и версия `.ycsf/*.yaml` форматов (`version: 1`, бампается ломкой формата). Любая ломка plugin API → major пакета + migration guide.

## Валидация и связи между сущностями

- `Artifact.type` — единственный ключ диспетчеризации artifact → materializer; парность `supports` обеспечивает детекцию коллизий до `materialize` со стороны C (FR-014; сама диспетчеризация вне contracts).
- `ResourceReference` — сквозная связь: builders (B) формируют, materializer-ы транслируют IDL → IDT; IDR в контрактах не фигурирует (FR-013).
- `TerraformBlock` — допустимый набор генерируемых блоков; `TerraformOutput` (kind 'output') моделирует только генерируемые output-блоки, не путать с `OutputBuilder.declare` (канал декларирования со стороны materializer-а).
- Все сущности readonly-friendly (immutable-стиль интерфейсов); generic-параметры (`Artifact<T>`, `TerraformResource<T>`, `Materializer<A>`) — точки расширения плагинов без изменения контракта.

## Исключённые из модели (явно)

- Project model C (apps/resources YAML-схемы), build graph, сериализация `.tf.json`, обёртывание `${...}`, загрузка плагинов, проверка версий при загрузке — зона C (specs 011–021).
- Двухсегментная logical identity (`domain.name`) — отдельный тип при потребности в specs 009/015/017.
- Форматы `.ycsf/*.yaml` — specs 011+; здесь только носитель `version`.
