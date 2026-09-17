# Data Model: builders-core

**Spec**: [specs/018-builders-core/spec.md](./spec.md) | **Branch**: `018-builders-core` | **Date**: 2026-09-08

Сущности публичного контракта пакета `@ycforge/builders-core`, схемы `build_config` по builder-ам, каталог артефактных типов, каталог диагностик `BLC_*`, карта subpath exports и форм `package.json`.

---

## 1. Публичная поверхность пакета (subpath exports map)

```text
@ycforge/builders-core
├── .                        → каталог (FR-003) + общие типы (types.ts)
├── /nestjs-function         → default export Builder (FR-001), типы config/value
├── /docker                  → default export Builder (FR-001), типы config/value
└── /vite                    → default export Builder (FR-001), типы config/value
```

`package.json` форма:

```jsonc
{
  "name": "@ycforge/builders-core",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "sideEffects": false,
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./nestjs-function": {
      "types": "./dist/nestjs-function/index.d.ts",
      "import": "./dist/nestjs-function/index.js",
      "require": "./dist/nestjs-function/index.cjs"
    },
    "./docker": { "types": "./dist/docker/index.d.ts", "import": "./dist/docker/index.js", "require": "./dist/docker/index.cjs" },
    "./vite": { "types": "./dist/vite/index.d.ts", "import": "./dist/vite/index.js", "require": "./dist/vite/index.cjs" }
  },
  "scripts": { "build": "tsup", "test": "tsup && vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "esbuild": "^0.27.7" },
  "devDependencies": { "@types/node": "^22.15.0", "tsup": "^8.5.0", "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```

- `publishConfig.access: public` (как у nest-bridge/composer).
- Peer/dev `@ycforge/pilot` **отсутствует**: типы — standalone (research D-RE-4). Руководство для сторонних плагинов (импорт `@ycforge/pilot/contracts`) документируется в quickstart.md, но не является зависимостью пакета.
- `tsup` entry: `{ index, 'nestjs-function/index', 'docker/index', 'vite/index' }`, `format: ['esm','cjs']`, `dts: true`, `clean: true`.

## 2. Структура модулей `packages/builders-core/src`

```text
src/
├── index.ts                  # root: реэкспорт catalog + types (FR-003)
├── types.ts                  # standalone structural: Builder/BuildContext/Artifact + value-shapes + BuildConfig типы
├── catalog.ts                # BUILDER_IDS / ARTIFACT_CATALOG / ArtifactType (FR-003)
├── diagnostics.ts            # BLC_* константы + BuilderError extends Error { code }
├── env.ts                    # residualEnv(value): boolean + scanBuildInput (FR-018/019)
├── config.ts                 # известные-поля валидация (типовая ошибка → BLC_INVALID_CONFIG), ignore-unknown
├── nestjs-function/
│   ├── index.ts              # default export Builder (build(): esbuild → zip → Artifact)
│   ├── config.ts             # NestjsFunctionBuildConfig parse/validate/defaults
│   └── bundle.ts             # esbuild build, external copy, staging, out_filename
├── docker/
│   ├── index.ts              # default export Builder (build(): docker build/push → digest)
│   ├── config.ts             # DockerBuildConfig parse/validate/defaults
│   └── cli.ts                # spawn docker build/push, digest parse + inspect fallback
├── vite/
│   ├── index.ts              # default export Builder (build(): spawn command → copy dist)
│   ├── config.ts             # ViteBuildConfig parse/validate/defaults
│   └── run.ts                # spawn command (shell), env overlay, static output copy
└── zip/
    ├── writer.ts             # dependency-free deterministic zip (node:zlib)
    └── collect.ts            # рекурсивный сбор staging-каталога в записи zip (CRC-32, deflate)
```

Исполняемый пакет — только пункты 1–4 (public API); внутренние модули (5–10) — приватные.

## 3. Standalone structural types (src/types.ts) — контракт spec 002, без импортов pilot

```ts
export interface BuildContext {
  readonly projectRoot: string;
  readonly sourcePath?: string;
  readonly buildConfig: unknown;
  readonly buildEnv: Record<string, string>;
  readonly outputDir: string;
}

export interface Artifact<T = unknown> {
  readonly type: string;
  readonly value: T;
}

export interface Builder {
  build(context: BuildContext): Promise<Artifact>;
}
```

Структурно совместимы с `@ycforge/pilot/contracts` (builder.ts). Conformance проверяется compile-time тестом в pilot (`test/types/builders-core-contract.test-d.ts`): `PilotBuildContext` assignable-to `BCBuildContext`, `BCArtifact` assignable-to `PilotArtifact` и обратно (исходные shape — биекция).

