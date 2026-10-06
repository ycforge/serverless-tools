# @ycforge/serverless-dev-tools

Local development server for Yandex Cloud Functions. It emulates the API
Gateway v2 HTTP transport around a NestJS application module built with
[`@ycforge/nestjs-connector`](https://www.npmjs.com/package/@ycforge/nestjs-connector),
so the same app can be exercised locally before deploying.

## Install

```bash
pnpm add -D @ycforge/serverless-dev-tools
```

## Usage

```ts
import { createYcsfLocalServer } from '@ycforge/serverless-dev-tools/server';

const server = await createYcsfLocalServer({
  entry: 'src/main.ts', // path to the root NestJS application module
  port: 3000,
});

console.log(server.baseUrl); // http://127.0.0.1:3000
// ... run requests ...
await server.stop();
```

`createYcsfLocalServer` loads the entry module, boots the connector handler once
and reuses the warm Nest application across requests, exactly as the runtime
does. Each request is turned into an API Gateway v2 event and the returned
`YandexFunctionHttpResponse` is written back to the HTTP response.

## Options

| Option | Default | Description |
|:---|:---|:---|
| `entry` | — | Path to the root NestJS application module (required). |
| `port` | `3000` | Port bound on `127.0.0.1` (integer in `[0, 65535]`). |
| `apiGatewayV2` | `true` | Enable the API Gateway v2 HTTP transport. |
| `messageQueue` | `false` | Not supported in v1 — enabling it fails fast (`JDT_MQ_UNSUPPORTED`). |
| `yandexContext` | `{}` | Overrides merged into the synthesized runtime context. |

## IAM token

The server resolves an IAM token for the synthesized invocation context (via the
`yc` CLI / metadata service) unless `yandexContext.token` is supplied. When no
token is available it logs `JDT_IAM_UNAVAILABLE: <reason>` and keeps running
without one — never a hard failure.

## Diagnostics

`JDT_*` codes are exported from the subpath (`JDT_CODES`,
`JdtDiagnosticCode`), together with `LocalDevServerError`. Failures (invalid
port, entry resolution, port already in use) are fail-fast and redact request
secrets (`Authorization`/`Cookie`, IAM token) from logs and error responses.

## Development

```bash
pnpm --filter @ycforge/serverless-dev-tools test
pnpm --filter @ycforge/serverless-dev-tools build
pnpm --filter @ycforge/serverless-dev-tools typecheck
```
