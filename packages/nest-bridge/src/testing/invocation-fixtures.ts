import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawHttpApiGatewayV2Event } from "../http/raw-event";
import type { RawQueueEvent } from "../mq/raw-event";

/**
 * Test infrastructure (NOT part of the published package): loads the
 * sanitized conformance fixtures from `fixtures/` so specs can replay
 * invocations reconstructed from captured Yandex evidence through the public
 * connector API (issue #11).
 *
 * These fixtures are NOT literal captures: credentials, identities,
 * addresses, identifiers and timestamps are synthetic placeholders. What is
 * evidence-backed is the observed structure and behavior they encode.
 * Provenance rules and evidence levels: `fixtures/README.md`.
 */

/**
 * Machine-readable provenance stamp embedded in every fixture dump (fixture
 * envelope only — never inside `event`, which must keep the observed Yandex
 * shape untouched by synthetic metadata).
 */
export interface FixtureProvenance {
  /**
   * Declares that the file reconstructs observed behavior from captured
   * evidence rather than being a byte-for-byte capture of one invocation.
   */
  readonly kind: "reconstructed";
  /** Evidence base the reconstruction was distilled from. */
  readonly evidence: string;
}

/** One sanitized warm-invocation reconstruction as stored on disk. */
export interface InvocationFixture<TEvent> {
  /** Capture-window time of the scenario the fixture reconstructs. */
  readonly timestamp: string;
  /** Node.js runtime version observed for the captured dataset. */
  readonly node: string;
  /** Provenance stamp; {@link loadInvocationFixture} validates it on load. */
  readonly provenance: FixtureProvenance;
  /**
   * Sanitized reconstruction of the observed raw event shape: field names,
   * nesting and observed structures preserved; sensitive/identity values
   * substituted. Not a copy of any original invocation payload.
   */
  readonly event: TEvent;
  /**
   * Sanitized reconstruction of the Lambda-style runtime context, preserving
   * the observed field set including undocumented fields such as `_data` —
   * the runtime's deep copy of the event, mirrored here INSIDE the fixture
   * with the same sanitized values (it documents structure, not original
   * runtime data).
   */
  readonly context: Record<string, unknown>;
}

export type HttpInvocationFixture = InvocationFixture<RawHttpApiGatewayV2Event>;
export type QueueInvocationFixture = InvocationFixture<RawQueueEvent>;

const FIXTURES_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readDump(subdirectory: string, name: string): Promise<Record<string, unknown>> {
  const filePath = path.join(FIXTURES_ROOT, subdirectory, `${name}.json`);
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isPlainObject(parsed)) {
    throw new Error(`Fixture ${filePath} must contain a single JSON object.`);
  }
  return parsed;
}

/**
 * Shared load path: verifies the dump envelope and its provenance stamp
 * before narrowing. Fixtures are repository-controlled test data; full wire
 * validation stays the adapter's job under replay.
 */
async function loadInvocationFixture<TEvent>(
  subdirectory: string,
  name: string,
  describeTransportShape: (event: unknown) => void,
): Promise<InvocationFixture<TEvent>> {
  const dump = await readDump(subdirectory, name);
  const provenance: unknown = dump.provenance;
  if (
    !isPlainObject(provenance) ||
    provenance.kind !== "reconstructed" ||
    typeof provenance.evidence !== "string"
  ) {
    throw new Error(
      `Fixture "${name}" must declare provenance { kind: "reconstructed", evidence: string }; ` +
        "fixtures document reconstructed behavior, not literal captures.",
    );
  }
  describeTransportShape(dump.event);
  // Narrowing is repository-controlled: the transport discriminator was just
  // verified and the remaining envelope structure is fixed by the committed
  // dump format.
  return dump as unknown as InvocationFixture<TEvent>;
}

/**
 * Loads one HTTP/API Gateway v2 fixture by fixture name (file stem). The
 * `event.version === "2.0"` transport discriminator is verified here;
 * everything else is validated by the adapter under replay.
 */
export async function loadHttpFixture(name: string): Promise<HttpInvocationFixture> {
  return loadInvocationFixture<RawHttpApiGatewayV2Event>("http", name, (event) => {
    if (!isPlainObject(event) || event.version !== "2.0") {
      throw new Error(`HTTP fixture "${name}" does not carry event.version "2.0".`);
    }
  });
}

/**
 * Loads one Message Queue trigger fixture by fixture name (file stem). The
 * `messages` array is verified because it is the queue transport's detection
 * discriminator; everything else is validated by the adapter under replay.
 */
export async function loadQueueFixture(name: string): Promise<QueueInvocationFixture> {
  return loadInvocationFixture<RawQueueEvent>("mq", name, (event) => {
    if (!isPlainObject(event) || !Array.isArray(event.messages)) {
      throw new Error(`Queue fixture "${name}" does not contain an event.messages array.`);
    }
  });
}