**Value-shapes артефактов** (forward contract для 019, IDEA §8):

```ts
export interface FunctionArtifactValue {
  readonly archivePath: string; // abs путь к .zip в outputDir
  readonly entryPoint: string;  // "<basename>.handler", непустая строка
}
export interface DockerArtifactValue {
  readonly image: string;       // digest-form "<repository>@sha256:<hex64>" — immutable
}
export interface FrontendArtifactValue {
  readonly directory: string;   // abs путь к static-выводу внутри outputDir
}
```

## 4. Схемы `build_config` (app-level, versionless — spec 011)

Вход — уже интерполированная структура (spec 012); builder валидирует **известные** поля, unknown top-level ключи игнорируются (коэкзистенция с B-shared полями, напр. `openapi_entry`). Некорректный тип известного поля → `BLC_INVALID_CONFIG`.

### 4.1 NestjsFunctionBuildConfig (nestjs-function)

| Поле | Тип | Default | Валидация |
|------|-----|---------|-----------|
| `entry` | `string` | `"src/main.ts"` | относительный к `sourcePath`; файл обязан существовать → иначе `BLC_ENTRY_NOT_FOUND` |
| `runtime` | `string` | `"nodejs20"` | маппинг `nodejs20→node20` (default), `nodejs22→node22`; неизвестное значение → `BLC_INVALID_CONFIG` |
| `external` | `string[]` | `[]` | массив строк; не-массив → `BLC_INVALID_CONFIG` |
| `out_filename` | `string` | `"function.zip"` | непустая строка без path-разделителей; иначе `BLC_INVALID_CONFIG` |

```ts
export interface NestjsFunctionBuildConfig {
  readonly entry?: string;
  readonly runtime?: string;
  readonly external?: readonly string[];
  readonly out_filename?: string;
}
```

Пример (канонический `user_service`):
```yaml
build_config:
  entry: src/main.ts
  runtime: nodejs20
  external: []
  out_filename: function.zip
```

### 4.2 DockerBuildConfig (docker)

| Поле | Тип | Default | Валидация |
|------|-----|---------|-----------|
| `image.repository` | `string` | — **(обязателен)** | непустая строка; отсутствие → `BLC_INVALID_CONFIG` |
| `image.tag` | `string` | `"latest"` (только промежуточный push-тег) | без пробелов, не начинается с `-` → иначе `BLC_INVALID_CONFIG` (арг-безопасность) |
| `dockerfile` | `string` | `"Dockerfile"` | относительный к `sourcePath`; отсутствие файла → `BLC_BUILD_FAILED` на `docker build` (или конфиг-ошибка, см. тест) |

```ts
export interface DockerBuildConfig {
  readonly image?: { readonly repository?: string; readonly tag?: string };
  readonly dockerfile?: string;
}
```

Пример (канонический `analytics`, после интерполяции — значения literal, spec 012):
```yaml
build_config:
  image:
    repository: "cr.yandex/ya_mob_ya_lublu_yandex"
    tag: "v1.2.3"
  dockerfile: "Dockerfile"
```

**Credentials не являются частью конфига** (FR-012); builder не содержит кода аутентификации.

### 4.3 ViteBuildConfig (vite)

| Поле | Тип | Default | Валидация |
|------|-----|---------|-----------|
| `out_dir` | `string` | `"dist"` | относительный к `viteRoot`; не-строка → `BLC_INVALID_CONFIG` |
| `root` | `string` | `"."` | относительный к `sourcePath`; `viteRoot = resolve(sourcePath, root)` |
| `command` | `string` | `"vite build"` | произвольная строка команды (shell); пустая/не-строка → `BLC_INVALID_CONFIG` |

```ts
export interface ViteBuildConfig {
  readonly out_dir?: string;
  readonly root?: string;
  readonly command?: string;
}
```

Пример (канонический `frontend`):
```yaml
build_config:
  out_dir: dist
  root: "."
  command: "vite build"

build_env:
  YANDEX_ID_APP_ID: "{{$YANDEX_ID_APP_ID}}"
```

## 5. Каталог артефактных типов (FR-003, D-2)

```ts
export const BUILDER_IDS = ['nestjs-function', 'docker', 'vite'] as const;
export type BuilderId = (typeof BUILDER_IDS)[number];

export const ARTIFACT_CATALOG = {
  'nestjs-function': { artifactType: 'ycforge:function' },
  docker: { artifactType: 'ycforge:docker-image' },
  vite: { artifactType: 'ycforge:frontend' },
} as const;
export type ArtifactType = (typeof ARTIFACT_CATALOG)[BuilderId]['artifactType'];
```

