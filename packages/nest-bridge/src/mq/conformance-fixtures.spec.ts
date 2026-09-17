import { createHash } from "node:crypto";
import { Module } from "@nestjs/common";
import {
  resolveInvocationExecutionContext,
  resolveInvocationQueueBatch,
} from "../context/invocation-scope";
import type { YandexExecutionContext } from "../context/yandex-execution-context";
import { ConnectorError } from "../core/connector-error";
import { createYandexHandler } from "../core/create-yandex-handler";
import type { QueueBatch } from "./message";
import { QueueHandler } from "./queue-handler.decorator";
// Merged export: decorator factory plus the normalized message type it injects.
import { QueueMessage } from "./queue-message.decorator";
import { loadQueueFixture, type QueueInvocationFixture } from "../testing/invocation-fixtures";

/**
 * Conformance suite against sanitized conformance fixtures (issue #11).
 *
 * Every JSON file under `fixtures/mq/` is NOT a literal capture: it is a
 * sanitized reconstruction of one Message Queue trigger delivery scenario,
 * distilled from captured evidence (provenance, sanitization rules and
 * evidence levels: fixtures/README.md; evidence base: DATA-ANALYSE.md).
 * Identifiers and timestamps inside the fixtures are synthetic placeholders;
 * the OBSERVED trigger contract they encode carries the evidentiary weight:
 * metadata relations (`event_id === message_id`, ISO `created_at` equal to
 * the epoch-ms `SentTimestamp` attribute), string-typed system attributes,
 * user message attribute normalization without value coercion, checksums over
 * UTF-8 bytes, opaque bodies with opt-in strict-JSON payloads, and
 * batch-capable normalization even though the trigger currently delivers one
 * message at a time (AGENTS.md section 4.6).
 *
 * Each fixture replays through the PUBLIC runtime exactly as Yandex calls it.
 * Assertions validate the implementation against the observed behavior
 * encoded by each fixture (expected values are derived from the fixture
 * itself, never treated as original cloud data).
 *
 * Failure propagation semantics are pinned separately by
 * `mq-failure-propagation.spec.ts` (issue #10); this suite only records them
 * where a fixture's body shape demands it (plain-text payload access).
 */

interface CapturedRound {
  readonly message: QueueMessage;
  readonly executionContext: YandexExecutionContext;
}

const ROUNDS: CapturedRound[] = [];

class RecordingConsumer {
  record(message: QueueMessage): void {
    ROUNDS.push({
      message,
      // Resolved inside the invocation scope so isolation comes from the same
      // mechanism production uses, not from test bookkeeping.
      executionContext: resolveInvocationExecutionContext(),
    });
    // Touching the batch through the scope proves both models are published
    // together for every round.
    resolveInvocationQueueBatch();
  }
}

QueueHandler()(
  RecordingConsumer.prototype,
  "record",
  Object.getOwnPropertyDescriptor(RecordingConsumer.prototype, "record")!,
);
QueueMessage()(RecordingConsumer.prototype, "record", 0);

class ConsumeModule {}

Module({ providers: [RecordingConsumer] })(ConsumeModule);

const PAYLOAD_FAILURES: unknown[] = [];
const PAYLOAD_RAW_BODIES: string[] = [];
const PAYLOAD_MESSAGE_IDS: string[] = [];

/**
 * Deliberately swallows the payload error AFTER recording it: this probe pins
 * lazy payload evaluation semantics (which error class surfaces, raw body
 * preserved); invocation-failing propagation is covered by issue #10's suite.
 */
class PayloadProbeConsumer {
  probe(message: QueueMessage): void {
    PAYLOAD_MESSAGE_IDS.push(message.messageId);
    try {
      void message.payload;
    } catch (error) {
      PAYLOAD_FAILURES.push(error);
    }
    PAYLOAD_RAW_BODIES.push(message.body);
    // Recorded so the shared replay helper can locate this round uniformly.
    ROUNDS.push({ message, executionContext: resolveInvocationExecutionContext() });
  }
}

QueueHandler()(
  PayloadProbeConsumer.prototype,
  "probe",
  Object.getOwnPropertyDescriptor(PayloadProbeConsumer.prototype, "probe")!,
);
QueueMessage()(PayloadProbeConsumer.prototype, "probe", 0);

class ProbeModule {}

Module({ providers: [PayloadProbeConsumer] })(ProbeModule);

interface ReplayResult {
  readonly fixture: QueueInvocationFixture;
  readonly captured: CapturedRound;
  readonly resolved: unknown;
  readonly close: () => Promise<void>;
}

async function replay(
  name: string,
  module: typeof ConsumeModule = ConsumeModule,
): Promise<ReplayResult> {
  const fixture = await loadQueueFixture(name);
  const handler = createYandexHandler(module);
  const resolved = await handler(fixture.event, fixture.context);
  const captured = ROUNDS[ROUNDS.length - 1];
  if (!captured) {
    throw new Error(`fixture "${name}" produced no handler round`);
  }
  return {
    fixture,
    captured,
    resolved,
    close: () => handler.close(),
  };
}

