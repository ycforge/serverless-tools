# Conformance fixtures

Sanitized conformance fixtures **reconstructed from captured evidence** of real
Yandex Cloud Functions traffic, used by the conformance test suites in
`src/http/conformance-fixtures.spec.ts` and `src/mq/conformance-fixtures.spec.ts`
to replay them through `createYandexHandler()` without any Yandex Cloud
connectivity (issue #11).

These files are **not literal captures**. Each fixture reproduces the observed
structure of one recorded invocation scenario; sensitive, identifying and
volatile values are deterministic synthetic placeholders (see "Provenance and
sanitization" below). The evidentiary weight lives in the **observed structure
and behavior** the fixtures encode — not in any individual value.

## Layout

```
fixtures/
  http/*.json   API Gateway payload format 2.0 reconstructions (46-capture evidence base)
  mq/*.json     Message Queue trigger reconstructions (51-capture evidence base)
```

Every file is a single warm-invocation record:

```jsonc
{
  "timestamp": "2026-08-21T21:44:34.266Z", // capture-window time of the reconstructed scenario
  "node": "v22.15.0", // only runtime version observed in the dataset
  "provenance": {
    // Machine-readable stamp validated by the fixture loader on every load.
    // Envelope-only: the event/context shapes stay free of synthetic metadata.
    "kind": "reconstructed", // these files are reconstructions, not captures
    "evidence": "DATA-ANALYSE.md", // evidence base the reconstruction was distilled from
  },
  "event": {
    /* Sanitized reconstruction of the OBSERVED raw event shape: field names,
       nesting and structures preserved as captured; sensitive/identity values
       substituted with synthetic placeholders */
  },
  "context": {
    /* Sanitized reconstruction of the runtime context, preserving the observed
       field set including undocumented fields such as "context"."_data" - the
       runtime's deep copy of "event", mirrored here INSIDE the fixture with
       the same sanitized values (it documents structure, not original data) */
  },
}
```

## Provenance and sanitization

The fixtures are reconstructed from the same sanitized capture dataset that
[`../DATA-ANALYSE.md`](../DATA-ANALYSE.md) documents. The original capture
archive is not stored in this repository, and no fixture value should be read
as original production data. Each reconstruction substitutes:

- IAM tokens → `[REDACTED]` in `context.token` (the loader's JSON
  serialization re-redacts it as `REDACTED_TOKEN`);
- `Authorization`, `Cookie` and session values → deterministic placeholders
  (`REDACTED_AUTHORIZATION`, `REDACTED_SESSION`);
- client IPs → TEST-NET-3 addresses (`203.0.113.0/24`);
- cloud/folder/queue identifiers → synthetic constants matching the
  repository's established fixture convention (`a1b2c3d4000000000000`,
  `e5f6a7b8000000000000`);
- request IDs, trace IDs, operation IDs and message IDs → values derived
  deterministically from the fixture name;
- timestamps → synthetic instants within a fixed capture window.

What is preserved because its **structure or behavior was observed**: the
injected gateway headers and their value shapes, the empty `authorizer {}` /
`Tracestate ""` / `logGroupName ""` trio,
`X-Serverless-Certificate-Ids: "{}"`, `apiGateway.operationContext` probe
blocks, seconds-resolution `timeEpoch`, string-typed `memoryLimitInMB`,
`event_id === message_id`, `created_at === SentTimestamp`,
`tracing_context: null`.

## Evidence levels

Per [`../AGENTS.md`](../AGENTS.md) §2.3 each notable field falls into one of:

| Level       | Examples                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observed`  | all header names/value shapes, body encoding rules, repeated-query comma joining, `rawPath` decoding of `%3F`, seconds `timeEpoch`, `_data` mirror structure, MQ attribute names/types |
| `inferred`  | ~5s timeout (`deadlineMs = event time + 4900`), SQS-compatible `md5_of_message_attributes` algorithm for user attributes                                                               |
| `synthetic` | all substituted identifiers/credentials/IPs listed above; exact timestamps within the capture window                                                                                   |

## What the tests validate

The suites replay every fixture through the public connector API and assert
that the implementation normalizes and routes according to the **observed
behavior encoded by the fixture**. Assertions are structural/behavioral:
values expected from an event are derived from that same fixture, so a test
failure means the implementation diverged from the encoded observation — never
that some original cloud datum changed. Values documented as observed quirks
(for example the rebuilt `requestContext.http.path` shape) are additionally
pinned as explicit literals; synthetic identifiers, IPs, trace ids and token
placeholders are asserted only where the tested property is verbatim transport
pass-through or redaction.

## Scenarios

HTTP (`fixtures/http/`):

| Fixture                           | Behavior pinned                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get-without-query`               | bodiless GET still arrives `isBase64Encoded: true`; trailing `?` on rebuilt path                                                                        |
| `catch-all-path-parameters`       | gateway-wide `ID` parameter carries the whole subpath                                                                                                   |
| `repeated-query-parameters`       | comma join in `queryStringParameters`, list in `multiValueParameters`, reordered rebuild (gateway-declared order), no trailing `?` while a query exists |
| `url-encoded-query-values`        | decoded query values incl. Unicode/emoji/reserved characters, lowercase percent hex and `+`-for-space rewrite on rebuild (as captured for `/curl-data`) |
| `encoded-path-characters`         | decoded `%3F` truncates `rawPath`; rebuilt path keeps the decoded form; routing must use `rawPath`                                                      |
| `custom-headers-and-cookies`      | custom headers survive; declared cookie/header parameters exposed                                                                                       |
| `json-body-plain-utf8`            | only `application/json` bodies arrive plain (`isBase64Encoded: false`)                                                                                  |
| `plain-text-body-base64`          | other text types are Base64                                                                                                                             |
| `form-body-base64`                | form bodies arrive Base64 and unparsed                                                                                                                  |
| `binary-body-base64`              | binary survives round-trip byte-exactly                                                                                                                 |
| `custom-json-content-type-base64` | suffix JSON types are NOT treated as plain JSON                                                                                                         |

Message Queue (`fixtures/mq/`):

| Fixture                                   | Behavior pinned                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `simple-text-message`                     | opaque string body, system attributes, metadata relations                          |
| `json-body-message`                       | JSON body remains a string at the transport boundary; opt-in deserialization       |
| `unicode-body-message`                    | UTF-8 body + `md5_of_body` over UTF-8 bytes                                        |
| `custom-message-attributes`               | user message attributes with String/Number data types                              |
| `complete-metadata-and-system-attributes` | full event metadata block, `md5_of_message_attributes: ""` when no user attributes |

## Regenerating

The generator script that produced these files is intentionally not committed;
the JSON files themselves are the source of truth for tests. To adjust a value,
edit the JSON directly, keep it prettier-formatted (`npx prettier --check
fixtures`), keep the `provenance` stamp intact, and make sure the corresponding
conformance test still documents why the value matters.
