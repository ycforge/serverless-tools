# Architecture

This document defines the architecture and public contracts of
`@ycforge/nestjs-connector`. It is the design-of-record for issue #1;
runtime behavior is implemented incrementally by later issues and must conform
to the contracts defined here.

Evidence levels used below, following AGENTS.md §2.3:

- **observed** — captured from the real Yandex Cloud Functions runtime.
- **documented** — stated by Yandex documentation.
- **inferred** — a deliberate design decision made where evidence is absent;
  always marked as such.

---

## 1. Layering

```text
+---------------------------------------------------------------+
| Application layer (user code)                                 |
|   NestJS controllers, queue handlers, services                |
|   MUST NOT import anything from this package's internals      |
|   and SHOULD not need Yandex-specific types at all            |
+---------------------------------------------------------------+
                              | depends only on public API (src/index.ts)
+---------------------------------------------------------------+
| Public contract layer (@ycforge/nestjs-connector)        |
|   Normalized models: HTTP request, response envelope,         |
|   queue batch/message, execution context                      |
|   Decorator signatures: @YandexContext @QueueHandler          |
|   @QueueMessage                                               |
|   createYandexHandler(AppModule) entry point                  |
+---------------------------------------------------------------+
                              | implemented by
+---------------------------------------------------------------+
| Transport adapter layer (internal)                            |
|   src/http — API Gateway v2 event <-> NestJS HTTP             |
|   src/mq   — Message Queue trigger event -> handler dispatch  |
|   Each transport is independent: no shared behavior,          |
|   no knowledge of each other's semantics.                     |
+---------------------------------------------------------------+
                              | bootstraps / routes
+---------------------------------------------------------------+
| Core runtime layer (internal)                                 |
|   src/core — detection, Nest bootstrap + warm caching,        |
|   invocation-scoped context propagation, raw escape hatches   |
+---------------------------------------------------------------+
```

The application layer is the user's NestJS application. The connector is a
thin runtime/transport adapter (AGENTS.md §1): it never turns NestJS into a
Yandex-specific framework, and business code stays testable with plain
NestJS/HTTP/queue abstractions.

## 2. Module map and visibility

Visibility tiers:

- **Public** — exported through `src/index.ts`; stable per semver (AGENTS.md
  §19).
- **Internal** — everything else. The `exports` map in `package.json` exposes
  only the `"."` subpath, so deep imports of `dist/**` are blocked by the
  package resolver; internal modules may change at any time.