| Builder id (`builders.yaml`) | `Artifact.type` | `Artifact.value` | Будущий materializer (019) |
|------------------------------|-----------------|------------------|----------------------------|
| `nestjs-function` | `ycforge:function` | `{ archivePath, entryPoint }` | `yandex_function` |
| `docker` | `ycforge:docker-image` | `{ image }` — `…@sha256:…` | `yandex_serverless_container` |
| `vite` | `ycforge:frontend` | `{ directory }` | `yandex_storage_object` (bucket) |

Все три строки валидны по предикату pilot `isArtifactType` (research D-RE-2).

## 6. Каталог диагностик `BLC_*` (machine-readable; сравниваются через константы, не литералы — Constitution V)

Общая форма (согласована с `ProjectModelDiagnostic` spec 011 в части app/field/variable применительно к builder-контексту):

```ts
export interface BuilderDiagnostic {
  readonly code: string;   // BLC_*
  readonly message: string;
}
export class BuilderError extends Error implements BuilderDiagnostic {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'BuilderError'; this.code = code; }
}
```

| Code | Message-шаблон | Module origin | Триггер (FR) |
|------|----------------|---------------|--------------|
| `BLC_INVALID_CONFIG` | `build_config: <поле> has invalid value` | `src/config.ts`, per-builder `config.ts` | Неверный тип/значение известного поля; отсутствие `image.repository`; невалидный `tag`; unsupported `runtime` (FR-004/009/014) |
| `BLC_MISSING_SOURCE` | `<builder>: sourcePath is required` | общий prepare контекста | `sourcePath` отсутствует (spec Edge Cases) |
| `BLC_ENTRY_NOT_FOUND` | `entry file not found: <entry>` | `src/nestjs-function/bundle.ts` | Отсутствует entry-файл (FR-007, US1-AC4) |
| `BLC_BUILD_FAILED` | `build failed: <stderr-хвост / причина>` | все три builder-а | esbuild-ошибка; docker build/push ненулевой exit / CLI недоступен; vite-команда не выполнилась; отсутствует вывод (FR-007/013/017) |
| `BLC_ENV_NOT_RESOLVED` | `residual {{$...}} in buildConfig/buildEnv; D-3 violation` | `src/env.ts` | Остаточный `{{$` в buildConfig/buildEnv (FR-019, US5) |
| `BLC_IMAGE_DIGEST_UNAVAILABLE` | `digest not resolved after push: <repository>:<tag>` | `src/docker/cli.ts` | Push успешен, digest не получен из push/inspect (FR-011, US2-AC2) |
| `BLC_ARCHIVE_FAILED` | `zip write failed: <причина>` | `src/zip/writer.ts` | Ошибка записи/сборки zip (US1/US6 ref) |

Идеал: каталог в JSON (`packages/builders-core/src/contracts/builders-core.json`-эквивалент или дублирующий файл в пакете), источник истины — `contracts/builders-core.json` в spec-доках (см. ниже); константы в `src/diagnostics.ts` сравниваются через них.

## 7. Инварианты исполнения (state transitions builder-а)

Состояние инвокации `build(context) → Artifact`:

```text
validate buildConfig (BLC_INVALID_CONFIG)
  → распознать sourcePath: {sourcePath | projectRoot} (пусто → BLC_MISSING_SOURCE)
  → env-скан buildConfig+buildEnv ({{$ → BLC_ENV_NOT_RESOLVED})
  → builder-specific pipeline:
      nestjs-function: bundle → staging → (external copy) → zip → outputDir
      docker:          docker build → docker push → digest
      vite:            spawn command → copy out_dir → outputDir
  → Artifact | BuilderError (BLC_*)
```

- outputDir создаётся рекурсивно перед записью; существующий артефакт перезаписывается (детерминизм, кэш — spec 022 C-side).
- Частичный артефакт никогда не возвращается: ошибка на любой фазе → `BuilderError`, возврата `Artifact` нет.
- Один вызов = один `Artifact` (spec 002 FR-001); builder-ы stateless между инвокациями.
- `sourcePath` при отсутствии → `BLC_MISSING_SOURCE` (нет вывода/context/push без источника).

## 8. Пилот-изменения (test infra, US4)

- `packages/pilot/package.json`: `devDependencies += { "@ycforge/builders-core": "workspace:*" }`; `scripts += { "pretest": "pnpm --filter @ycforge/builders-core build" }`.
- Новые тест-файлы pilot: `test/builders-core/registry-loading.spec.ts` (US4), `test/types/builders-core-contract.test-d.ts` (conformance структурной совместимости).
- Никаких изменений production-кода pilot; контракты `@ycforge/pilot/contracts` не меняются (каталог 018 — часть builders-core, не pilot).