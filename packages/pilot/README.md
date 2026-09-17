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

## Artifact store (spec 028)

`ycsf build` writes one store descriptor per app to
`.ycsf/artifacts/<appId>/artifact.json` (`{ "version": 1, "type": "<package-scope>:<kind>", "value": ... }`,
canonical `JSON.stringify`). Standalone `ycsf materialize` reads the store (or an
explicit `--artifacts <dir>` root) instead of requiring an in-process build first;
`.ycsf/artifacts/` is git-ignored and is not part of the build fingerprint (spec 022).

## App identities (spec 028)

Map-form app definitions whose builder key follows the artifact-type convention
(`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`,
`ycforge:api-gateway`) derive a resource identity from `@ycforge/pilot/contracts`
(`ARTIFACT_TYPE_DOMAIN_MAP` → `functions|containers|buckets|gateways`). These
identities are handed to Project B composers via `BuildContext.appIdentities`, so
`${resources.<domain>.<app_id>.<property>}` references resolve **without** entries
in `.ycsf/resources.yaml`; an app colliding with an explicit resource is a
validation error, never a silent merge.

## Разработка

```bash
pnpm install
pnpm --filter @ycforge/pilot test     # unit + type tests (vitest typecheck)
pnpm --filter @ycforge/pilot build    # ESM + CJS + d.ts (tsup)
pnpm --filter @ycforge-example/contracts-plugin test  # gate SC-003
```