| Module                                          | Visibility | Responsibility                                                                               |
| ----------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `src/core/transport.ts`                         | Public     | Transport SPI: adapter contract, handler type, container ref                                 |
| `src/core/raw-access.ts`                        | Public     | `HasRaw` mixin contract for lossless raw access                                              |
| `src/core/errors.ts`                            | Public     | Error taxonomy codes for unknown/invalid invocations                                         |
| `src/core/create-yandex-handler.ts`             | Public     | Runtime entry point: bootstrap, caching, dispatch (#3)                                       |
| `src/core/handler-options.ts`                   | Public     | `createYandexHandler` options incl. queue deserializer (#9)                                  |
| `src/core/connector-error.ts`                   | Public     | Concrete boundary error carrying the taxonomy codes (#3)                                     |
| `src/core/detect-transport.ts`                  | Internal   | Detection loop over the ordered adapter registry (#3)                                        |
| `src/core/transports.ts`                        | Internal   | Ordered built-in adapter registry; registration point                                        |
| `src/http/raw-event.ts`                         | Public     | Raw API Gateway v2 event shape (**observed**)                                                |
| `src/http/normalized-request.ts`                | Public     | Normalized HTTP request contract                                                             |
| `src/http/response.ts`                          | Public     | Function response envelope (**documented**)                                                  |
| `src/mq/raw-event.ts`                           | Public     | Raw Message Queue trigger event shape (**observed**)                                         |
| `src/mq/message.ts`                             | Public     | Normalized queue message/batch contracts + body strategy (#9)                                |
| `src/mq/queue-handler.decorator.ts`             | Public     | `@QueueHandler()` method registration (#8)                                                   |
| `src/mq/queue-message.decorator.ts`             | Public     | `@QueueMessage()` registration + merged message type (#8)                                    |
| `src/mq/dispatch.ts`                            | Internal   | Queue handler discovery + per-message fan-out dispatch (#8)                                  |
| `src/mq/body-deserialization.ts`                | Internal   | Default strict-JSON policy + memoized payload reader (#9)                                    |
| `src/context/yandex-execution-context.ts`       | Public     | Normalized execution context (**observed**)                                                  |
| `src/context/build-yandex-execution-context.ts` | Internal   | Builds the normalized context per invocation (#4)                                            |
| `src/context/invocation-scope.ts`               | Internal   | AsyncLocalStorage invocation isolation (#4)                                                  |
| `src/context/yandex-context.decorator.ts`       | Public     | `@YandexContext()` implementation (#4)                                                       |
| `src/decorators/decorator-contracts.ts`         | Public     | Signatures of the three decorators                                                           |
| `src/http/*`, `src/mq/*` adapters               | Internal   | Behavior implementing the above contracts (#5–#8)                                            |
| `src/testing/invocation-fixtures.ts`            | Internal   | Test-only loader for the `fixtures/` conformance reconstructions (#11); excluded from `dist` |

Rules:

- `src/index.ts` is the **only** public entry point. Exports there are added
  deliberately and explicitly (`export type { ... } from "..."`), never via a
  wildcard barrel.
- Types are exported as _type-only_ until their runtime implementation exists,
  so consumers can compile against contracts without shipping dead code.

## 3. Invocation flow and lifecycle

### 3.1 Entry point

The single runtime entry point is:

```ts
const handler = createYandexHandler(AppModule);
export const handler; // consumed by the Yandex Cloud Function runtime
```

`createYandexHandler` returns a `ClosableYandexCloudFunctionHandler`: the exact
`YandexCloudFunctionHandler` call signature the function runtime invokes
(`(rawEvent, rawContext) => Promise<unknown>`) plus a `close()` teardown hook
(section 3.4). Contract: `src/core/transport.ts`. Implementation: issue #3.

### 3.2 Cold start

- On first invocation the core bootstraps the Nest application exactly once.
- The bootstrap uses `NestFactory.create(AppModule, new YandexHttpAdapter())`
  over the framework transport SPI (`AbstractHttpAdapter`), followed by
  `app.init()`: Nest builds the full dependency graph and records routes,
  middleware and body parsing with the connector's own adapter instead of an
  HTTP listener. No socket is opened and no platform package
  (`@nestjs/platform-express`) is required; the only peers stay
  `@nestjs/common`/`@nestjs/core`. The adapter only records what Nest
  registers — routing decisions, guards, interceptors, pipes, filters,
  status defaults and exception mapping stay inside the framework's opaque
  route proxies, which the dispatch layer replays per invocation.
- Initialization is race-safe: a single shared initialization promise lives in
  the handler factory closure, so concurrent cold invocations await one
  instance instead of building duplicate applications (AGENTS.md §10.3). One
  cache exists per created handler — never global state shared between
  unrelated handlers.
- A failed cold start is **not** cached as a permanent failure: the promise is
  cleared on rejection so the next invocation retries initialization. All
  concurrent callers of the failed attempt receive the same bootstrap error.

### 3.3 Warm invocations

- The initialized application is cached and reused; Nest is never re-created
  per invocation (AGENTS.md §10.2).
- Everything invocation-specific (event, context, normalized request/message)
  is created per invocation and passed explicitly. No singleton may hold
  `currentEvent`/`currentContext`/`currentMessage` state between invocations
  (AGENTS.md §11); tests must prove isolation across sequential invocations.

### 3.4 Shutdown

Yandex Cloud Functions freezes or reclaims execution environments without
guaranteed teardown signals, so the connector registers no automatic shutdown
hooks and deliberately keeps the application alive for warm invocations until
the environment dies with it. Environments where graceful teardown is required
(custom runtimes, integration tests) call `close()` on the returned handler:
it releases the cached application, is idempotent, performs nothing when no
cold start happened yet, awaits an in-flight initialization before releasing
it, and lets the next invocation perform a fresh cold start.

### 3.5 Invocation-scoped execution context (#4)

After detection claims an event, the core builds one
`YandexExecutionContext` per invocation (`src/context/build-yandex-execution-context.ts`)
from the untouched event/context pair and dispatches inside an
AsyncLocalStorage scope (`src/context/invocation-scope.ts`). Consequences:

- The context is transport-neutral: HTTP and Message Queue executions expose
  the identical abstraction, including the same correlation id
  (`awsRequestId`) and trace metadata.
- `@YandexContext()` is a thin parameter registration; transports fill the
  registered parameters from the invocation scope when dispatching to user
  handlers (issues #5/#7/#8). Resolution outside an invocation fails loudly.
- The scope state is the transports' extension slot: the claiming transport
  adds its normalized per-invocation models (the HTTP request since issue #5,
  the queue batch since issue #7) immutably before dispatch, and queue
  dispatch nests one further immutable extension carrying exactly the message
  a handler round is processing (issue #8), so concurrent invocations keep
  fully isolated views (AGENTS.md §11).
- The scope exists only for the duration of one handler invocation: concurrent
  invocations get isolated stores, sequential invocations never observe each
  other's state (AGENTS.md §11), and nothing survives after completion.
- The normalized context is frozen and carries a serialization guard
  (`toJSON`) that redacts the IAM token and excludes raw payloads, so
  accidental logging cannot leak credentials (AGENTS.md §6.2). Explicit
  property access remains available as the escape hatch.

## 4. Transport detection

Detection happens **once**, in the core, immediately after receiving the raw
invocation — never scattered through application code (AGENTS.md §30).

Policy:

1. Core iterates registered transport adapters in a fixed, deterministic order.
2. Each adapter answers `supports(rawEvent)` — a cheap, deterministic,
   structural predicate that never throws and never mutates the input.
3. The first adapter that claims the event handles it exclusively.
4. If no adapter claims the event, the core throws an error coded
   `UNKNOWN_INVOCATION_EVENT`. Unknown events are **never silently treated as
   HTTP**, and arbitrary objects that happen to contain `messages` are not
   trusted as MQ events without full structural validation (AGENTS.md §8.3).

Discriminators (**observed**):

- **HTTP**: `event.version === "2.0"` plus the presence of the canonical
  fields `rawPath` / `rawQueryString` (full validation in the HTTP adapter).
- **Message Queue**: a validated `messages` array whose elements match the
  observed trigger structure (`event_metadata`, `details.queue_id`,
  `details.message.message_id`, ...). Validation must be cheap top-level
  structure checks — no heavyweight schema library (AGENTS.md §9).

Adding a future transport means writing a new internal adapter module,
extending the `TransportId` union in one place, and registering it in
`src/core/transports.ts`'s ordered adapter list. The application layer does
not change. Detection also precedes initialization: events nobody claims
never trigger a Nest cold start.

The registered HTTP adapter (`src/http/adapter.ts`) claims events whose
`version === "2.0"` plus string `rawPath`/`rawQueryString` (**observed**
discriminator), validates the full observed shape inside its dispatch, and
publishes the normalized `NormalizedHttpRequest` into the invocation scope
before user code runs. Controller dispatch then goes through the warm
application itself: the transport resolves the application's HTTP adapter,
verifies it is the connector's own (`YandexHttpAdapter`), and hands it the
normalized request plus a fresh response facade.

The SPI adapter is deliberately thin: during cold start it only _records_ the
layers Nest registers through the framework transport SPI — the JSON body
parser, functional middleware, per-route handler proxies, and the terminal
not-found/error proxies — in registration order. Per invocation, the small
dispatch pipeline replays that order (the router role Express would otherwise
play): ordered scanning, prefix matching for mounts, full matching with
parameter capture for routes, fallthrough via `next()`, and one error hop.
Every recorded layer is an opaque `(req, res, next)` proxy built by NestJS, so
guards, interceptors, pipes, filters, status defaults and exception mapping
remain framework semantics — the connector neither reimplements nor inspects
them. Response serialization maps the facade onto the
`YandexFunctionHttpResponse` envelope (section 6.1).

Because no real router validates route strings before they reach the adapter,
the matcher defines an explicit compatibility contract (`src/http/
path-matching.ts`), audited against what `@nestjs/core` 11 can hand over:

- **Supported**: static segments; single-segment `:param` captures; tail
  wildcards in every spelling Nest 11 / Express 5 era code produces (`/*`,
  `/*name`, `/{*name}`, legacy `/(.*)`); the `/api$` exact-mount marker that
  Nest's own `RouteInfoPathExtractor` emits for catch-all middleware under a
  global prefix; trailing-slash normalization and case-insensitive comparison
  like the platform default router. Controller/module/global prefixes and URI
  version prefixes are plain literal composition upstream, so they work
  unchanged; multi-path decorators arrive as separate registrations.
- **Rejected at registration** with `ConnectorError` code
  `UNSUPPORTED_ROUTE_PATTERN`: regular-expression or quantifier syntax
  (`a(b)?c`, `:id(\d+)`), optional or brace-wrapped parameters (`:id?`,
  `{:id}`), wildcards outside the final segment, and non-string paths. A
  pattern outside the contract therefore fails cold start deterministically —
  never silently misroutes.

The registered Message Queue adapter (`src/mq/adapter.ts`, issue #7) claims
deliveries whose `messages` array is non-empty and whose elements carry the
observed fingerprint — an object `event_metadata` plus `details.queue_id` and
`details.message.message_id` (**observed**, DATA-ANALYSE.md section C).
Near-miss shapes — including an empty `messages` array, which never occurred in
51/51 captures — stay unclaimed and fail with `UNKNOWN_INVOCATION_EVENT`
instead of being silently absorbed (AGENTS.md §8.3). Inside its dispatch the
adapter validates every observed field of every delivered envelope (failures
become `INVALID_INVOCATION_EVENT` with value-free diagnostics naming only
field paths) and transforms the delivery into the normalized `QueueBatch`:
one typed envelope per message with event metadata, queue id, message
identity, verbatim system attributes, camelCase user attributes, checksums,
the opaque raw body and untouched `raw` references throughout. Each envelope
additionally carries a lazy, memoized `payload` getter bound to the
configured body deserializer — normalization itself never interprets bodies
(issue #9, section 5.1 below). The batch is
published to the invocation scope (mirroring the HTTP request) and handed to
queue handler dispatch (issue #8): discovery walks the warm application
container once per application for methods marked `@QueueHandler()` — modules
in insertion order, controllers before providers within each module,
registrations deduplicated across the module surfaces shared providers appear
under, result cached per application like recorded route layers — then every
discovered handler receives EVERY delivered message, sequentially in delivery
order, each round inside an immutable scope extension carrying exactly that
message (`@QueueMessage()` resolves per message while `@YandexContext()`
keeps resolving the invocation context). Handler instances resolve through
the invocation's container view once per message, under one DI sub-tree
created for that message (a `ContextId` from `@nestjs/core`
`ContextIdFactory`, verified against @nestjs/core 11): DEFAULT-scoped
providers keep their cached singleton, REQUEST-scoped providers are
instantiated fresh for every message yet stay consistent across every
handler call of that message — mirroring one platform request — and
TRANSIENT providers refresh with each message's sub-tree. Per-context
instances live in framework `WeakMap`s keyed by the throwaway context id,
so warm processes do not accumulate state across invocations. Handler
return values are ignored — a queue delivery has no response envelope — and
successful dispatch returns the normalized batch unchanged. Deliveries are
normalized as a batch regardless of the current trigger's grouped-message
limit of 1 (**observed**) — nothing hard-codes that limit.

## 5. Raw data preservation

Every normalized model carries its untouched source under `raw` via the
`HasRaw<TRaw>` contract:

- `NormalizedHttpRequest.raw` → the raw API Gateway v2 event.
- `QueueBatch.raw` / `QueueMessage.raw` → the raw trigger event / message.
- `YandexExecutionContext.raw` → the entire raw function context, including
  undocumented fields such as `_data`.
- `YandexExecutionContext.rawEvent` → the raw invocation event this context
  belongs to (API Gateway v2 payload or Message Queue delivery).

Consequences enforced by this rule:

- Normalization is transformation, never mutation of raw objects (AGENTS.md
  §7.3).
- Additive/unknown Yandex fields remain reachable through `raw` even when the
  normalized model does not describe them yet (AGENTS.md §36). Raw interfaces
  therefore include explicit index signatures typed `unknown`.
- Values are never silently coerced: `memoryLimitInMB` stays `string`,
  `createdAt` stays ISO string, repeated query parameters keep both their
  comma-joined (`queryStringParameters`) and list (`multiValueParameters`)
  forms without merging them (AGENTS.md §4.3, §5).

### 5.1 Queue body deserialization and message attributes (#9)

Four representation levels exist for a queue delivery and are kept strictly
distinct:

1. **Raw transport representation** — the trigger event reachable through
   `raw` (snake_case, additive fields included) plus `QueueMessage.body`, the
   exact UTF-8 string Yandex delivered. Never rewritten by any code path.
2. **Normalized message representation** — identity, checksums, system/user
   attributes and metadata in their observed forms. Strings stay strings.
3. **Deserialized application payload** — `QueueMessage<T>.payload: T`,
   produced on first access by the configured strategy and memoized per
   message instance.
4. **Message attribute representation** — `{ dataType, stringValue }` per
   named user attribute; see below.

**Why lazy rather than eager normalization:** deserialization happens when
the application first reads `payload`, never during transport normalization.
This preserves the transport/application separation (AGENTS.md §32 — bodies
are opaque at the transport boundary), keeps undecodable bodies from
corrupting otherwise valid deliveries, skips parsing for messages whose
handlers only read metadata, and gives default and custom strategies one
uniform behavior. The outcome — value or failure — is computed exactly once
per message instance and replayed on repeated access, so fan-out handlers of
one round observe one consistent payload and side-effecting custom
strategies run once.

**Default policy: strict JSON.** Valid JSON text decodes to exactly what
`JSON.parse` produces (objects, arrays, strings, numbers, booleans, null) —
no reviver, no Date revival, no numeric rewriting beyond normal JSON.parse
semantics. Anything else (plain text, empty body, malformed JSON, BOM-prefixed
text) fails deterministically with `QUEUE_BODY_DESERIALIZATION_FAILED`. The
underlying `SyntaxError` is deliberately dropped because its message can
quote body fragments; boundary diagnostics stay value-free (AGENTS.md §6.2).
Non-JSON queues remain fully usable through `body`; applications that want
string payloads install an explicit identity-style deserializer instead of
the connector guessing.

**Custom deserializer:** `createYandexHandler(AppModule, { queue: {
deserializeBody }) }` replaces the default policy for every delivery that
runtime handles. The strategy receives `(body, message)` — the exact raw
string plus the normalized message, so it may branch on attributes or
metadata — and its return value becomes `payload` (`undefined` included).
Failures propagate verbatim into the consuming handler round, unwrapped,
exactly like handler failures.

**Invalid JSON cannot corrupt handling:** a decode failure surfaces inside
exactly the handler round that reads `payload` and propagates as an
invocation failure through the ordinary fail-fast semantics (§6.2), keeping
Message Queue retry/dead-letter configuration effective. Normalization,
sibling messages already processed, and raw access all remain unaffected.

**Message attributes are never decoded.** `{ dataType, stringValue }`
preserves the original `string_value` byte-for-byte: Number-typed attributes
keep their exact string form so precision-sensitive values survive without
loss, converting them is a deliberate consumer step (`Number(...)`, bigint
parsing), unknown/future `data_type` values normalize through the same shape
instead of being rejected, and `md5_of_message_attributes` passes through
verbatim alongside everything else.

## 6. Error semantics

Error handling differs by transport because the transports differ in sync vs
async semantics. What is **unified** (issue #10) is the failure taxonomy:
every invocation ends in exactly one of two outcomes — a transport-shaped
success or a transport-shaped failure — and every failure belongs to exactly
one of three failure classes:

| Failure class                            | Raised by                                                                       | Representation                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Transport / invocation validation     | Detection or structural validation of the raw event/context; route registration | `ConnectorError` codes `UNKNOWN_INVOCATION_EVENT`, `INVALID_INVOCATION_EVENT`, `UNSUPPORTED_ROUTE_PATTERN`                                                                                              |
| 2. Message Queue payload deserialization | Reading `QueueMessage.payload` under the configured body strategy               | Default policy: `ConnectorError` code `QUEUE_BODY_DESERIALIZATION_FAILED`; custom strategies propagate their own errors verbatim into the consuming handler round                                       |
| 3. Application handler failure           | User code: controllers, guards, services, pipes, queue handlers                 | Never a `ConnectorError`, never wrapped, never converted: HTTP maps it through the NestJS exception machinery onto a deterministic response, Message Queue propagates it verbatim out of the invocation |

**Boundary rule:** `error instanceof ConnectorError` identifies an expected
boundary failure raised by this package itself. Any other error escaping an
invocation originates in application code and reaches the boundary untouched.
Applications branch on the stable `code` values, never on messages.

### 6.1 Synchronous HTTP

- Exceptions raised inside controllers/services are first-class NestJS
  territory: every route is an opaque framework proxy, so normal exception
  filters and `HttpException` mapping produce the HTTP response unchanged.
  The connector does not swallow or wrap them.
- **Failure class 3 mapping (issue #10):** a thrown `HttpException` — including
  custom subclasses and object response bodies with arbitrary status codes —
  becomes exactly the response the application defined: status code, body
  shape and headers travel untouched. An unexpected (non-`HttpException`)
  failure maps through the framework filters to one static, value-free
  envelope (`statusCode` `500`, `"Internal server error"`): neither the error
  message nor stack frames nor any request value reaches the client
  (AGENTS.md §8.1). Global and route-scoped exception filters remain in
  charge and may replace both mappings; interceptors observe handler failures
  first and may remap them before exception mapping applies. The connector
  installs no parallel error framework.
- Failures escaping every registered layer fall back to a deterministic,
  opaque internal-server-error envelope (`statusCode` `500`,
  `"Internal server error"`) mirroring the platform default; neither the error
  message nor stack frames reach the client (AGENTS.md §8.1).
- Success serialization maps the response facade onto
  `YandexFunctionHttpResponse`. Transport policy is explicit and lives in
  exactly two places: implicit content types are decided once, at
  payload-write time in the response facade (`application/json` for JSON,
  `text/plain; charset=utf-8` for strings, `application/octet-stream` for
  buffers — an explicit handler-set `Content-Type` always wins), and body
  encoding is decided once, in the serializer (strings stay plain UTF-8;
  `Buffer` bodies become Base64 with `isBase64Encoded: true` so binary data is
  never corrupted by string coercion). Single-value headers collapse to
  strings; repeated values (e.g. multiple `Set-Cookie` appends) surface under
  the `multiValueHeaders` field instead of being comma-joined.
- `multiValueHeaders` is **observed** against the live API Gateway
  payload-format-2.0 response path (2026-08-22, wire-level curl inspection of
  a probe function): the gateway accepts the field, joins repeated ordinary
  headers into one comma-separated wire line, and emits repeated `Set-Cookie`
  values as separate header lines — preserving true multiplicity where
  comma-joining would be lossy. When a name appears in both maps,
  `multiValueHeaders` wins.
- Framework router semantics are inherited rather than reimplemented:
  unmatched requests reach Nest's own not-found proxy (`Cannot …` envelope),
  `POST` routes default to `201 Created`, `HEAD` falls back to `GET`, and a
  handler forwarding via `next()` falls through to later matching layers —
  express router behavior the connector reproduces because it replaces the
  platform server. Defense-in-depth fallbacks exist only for the case where
  no registered layer produced a wire-valid response at all.
- Malformed JSON request bodies surface as deterministic `400 Bad Request`
  responses through the same error path — body parsing is the first stack
  layer, so syntax errors flow through exception layers exactly like platform
  `bodyParser` errors do. Serialization failures of handler payloads (e.g.
  circular structures) surface inside the route proxy and map through the
  framework filters to the same opaque 500.
- **Failure classes 1 and bootstrap never produce a response envelope**
  (issue #10): unknown events (`UNKNOWN_INVOCATION_EVENT`) fail before any
  initialization effort, claimed-but-malformed events
  (`INVALID_INVOCATION_EVENT`) fail before any application code runs, and a
  failed cold start rejects the invocation with the original bootstrap error
  (section 6.4). A rejected invocation therefore never masquerades as a
  `200`/`4xx`/`5xx` response toward the gateway.
- An HTTP exception in one invocation cannot affect the next warm invocation:
  request/response state is created per dispatch, so failures leave no residue
  and later invocations observe their own deterministic outcomes
  (AGENTS.md §11).

### 6.2 Asynchronous Message Queue

- Any failure inside a queue handler propagates out of the invocation. The
  connector never catches-and-forgets (AGENTS.md §8.2): a failed message must
  surface as a failed invocation so Message Queue retry / dead-letter
  configuration remains effective. This propagation is the whole
  acknowledgement contract by design: Yandex Message Queue owns message
  deletion, retry counters and dead-lettering, and the failed invocation is
  exactly the signal its configuration consumes. The connector deliberately
  implements no manual acknowledgement, deletion, retry-counter or DLQ
  management APIs.
- Batch iteration is fail-fast and sequential: the first handler failure
  rejects the whole invocation immediately, and messages after the failing one
  are never attempted — the domain model stays batch-capable regardless of the
  current grouped-message limit of `1` (**observed**, AGENTS.md §4.6), but no
  acknowledgement policy is implied beyond "the invocation failed".
- Earlier successful messages are never replayed inside the same invocation
  after a later failure: every round runs exactly once per delivery, in order.
  Redelivery of already-processed messages after a failed invocation is
  Yandex Message Queue's decision under its configured retry policy — at-least-
  once semantics belong to the platform, not to this connector; consumers that
  cannot tolerate reprocessing must deduplicate themselves.
- A claimed delivery with no registered `@QueueHandler()` fails with
  `NO_QUEUE_HANDLER` instead of succeeding silently: nobody consumed the
  message, so retry/dead-letter configuration must observe it (AGENTS.md
  §8.3).
- **Payload deserialization is its own failure class** (issues #9/#10): a body
  that cannot be decoded under the default JSON policy fails the consuming
  handler round with `ConnectorError` code `QUEUE_BODY_DESERIALIZATION_FAILED`
  (§5.1); custom deserializer failures propagate verbatim into the consuming
  round. Both fail the whole invocation under the same fail-fast contract as
  handler failures — they are never converted to results, envelopes or
  skips. The untouched `body` and raw message stay available throughout, so
  applications can log or quarantine undecodable deliveries from their own
  code without the connector guessing a policy for them.
- Successful processing resolves to the normalized `QueueBatch` itself —
  never an HTTP-style envelope. There is no `{ statusCode, body }` shape on
  any queue transport result.

### 6.3 Boundary errors

Five error codes are reserved at the runtime boundary (`src/core/errors.ts`),
each belonging to exactly one of the three failure classes of section 6:

| Code                                | Failure class                           | Meaning                                                                                        |
| ----------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `UNKNOWN_INVOCATION_EVENT`          | 1 — invocation validation               | No transport claimed the event (diagnostic, non-secret detail)                                 |
| `INVALID_INVOCATION_EVENT`          | 1 — invocation validation               | A claiming transport failed deeper structural validation                                       |
| `UNSUPPORTED_ROUTE_PATTERN`         | 1 — invocation validation               | A route outside the documented matching subset was registered (#5); fails cold start           |
| `NO_QUEUE_HANDLER`                  | 1 — delivery-consumer wiring validation | The Message Queue transport claimed a delivery but no `@QueueHandler()` exists (#8)            |
| `QUEUE_BODY_DESERIALIZATION_FAILED` | 2 — payload deserialization             | Default strict-JSON policy could not decode a consumed queue body; value-free diagnostics (#9) |

Concrete error class: `ConnectorError` (issue #3) carries these codes and is
thrown at the detection/validation boundaries; transports raise
`INVALID_INVOCATION_EVENT` from their own validation. Failure class 3
(application handler errors) intentionally has **no** code and **no**
representation in this taxonomy: those errors are not connector boundary
failures and must reach their transport's failure semantics unchanged.

### 6.4 Bootstrap and runtime lifecycle failures

- If Nest initialization fails on cold start, every concurrent caller of the
  failing attempt receives the original error verbatim — it is not wrapped,
  not converted into an HTTP envelope, and not turned into a
  `ConnectorError`: the failure belongs to the application's module graph or
  the platform, and preserving the original type keeps it debuggable.
- A failed cold start is never cached as permanent state: the shared
  initialization promise is cleared on rejection, so the next invocation
  retries initialization from scratch (AGENTS.md §10). No module-level
  mutable error state exists.
- Because bootstrap strictly precedes detection-independent work and all
  transport dispatch, a failed initialization can never yield any transport
  result — in particular never a falsely successful HTTP envelope.
- `close()` stays idempotent, performs nothing before the first invocation,
  awaits an in-flight initialization before releasing it, and lets the next
  invocation cold-start fresh (§3.4).

### 6.5 Diagnostic redaction rules

The connector's own diagnostics are value-free by construction (AGENTS.md
§6.2):

- `ConnectorError` messages and details carry field names, expected types,
  transport ids and route patterns only — never body fragments, header values,
  tokens, cookies, client IPs, or arbitrary exception message text.
- The default strict-JSON deserialization policy drops the underlying
  `SyntaxError` entirely, because `JSON.parse` messages can quote body
  fragments; custom deserializer errors propagate unwrapped because wrapping
  would duplicate their content while the strategy owner is responsible for
  what their own errors expose.
- The normalized execution context serializes redacted: automatic
  `JSON.stringify` replaces the IAM token with `REDACTED_TOKEN` and excludes
  raw event/context payloads (issue #4).
- Last-resort HTTP envelopes contain only static strings
  ("Internal server error", framework not-found text); unexpected handler
  failures never leak messages, stack frames or request values into responses.
- The connector itself performs no logging. Framework-internal logging
  (Nest's logger reporting an unhandled exception) remains framework behavior;
  applications decide how to instrument via `@YandexContext()`, stable error
  codes and the raw escape hatches. Structured redaction utilities land with
  issue #13.

## 7. Public API surface

Explicit list. Everything not listed here is internal.

Defined now (exported from `src/index.ts`):

| Export                                                                                       | Kind  | Purpose                                                                                                     |
| -------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `createYandexHandler`                                                                        | value | Central entry point: module (+ optional options, #9) -> function handler (#3)                               |
| `ClosableYandexCloudFunctionHandler`                                                         | type  | Handler plus `close()` teardown hook (#3)                                                                   |
| `CreateYandexHandlerOptions`, `QueueTransportOptions`                                        | type  | Entry-point options; queue body deserializer configuration (#9)                                             |
| `ConnectorError`                                                                             | value | Boundary error carrying the taxonomy codes (#3)                                                             |
| `YandexCloudFunctionHandler`                                                                 | type  | Signature the function runtime calls                                                                        |
| `TransportAdapter`                                                                           | type  | SPI each transport implements                                                                               |
| `TransportInvocation`                                                                        | type  | Per-invocation input handed to a transport                                                                  |
| `TransportId`                                                                                | type  | Stable transport discriminator ids                                                                          |
| `InvocationContainer`                                                                        | type  | Read-only provider resolution over warm app                                                                 |
| `InjectableToken`                                                                            | type  | Token accepted by `InvocationContainer`                                                                     |
| `HasRaw`                                                                                     | type  | Raw-preservation mixin                                                                                      |
| `ConnectorErrorCode`                                                                         | type  | Reserved boundary error codes                                                                               |
| `RawHttpApiGatewayV2Event` (+ context types)                                                 | type  | Observed raw HTTP event                                                                                     |
| `NormalizedHttpRequest`                                                                      | type  | Canonical normalized request                                                                                |
| `YandexFunctionHttpResponse`                                                                 | type  | Response envelope returned to the runtime                                                                   |
| `RawQueueEvent`, `RawQueueMessageEvent`, `RawQueueMessageAttributeValue`                     | type  | Observed raw MQ event                                                                                       |
| `QueueBatch`, `QueueMessage<T>`, `QueueEventMetadata`, `QueueMessageAttribute`               | type  | Normalized MQ models; `payload: T` is the deserialized application payload (#9)                             |
| `QueueBodyDeserializer`                                                                      | type  | Custom queue body decoding strategy contract (#9)                                                           |
| `YandexExecutionContext`                                                                     | type  | Normalized execution context (**observed**)                                                                 |
| `ContextParameterDecorator`, `QueueMessageParameterDecorator`, `QueueHandlerMethodDecorator` | type  | Decorator signatures                                                                                        |
| `YandexContext()`                                                                            | value | Parameter injection of the normalized context (#4)                                                          |
| `QueueHandler()`                                                                             | value | Marks provider/controller methods as Message Queue consumers (#8)                                           |
| `QueueMessage()` (+ type)                                                                    | value | Parameter injection of the current queue message; the same name also names the generic message type (#8/#9) |
| `RequireAuth(scheme, guard)`                                                                 | value | Auth contract decorator: writes `ycsf:auth:*` metadata + `ApiSecurity` for non-public schemes (spec 003)    |
| `AUTH_SCHEME_KEY`, `AUTH_GUARD_KEY`                                                          | value | Stable auth metadata keys (spec 003)                                                                        |
| `AuthGuardType`, `ConnectorBootstrapOptions`                                                 | type  | Auth metadata value type; bootstrap options (`defaultAuthGuard`) (spec 003)                                 |
| `GlobalAuthGuard`                                                                            | value | Global guard registered by the bootstrap; delegates to declared guards via DI, method > controller (spec 003) |

The default JSON policy and payload memoization mechanics
(`src/mq/body-deserialization.ts`) are deliberately internal: consumers shape
behavior exclusively through `QueueBodyDeserializer`.

Spec 003 additionally exposes subpath entry points `./auth`, `./queue`,
`./context` (`src/auth/index.ts`, `src/queue/index.ts`, `src/context/index.ts`)
as focused re-exports of the surface above; the root barrel is unchanged for
existing consumers. Subpath modules never import the root barrel (FR-008,
pinned by `test/packaging/no-root-barrel-import.spec.ts`).

The runtime value exports are pinned in two places that must stay in sync with
this table: `src/index.spec.ts` and `src/packaging.spec.ts` (exports map).

## 8. Extension points

- **New transports** (e.g., Object Storage triggers): implement
  `TransportAdapter`, extend `TransportId`, register the adapter in the core's
  deterministic order. No changes to normalized models of other transports and
  none to the application layer.
- **Application-side extensibility** stays in NestJS: users intercept behavior
  with standard guards/interceptors/filters, not connector-specific plugins.
- **Raw escape hatches** guarantee that gaps in the connector can be bridged by
  application code reading `raw`, without waiting for connector support — while
  keeping day-to-day code decoupled from Yandex shapes.

## 9. Runtime targets

- Node.js >= 22 (`engines` field), CommonJS output with declaration files for
  frictionless consumption by NestJS toolchains.
- Peer dependencies limited to `@nestjs/common` and `@nestjs/core` (^11);
  zero runtime dependencies otherwise (AGENTS.md §17).

## 10. Traceability

| Concern                                | Where defined here         | Implemented by |
| -------------------------------------- | -------------------------- | -------------- |
| Bootstrap + lifecycle + race-safe init | §3                         | #3             |
| Execution context + `@YandexContext()` | §5, §7                     | #4             |
| HTTP request adapter                   | §4, §5, §6.1               | #5             |
| HTTP response/error mapping            | §6.1                       | #6             |
| MQ event adapter                       | §4, §5                     | #7             |
| Queue decorators/dispatch              | §6.2, §7                   | #8             |
| Body deserialization, attributes       | §4, §5.1, §6.2, §7         | #9             |
| Unified failure semantics              | §6, §6.3, §6.4, §6.5       | #10            |
| Replayable conformance fixtures        | fixtures/, §2 (test infra) | #11            |
| Redaction/security utilities           | §6.5                       | #13            |
