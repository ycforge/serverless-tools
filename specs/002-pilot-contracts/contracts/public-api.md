# Contract: публичный API `@ycforge/pilot/contracts`

Единственный публичный entry point для авторов builders/materializers (FR-020). Всё, не перечисленное здесь, — внутренние модули пакета pilot и не является контрактом.

## Поверхность экспорта (barrel `src/contracts/index.ts`)

Типы: `Builder`, `BuildContext`, `Artifact`, `Materializer`, `MaterializationContext`, `OutputBuilder`, `TerraformResource`, `TerraformMoved`, `TerraformVariable`, `TerraformData`, `TerraformOutput`, `TerraformBlock`, `ResourceReference`, `ParsedResourceReference`, `Diagnostic`.
Классы/значения: `ContractError`, `CONTRACT_VERSION`, `ARTIFACT_TYPE_PATTERN`.
Функции: `isArtifactType`, `parseResourceReference`, `formatResourceReference`.
Константы кодов ошибок: `Diagnostics.InvalidResourceReference` (namespace-объект; расширяем новыми кодами non-breaking).

## Поведенческие контракты

### Парсер canonical reference

- Сигнатура: `parseResourceReference(ref: string): ParsedResourceReference`.
- Грамматика: `segment "." segment "." segment`, где `segment = [a-z][a-z0-9_]*` (ровно три сегмента; lowercase; underscore допустим, hyphen — нет).
- Успех: возвращает `{domain, name, property}`; round-trip `formatResourceReference(parse(r)) === r`.
- Отказ: бросает `ContractError` (`code = Diagnostics.InvalidResourceReference`, `message` на английском, содержит входную строку и причину). Никогда не возвращает `undefined`/null, никогда не режектирует валидный вход.
- Чистая функция: без I/O, детерминированная.

### Predicate формата artifact type

- `isArtifactType(value: string): boolean` — чистая функция; `ARTIFACT_TYPE_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/`.
- `true` для `ycforge:function`, `ycforge:api-gateway`; `false` иначе. Без побочных эффектов, без throws.

### OutputBuilder (канал декларирования)

- `declare(name, { value, description? }): void`; `value` — Terraform expression БЕЗ `${...}`.
- Семантика коллизий имен (документированное ожидание, реализация проверки — зона C): одно имя декларируется ровно один раз; повтор — error.

### ContractError

- `new ContractError(code, message)`; `error instanceof ContractError === true`, `error.name === 'ContractError'`, поля `code`/`message` доступны.
- Коды — строковые константы из namespace `Diagnostics`; потребители сравнивают по константе, не по литералу.

### Версия

- `CONTRACT_VERSION === semver.major(version пакета @ycforge/pilot)` (проверяется тестом, SC-005).
- Совместимость: плагин объявляет peer-диапазон major-версий `@ycforge/pilot`; проверка при загрузке — зона C.

## Границы контракта (что API НЕ даёт)

- Нет импорта и упоминания C internals, YAML-схем, project model (FR-015).
- Нет моделирования Terraform provider schema (FR-009); `configuration` — `unknown`.
- Нет сериализации в `.tf.json`, обёртывания `${...}`, диспетчеризации, загрузки плагинов — зона C.
- Нет runtime-зависимостей: import-граф contracts-модуля содержит только относительные импорты (SC-001, проверяется тестом).

## Пример потребления (канонический)

```ts
import type { Builder, BuildContext, Artifact } from '@ycforge/pilot/contracts';
import { isArtifactType, parseResourceReference, ContractError, Diagnostics } from '@ycforge/pilot/contracts';
```

Type-only импорт достаточен для реализации Builder/Materializer; runtime-импорты нужны только для парсера, predicate, `ContractError`, `CONTRACT_VERSION`.
