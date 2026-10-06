# @ycforge/materializers-core

Core Terraform materializer plugins for the
[serverless-tools](https://github.com/ycforge/serverless-tools) ecosystem
(spec 019). Each materializer maps one artifact type produced by a builder to
the Terraform resources that provision it, and is loaded by
`@ycforge/pilot`'s materializer dispatch.

## Install

```bash
pnpm add -D @ycforge/materializers-core
```

## Catalog

| Materializer id | Subpath export | Artifact type |
|:---|:---|:---|
| `yandex-function` | `@ycforge/materializers-core/yandex-function` | `ycforge:function` |
| `yandex-serverless-container` | `@ycforge/materializers-core/yandex-serverless-container` | `ycforge:docker-image` |
| `yandex-api-gateway` | `@ycforge/materializers-core/yandex-api-gateway` | `ycforge:api-gateway` |
| `yandex-message-queue` | `@ycforge/materializers-core/yandex-message-queue` | `ycforge:queue` |
| `yandex-storage-bucket` | `@ycforge/materializers-core/yandex-storage-bucket` | `ycforge:frontend` |

The root entry exports the catalog (`ARTIFACT_CATALOG`, `ARTIFACT_TYPES`,
`MATERIALIZER_IDS`) and the shared standalone types; the individual
materializers are only reachable through their subpath exports.

Every subpath module default-exports a spec-002 `Materializer` shape:

```ts
import type { Materializer } from '@ycforge/pilot/contracts';
import yandexFunction from '@ycforge/materializers-core/yandex-function';

// { supports(artifactType): boolean, materialize(...): TerraformResource[] }
```

## Registration

Materializers are wired to apps through `.ycsf/materializers.yaml` (spec 013/014
explicit mapping), the same convention as `.ycsf/builders.yaml`:

```yaml
version: 1
materializers:
  yandex-function: '@ycforge/materializers-core/yandex-function'
  yandex-serverless-container: '@ycforge/materializers-core/yandex-serverless-container'
  yandex-api-gateway: '@ycforge/materializers-core/yandex-api-gateway'
  yandex-message-queue: '@ycforge/materializers-core/yandex-message-queue'
  yandex-storage-bucket: '@ycforge/materializers-core/yandex-storage-bucket'
```

`ycsf materialize` selects a materializer by the artifact's `type`, so the
mapping and the catalog above must agree. An unhandled artifact type is a
fail-fast dispatch error, never a silent skip.

## Diagnostics

`YMT_*` diagnostic codes are exported from the root entry (`YMT_EMPTY_DIRECTORY`,
`YMT_INVALID_ARTIFACT_VALUE`, `YMT_INVALID_QUEUE_URL`, plus `materializerError`).

## Development

```bash
pnpm --filter @ycforge/materializers-core test
pnpm --filter @ycforge/materializers-core build
pnpm --filter @ycforge/materializers-core typecheck
```