const ALL_QUEUE_FIXTURE_NAMES = [
  "simple-text-message",
  "json-body-message",
  "unicode-body-message",
  "custom-message-attributes",
  "complete-metadata-and-system-attributes",
] as const;

describe("Message Queue conformance fixtures (issue #11)", () => {
  beforeEach(() => {
    ROUNDS.length = 0;
    PAYLOAD_FAILURES.length = 0;
    PAYLOAD_RAW_BODIES.length = 0;
    PAYLOAD_MESSAGE_IDS.length = 0;
  });

  afterEach(async () => {
    // Nothing to close here: each replay closes its own handler eagerly so
    // warm-state assertions below are attributable to explicit sequences.
  });

  it("replays every committed MQ fixture as a successful normalized delivery", async () => {
    expect(ALL_QUEUE_FIXTURE_NAMES).toHaveLength(5);
    for (const name of ALL_QUEUE_FIXTURE_NAMES) {
      const { resolved, close } = await replay(name);
      await close();

      // Success resolves to the normalized batch — never an HTTP envelope.
      expect(resolved).not.toHaveProperty("statusCode");
      expect(resolved).not.toHaveProperty("body");
      expect(resolved).not.toHaveProperty("isBase64Encoded");
      const batch = resolved as QueueBatch;
      expect(batch.messages).toHaveLength(1);
    }
    expect(ROUNDS).toHaveLength(ALL_QUEUE_FIXTURE_NAMES.length);
  });

  it("declares reconstructed provenance on every fixture", async () => {
    for (const name of ALL_QUEUE_FIXTURE_NAMES) {
      const fixture = await loadQueueFixture(name);
      // Machine-readable guard against provenance drift: these files are
      // reconstructions from captured evidence, never literal captures.
      expect(fixture.provenance.kind).toBe("reconstructed");
      expect(fixture.provenance.evidence).toBe("DATA-ANALYSE.md");
    }
  });

  it("preserves identity, checksums and opaque bodies of simple messages", async () => {
    const { fixture, captured, close } = await replay("simple-text-message");
    await close();

    const envelope = fixture.event.messages[0]!.details;
    const { message, executionContext } = captured;

    expect(message.messageId).toBe(envelope.message.message_id);
    expect(message.body).toBe(envelope.message.body);
    expect(envelope.message.body).not.toMatch(/^\s*[[{]/); // opaque, not pre-parsed
    expect(message.md5OfBody).toBe(envelope.message.md5_of_body);
    // Checksum integrity: md5 recomputed over the UTF-8 body bytes matches.
    expect(createUtf8Md5(envelope.message.body)).toBe(message.md5OfBody);
    // event_id and message_id are observed identical on the real trigger.
    expect(fixture.event.messages[0]!.event_metadata.event_id).toBe(message.messageId);
    expect(executionContext.awsRequestId).toBe(fixture.context.awsRequestId);
    // The raw escape hatch exposes the fixture envelope unchanged.
    expect((message.raw as { details?: unknown }).details).toBe(envelope);
  });

  it("keeps system attributes string-typed and ties created_at to SentTimestamp", async () => {
    const { fixture, captured, close } = await replay("complete-metadata-and-system-attributes");
    await close();

    const envelope = fixture.event.messages[0]!.details;
    const metadata = fixture.event.messages[0]!.event_metadata;
    const { message } = captured;

    // The observed system attribute NAME SET (DATA-ANALYSE.md section C).
    expect(Object.keys(message.attributes)).toEqual([
      "ApproximateFirstReceiveTimestamp",
      "ApproximateReceiveCount",
      "SenderId",
      "SentTimestamp",
    ]);
    for (const value of Object.values(message.attributes)) {
      expect(typeof value).toBe("string");
    }
    // Observed SenderId shape: "<sender-id>@as".
    expect(message.attributes.SenderId).toMatch(/^[0-9a-z]+@as$/);
    // Observed relation: ISO created_at equals the epoch-millisecond
    // SentTimestamp attribute; ApproximateReceiveCount starts at "1"
    // (observed constant across the capture dataset).
    expect(Number.parseInt(message.attributes.SentTimestamp!, 10)).toBe(
      Date.parse(metadata.created_at),
    );
    expect(message.attributes.ApproximateReceiveCount).toBe("1");
    expect(metadata.tracing_context).toBeNull();
    expect(message.eventMetadata.tracingContext).toBeNull();
    expect(message.eventMetadata.cloudId).toBe(metadata.cloud_id);
    expect(message.eventMetadata.folderId).toBe(metadata.folder_id);
    // No user attributes: the observed checksum placeholder is the empty string.
    expect(message.md5OfMessageAttributes).toBe("");
    expect(message.queueId).toBe(envelope.queue_id);
    expect(message.payload).toEqual(JSON.parse(envelope.message.body));
  });

  it("deserializes json bodies strictly and keeps unicode bodies byte-faithful", async () => {
    const json = await replay("json-body-message");
    await json.close();
    const jsonEnvelope = json.fixture.event.messages[0]!.details.message;
    // Opaque at the transport boundary: the body string passes through
    // unchanged; only payload access deserializes it.
    expect(json.captured.message.body).toBe(jsonEnvelope.body);
    expect(json.captured.message.payload).toEqual(JSON.parse(jsonEnvelope.body));

    const unicode = await replay("unicode-body-message");
    await unicode.close();
    const unicodeEnvelope = unicode.fixture.event.messages[0]!.details.message;
    const { message } = unicode.captured;
    expect(message.body).toBe(unicodeEnvelope.body);
    expect(message.payload).toEqual(JSON.parse(unicodeEnvelope.body));
    // md5_of_body is computed over the UTF-8 encoding of the body.
    expect(createUtf8Md5(unicodeEnvelope.body)).toBe(message.md5OfBody);
  });

  it("normalizes custom message attributes without coercing their values", async () => {
    const { fixture, captured, close } = await replay("custom-message-attributes");
    await close();

    const wireAttributes = fixture.event.messages[0]!.details.message.message_attributes;
    const wireNames = Object.keys(wireAttributes);
    expect(wireNames.length).toBeGreaterThan(1);
    const { message } = captured;

    // Normalization maps data_type/string_value -> dataType/stringValue for
    // every declared attribute, preserving values exactly as sent.
    for (const name of wireNames) {
      expect(message.messageAttributes[name]).toEqual({
        dataType: wireAttributes[name]!.data_type,
        stringValue: wireAttributes[name]!.string_value,
      });
      // No numeric coercion: a Number-typed attribute's string_value stays a
      // string ("1" must never become 1).
      expect(typeof message.messageAttributes[name]!.stringValue).toBe("string");
    }
    // User attributes present: the checksum is non-empty. Its exact value
    // follows an SQS-compatible algorithm (evidence level: inferred — see
    // fixtures/README.md), so only presence is pinned here.
    expect(message.md5OfMessageAttributes).toBeTruthy();
  });

  it("reports QUEUE_BODY_DESERIALIZATION_FAILED lazily for non-json bodies", async () => {
    const { fixture, close } = await replay("simple-text-message", ProbeModule);
    await close();

    expect(PAYLOAD_MESSAGE_IDS).toHaveLength(1);
    const failure = PAYLOAD_FAILURES[0];
    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as ConnectorError).code).toBe("QUEUE_BODY_DESERIALIZATION_FAILED");
    // The failing evaluation leaves the raw body intact for user code.
    expect(PAYLOAD_RAW_BODIES[0]).toBe(fixture.event.messages[0]!.details.message.body);
  });

  it("redacts the service-account token through context serialization", async () => {
    const { fixture, captured, close } = await replay("json-body-message");
    await close();

    // Whatever sanitized placeholder the fixture carries never leaks through
    // serialization; the redaction contract itself is fixed.
    expect(JSON.stringify(captured.executionContext)).not.toContain(String(fixture.context.token));
    expect(captured.executionContext.toJSON().token).toBe("REDACTED_TOKEN");
    // The undocumented _data mirror stays reachable and carries the fixture's
    // own (sanitized) event: structural mirror, not original runtime data.
    expect((captured.executionContext.raw as { _data?: unknown })._data).toEqual(fixture.event);
  });

  it("isolates sequential replays across warm invocations", async () => {
    const first = await replay("simple-text-message");
    const second = await replay("unicode-body-message");
    first.close();
    second.close();

    const [firstRound, secondRound] = [ROUNDS[0], ROUNDS[1]];
    expect(firstRound!.executionContext.awsRequestId).not.toBe(
      secondRound!.executionContext.awsRequestId,
    );
    // Invocation N's data must not leak into invocation N+1 (AGENTS.md 11).
    expect(secondRound!.executionContext.awsRequestId).toBe(second.fixture.context.awsRequestId);
    expect(secondRound!.message.messageId).not.toBe(firstRound!.message.messageId);
  });

  it("isolates concurrent replays of all fixtures", async () => {
    const results = await Promise.all(ALL_QUEUE_FIXTURE_NAMES.map((name) => replay(name)));
    await Promise.all(results.map((result) => result.close()));

    // Concurrent rounds interleave, so correlate by message id instead of
    // push order: every round must pair its own fixture's request id.
    const requestIdByMessageId = new Map(
      results.map((result) => [
        result.fixture.event.messages[0]!.details.message.message_id,
        result.fixture.context.awsRequestId,
      ]),
    );
    expect(requestIdByMessageId.size).toBe(results.length);
    expect(ROUNDS).toHaveLength(results.length);
    for (const round of ROUNDS) {
      expect(round.executionContext.awsRequestId).toBe(
        requestIdByMessageId.get(round.message.messageId),
      );
    }
  });
});

function createUtf8Md5(input: string): string {
  // Local re-computation keeps the assertion independent of any crypto helper
  // the connector might grow; Node guarantees this API.
  return createHash("md5").update(Buffer.from(input, "utf8")).digest("hex");
}
