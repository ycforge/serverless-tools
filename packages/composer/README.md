# @ycforge/composer

Project B of the [serverless-tools](https://github.com/ycforge/serverless-tools)
ecosystem: API Gateway / OpenAPI composition. It merges per-app OpenAPI
documents into one gateway document, resolves logical resource references, and
validates the composition contracts — without provisioning anything (Terraform
owns deployment).

## Install

```bash
pnpm add -D @ycforge/composer
```

## Programmatic API

```ts
import { compose, extractOpenApi, resolveReferences } from '@ycforge/composer';

const { document } = await compose({ projectDir, app: 'openapi' });
```

The root entry exports:

- **composition** — `compose`, `mergeDocuments`, `applyOverrides`, `applyAuth`,
  `loadOverrideFile`, `parseOverrideFile` and the `ComposeError` family;
- **OpenAPI extraction** — `extractOpenApi` (metadata-only, isolated runner
  subprocess) and `OpenApiExtractError`;
- **auth config** — `validateAuthConfig`, `validateAuthReferences`
  (`auth.yaml` schemes `none`/`jwt`/`function`);
- **resource references** — `parseResourceReference`,
  `resolveReferences`, `loadResourceIndex`, `loadEnvMapping`
  (`${resources.<domain>.<name>.<property>}` IDL/IDT/IDR, ENV-only mode).

## CLI

The package ships the `ycsf-api` binary:

```bash
ycsf-api compile --project-dir . --app openapi --output openapi.json
ycsf-api check   --project-dir . --app openapi --json
```

- `compile` — write the unified OpenAPI document (`--env-only` skips file reads,
  `--json` emits machine-readable output);
- `check` — validate the composition contracts without Terraform; the exit code
  is the check summary's exit code.

## Pilot builder

`@ycforge/composer/builder` is a `@ycforge/pilot` Builder that emits the
`ycforge:api-gateway` artifact (`{ specPath, resourceReferences }`), writing
`openapi.json` into the app's output directory. It is registered in
`.ycsf/builders.yaml` like any other builder:

```yaml
version: 1
builders:
  openapi: '@ycforge/composer/builder'
```

## Development

```bash
pnpm --filter @ycforge/composer test
pnpm --filter @ycforge/composer build
pnpm --filter @ycforge/composer typecheck
```
