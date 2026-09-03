# @ycforge/nestjs-connector

NestJS adapter for [Yandex Cloud Functions](https://yandex.cloud/en/services/functions).
It lets a NestJS application run inside a Yandex Cloud Function behind two transports:

- **HTTP / API Gateway** — Yandex API Gateway payload format `2.0`, synchronous
  request/response semantics, normal NestJS controllers.
- **Message Queue** — Yandex Cloud Functions Message Queue trigger, asynchronous
  invocation semantics, message handlers built from NestJS abstractions.

The package is intentionally a thin runtime/transport adapter: it must not turn
NestJS into a Yandex-specific application framework. Business logic stays
independent of Yandex Cloud whenever practical.

> **Status: runtime bootstrap, execution context, the full HTTP transport and
> the Message Queue transport have landed.** The package architecture and
> public contracts are established (see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
> and [`src/index.ts`](./src/index.ts)); the central function factory shipped
> with issue #3, the normalized execution context with `@YandexContext()`
> injection with issue #4, the Yandex API Gateway v2 HTTP request adapter
> (detection, validation, normalization) with issue #5, HTTP response/error
> mapping plus controller dispatch with issue #6, the Message Queue event
> adapter (detection, validation, batch normalization) with issue #7, queue
> handler dispatch with `@QueueHandler()`/`@QueueMessage()` injection
> with issue #8, typed queue body payloads with issue #9, and unified
> invocation failure semantics with issue #10. A replayable conformance suite
> built from sanitized fixtures reconstructed from captured Yandex invocations
> (HTTP and Message Queue) guards the observed runtime contract end to end
> (issue #11, [fixtures/](./fixtures)). Observed Yandex Cloud runtime
> constraints that all connector code must respect are catalogued in
> [AGENTS.md](./AGENTS.md).

## Usage

```ts
import { createYandexHandler } from "@ycforge/nestjs-connector";
import { AppModule } from "./app.module";

// Bootstraps Nest lazily on the first invocation, then reuses the cached
// application for every warm invocation.
const handler = createYandexHandler(AppModule);

export default { handler };
```

### Subpath exports

Besides the root entry point, the package exposes focused subpaths
(`@ycforge/nestjs-connector@0.1.0`):

```ts
import { RequireAuth, GlobalAuthGuard } from "@ycforge/nestjs-connector/auth";
import { QueueHandler, QueueMessage } from "@ycforge/nestjs-connector/queue";
import { YandexContext } from "@ycforge/nestjs-connector/context";
```

The root barrel keeps exporting the full public API, so existing imports
continue to work unchanged.

### Authentication contract (`@RequireAuth`)

`@RequireAuth(scheme, guard)` declares the authentication contract of an HTTP
route — on a controller or a single method:

```ts
import { RequireAuth } from "@ycforge/nestjs-connector/auth";

@Controller("users")
@RequireAuth("user", UserAuthGuard)
export class UsersController {
  @Get("health")
  @RequireAuth("public", null) // explicitly public: no guard runs
  health() {}

  @Get("me")
  @RequireAuth("admin", AdminGuard) // method metadata wins over controller
  me() {}
}
```

- The decorator records `ycsf:auth:scheme` / `ycsf:auth:guard` metadata and,
  for any scheme other than `"public"`, applies `ApiSecurity(scheme)` so the
  generated OpenAPI document carries the security requirement.
- `createYandexHandler` automatically registers a global guard that reads
  this metadata with **method > controller** precedence and delegates the
  decision to the declared guard, resolved through Nest DI (the guard's own
  dependencies are injected; a guard missing from the container fails the
  request loudly instead of silently passing).
- `guard === null` means explicitly public: enforcement is skipped. A
  non-public scheme with `guard === null` is allowed — enforcement then
  happens at the API Gateway; scheme and guard are independent by design.
- Routes without any metadata fall back to the bootstrap default:

```ts
const handler = createYandexHandler(AppModule, {
  defaultAuthGuard: DefaultAuthGuard, // or null / omitted: no default check
});
```

The default applies only when neither the method nor the controller carries
auth metadata; a guard is never derived from a scheme name.

`@RequireAuth` is HTTP-only: it has no effect on `@QueueHandler()` methods
(Message Queue delivery never passes through the HTTP guard pipeline).

### Normalized execution context

Handlers can access runtime metadata through `@YandexContext()` parameter
injection instead of touching raw Yandex objects:

```ts
import { YandexContext } from "@ycforge/nestjs-connector";
import type { YandexExecutionContext } from "@ycforge/nestjs-connector";

@Injectable()
export class OrdersService {
  handle(@YandexContext() executionContext: YandexExecutionContext) {
    // Stable per-invocation correlation id (identical for HTTP and MQ).
    executionContext.awsRequestId;
    // Trace metadata preserved verbatim.
    executionContext.uberTraceId;
    // Escape hatches: untouched raw event/context.
    executionContext.rawEvent;
    executionContext.raw;
  }
}
```

The context is scoped to a single invocation and never shared between them.
Its IAM token (`executionContext.token`) is a secret: automatic serialization
(`JSON.stringify`) redacts it to `REDACTED_TOKEN` and excludes the raw
payloads, so accidental logging cannot leak credentials.

The built-in registry currently ships with the HTTP / API Gateway v2 transport
(#5, #6): `version: "2.0"` events are detected, structurally validated,
normalized (canonical `rawPath`/`rawQueryString`, both query-parameter views,
`isBase64Encoded`-driven body decoding) and published to the invocation scope.
Controllers then dispatch through the warm Nest application: guards,
interceptors, pipes, filters, `@Res()` escape hatches and standard
`HttpException` mapping behave as on any other platform — the connector's
adapter only records what Nest registers and replays it per invocation, it
does not reimplement framework semantics. Responses serialize back to the
Yandex Function envelope: explicit handler-set content types always win
(implicit defaults are `application/json`, `text/plain; charset=utf-8`,
`application/octet-stream`), `Buffer` bodies become Base64
(`isBase64Encoded: true`) so binary data is never corrupted, and repeated
header values (e.g. multiple `Set-Cookie`) surface under the optional
`multiValueHeaders` field. That field is **live-verified** against the API
Gateway payload-format-2.0 response path: the gateway accepts it, joins
repeated ordinary headers with commas on the wire, and emits repeated
`Set-Cookie` values as separate header lines (see `src/http/response.ts`).
Message Queue deliveries are detected by the built-in registry as well
(#7): events carrying the observed `messages[]` trigger shape are
structurally validated, normalized into a batch of typed message envelopes
(event metadata, queue id, message identity, verbatim system and user
attributes, checksums, opaque raw body, untouched raw references) and
published to the invocation scope. Queue handlers are plain NestJS providers
or controllers whose methods carry `@QueueHandler()` (#8): every discovered
handler receives every delivered message, sequentially in delivery order,
with `@QueueMessage()` injecting the current message and `@YandexContext()`
the invocation context. Handler instances resolve once per message under a
DI sub-tree created for that message: `DEFAULT` providers stay singletons,
`REQUEST` providers are fresh per message yet consistent across every
handler call of that message, and `TRANSIENT` ones refresh per message.
Failures — malformed deliveries, missing queue
handlers (`NO_QUEUE_HANDLER`) as well as handler errors — propagate out of
the invocation so Message Queue retry/dead-letter configuration stays
effective; deliveries no transport claims reject with `ConnectorError` code
`UNKNOWN_INVOCATION_EVENT`. Environments requiring graceful teardown can call
`handler.close()` to release the cached application; the next invocation
cold-starts again.

### Message Queue handlers

```ts
import { Injectable } from "@nestjs/common";
import {
  QueueHandler,
  QueueMessage,
  YandexContext,
  type QueueMessage as YandexQueueMessage,
  type YandexExecutionContext,
} from "@ycforge/nestjs-connector";

interface OrderEvent {
  orderId: string;
  items: number;
}

@Injectable()
export class OrdersConsumer {
  // Every @QueueHandler() method receives EVERY delivered message; a batch
  // runs sequentially in delivery order. QueueMessage<T> types the decoded
  // payload; the raw body stays available beside it.
  @QueueHandler()
  consume(
    @QueueMessage() message: YandexQueueMessage<OrderEvent>,
    @YandexContext() executionContext: YandexExecutionContext,
  ): void {
    executionContext.awsRequestId; // cross-transport correlation id
    message.payload.orderId; // deserialized application payload (see below)
    message.body; // exact raw body string, always preserved
    message.attributes; // verbatim system attributes
    message.messageAttributes; // camelCase user attributes, lossless strings
    message.raw; // untouched raw trigger envelope (escape hatch)
  }
}
```

A failing handler fails the whole invocation so retries and dead-letter
queues keep working. A delivery that reaches an application without any
`@QueueHandler()` registration fails with `ConnectorError` code
`NO_QUEUE_HANDLER` instead of being silently acknowledged.

#### Body payloads and message attributes

`QueueMessage` keeps three representation levels apart:

- **Raw** — `body` (the exact delivered string) and everything under `raw`.
- **Normalized** — identity, checksums, attributes and metadata in their
  observed forms; strings stay strings.
- **Payload** — `message.payload`, decoded on first access by the configured
  strategy and memoized per message.

Default policy is strict JSON: valid JSON becomes exactly what `JSON.parse`
produces (no Date revival, no numeric rewriting); anything else — plain
text, empty or malformed bodies — fails deterministically with
`ConnectorError` code `QUEUE_BODY_DESERIALIZATION_FAILED` inside the handler
round that reads it. Nothing is parsed for messages nobody consumes, and a
bad body never corrupts normalization of the rest of the delivery. Queues
that do not carry JSON stay fully usable through `body`, or through an
explicit custom deserializer:

```ts
const handler = createYandexHandler(AppModule, {
  queue: {
    deserializeBody: (body: string) => protobuf.decode(Buffer.from(body, "utf8")),
  },
});
```

The strategy receives `(body, message)` — its return value (including
`undefined`) becomes `payload`, and its failures propagate verbatim like
handler failures.

Message attributes are never decoded: `{ dataType, stringValue }` preserves
the original `string_value` exactly, Number-typed values keep their precise
string form (conversion is your deliberate step), unknown future data types
flow through unchanged, and `md5OfMessageAttributes` passes through
verbatim.

## Failure semantics

Every invocation ends in a transport-shaped success or a transport-shaped
failure. Failures fall into three explicit classes (full contract:
[ARCHITECTURE.md §6](./docs/ARCHITECTURE.md#6-error-semantics)):

1. **Transport / invocation validation.** Events no transport claims reject
   with `ConnectorError` code `UNKNOWN_INVOCATION_EVENT` before any
   initialization effort; claimed-but-malformed events reject with
   `INVALID_INVOCATION_EVENT` before any application code runs.
   `error instanceof ConnectorError` identifies an expected boundary error;
   branch on its stable `code`, never on messages.
2. **Message Queue payload deserialization.** A body that is not valid JSON
   fails the consuming handler round with `QUEUE_BODY_DESERIALIZATION_FAILED`
   (raw `body` and `raw` stay available); custom deserializer failures
   propagate verbatim. Both fail the whole invocation under the same fail-fast
   contract as handler errors.
3. **Application handler failures** — never wrapped, never converted:
   - **HTTP**: exceptions map through NestJS's own machinery — `HttpException`
     responses keep their exact status code and body, exception filters and
     interceptors stay in charge, and an unexpected failure becomes one static
     opaque envelope (`{"statusCode":500,"message":"Internal server error"}`)
     with no stack frames, exception text or echoed request values. A failing
     invocation never affects the next warm invocation.
   - **Message Queue**: failures propagate out of the function invocation —
     deliberately, so Yandex Message Queue retry/dead-letter configuration can
     operate; the connector never acknowledges a failed delivery by returning a
     successful result. Batches run sequentially and fail fast: messages after
     the first failure are not attempted, earlier successes are not replayed
     inside the same invocation, and a successful delivery resolves to the
     normalized batch — never an HTTP-style envelope. Manual acknowledgement,
     deletion, retry counters and DLQ management are intentionally absent;
     Yandex Message Queue owns those mechanics.

**Bootstrap failures:** if Nest initialization fails, the invocation rejects
with the original error (never a falsely successful response), every
concurrent caller of that cold start observes the same failure, the next
invocation retries initialization from scratch (failed cold starts are never
cached), and `handler.close()` stays idempotent.

**Diagnostic redaction:** connector diagnostics are value-free — field names,
expected types, transport ids and route patterns only. Deserialization errors
drop `JSON.parse` details because they can quote body fragments; automatic
serialization of the execution context replaces the IAM token with
`REDACTED_TOKEN` and excludes raw payloads; the connector itself logs nothing.

## Architecture

The design-of-record lives in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
It covers the layering between the NestJS application layer and this
package's internal transport/core layers, the public API surface and its
visibility rules, invocation detection, cold/warm lifecycle expectations,
per-transport error semantics, raw-data preservation guarantees, and the
extension points for future transports.

Source layout:

| Directory         | Visibility | Responsibility                                    |
| ----------------- | ---------- | ------------------------------------------------- |
| `src/index.ts`    | Public     | The only entry point; deliberate export surface   |
| `src/core/`       | Mixed      | Transport SPI contracts; runtime internals (#3)   |
| `src/http/`       | Mixed      | Public HTTP contracts; adapter behavior (#5, #6)  |
| `src/mq/`         | Mixed      | Public queue contracts; adapter behavior (#7, #8) |
| `src/context/`    | Mixed      | Context contract + decorator (#4); internals      |
| `src/decorators/` | Public     | Decorator signatures; queue implementations (#8)  |

Per-module visibility tiers and the explicit list of public exports are in
[ARCHITECTURE.md §2 and §7](./docs/ARCHITECTURE.md#7-public-api-surface).

## Requirements

- Node.js >= 22
- Peer dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/swagger` (^11)

## Development

Part of the [serverless-tools](https://github.com/ycforge/serverless-tools)
pnpm workspace (`packages/nest-bridge`):

```bash
pnpm install
pnpm --filter @ycforge/nestjs-connector build      # tsup: dual ESM/CJS + dts
pnpm --filter @ycforge/nestjs-connector test       # vitest
pnpm --filter @ycforge/nestjs-connector typecheck  # tsc --noEmit
```

## License

[MIT](./LICENSE)
