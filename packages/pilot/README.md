# @ycforge/pilot

Build/Deployment Orchestrator (Project C) для экосистемы serverless-tools.

Плагин-контракты (Builder, Materializer, Artifact, Terraform model,
ResourceReference, diagnostics, versioning) — часть публичного API этого
пакета и экспортируются через subpath export:

```ts
import type { Builder, BuildContext, Artifact } from '@ycforge/pilot/contracts';
```

Отдельного SDK-пакета нет. Контракты не требуют знания внутренностей C
(Constitution I) и не имеют runtime-зависимостей (FR-019).

## Contract versioning

Действуют **две независимые линии** версионирования (уточнение 2026-09-03,
IDEA.md §43):

1. **Plugin API** (`@ycforge/pilot/contracts`): любой breaking change
   (Builder/Materializer API, Artifact, diagnostics) — это major-версия
   пакета + `MIGRATION.md` в корне пакета, без исключений. Текущая версия
   экспортируется как `CONTRACT_VERSION` и равна semver major пакета
   (проверяется тестом).
2. **Форматы `.ycsf/*.yaml`**: обязательное поле `version: 1` на верхнем
   уровне каждого файла. Breaking change формата поднимает только это поле
   и НЕ требует major-бампа plugin API.

Плагин объявляет peer-зависимость на диапазон major-версий `@ycforge/pilot`;
несовместимость отклоняется C при загрузке плагина, до запуска builders.

## Разработка

```bash
pnpm install
pnpm --filter @ycforge/pilot test     # unit + type tests (vitest typecheck)
pnpm --filter @ycforge/pilot build    # ESM + CJS + d.ts (tsup)
pnpm --filter @ycforge-example/contracts-plugin test  # gate SC-003
```
