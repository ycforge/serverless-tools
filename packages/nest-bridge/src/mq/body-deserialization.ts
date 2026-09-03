import { ConnectorError } from "../core/connector-error";
import type { QueueBodyDeserializer, QueueMessage } from "./message";

/**
 * Body deserialization mechanics behind `QueueMessage.payload` (issue #9).
 *
 * Internal module — deliberately not part of the public export surface;
 * consumers configure behavior through `QueueBodyDeserializer`, never by
 * replacing this machinery.
 */

/**
 * Default policy (issue #9): strict JSON.
 *
 * - Valid JSON text (`object`/`array`/`string`/`number`/`boolean`/`null`)
 *   becomes exactly what `JSON.parse` produces — no reviver, no implicit
 *   coercion beyond normal JSON semantics (no Date revival, no numeric
 *   rewriting).
 * - Anything else (plain text, empty body, malformed JSON) fails
 *   deterministically with `QUEUE_BODY_DESERIALIZATION_FAILED`. The original
 *   `SyntaxError` is dropped on purpose: its message can quote body
 *   fragments, which must never reach boundary diagnostics.
 */
export const jsonBodyDeserializer: QueueBodyDeserializer = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw ConnectorError.queueBodyDeserializationFailed();
  }
};

/**
 * Outcome of one payload evaluation. A tagged union is required because a
 * custom deserializer may legitimately return `undefined`.
 */
type PayloadOutcome =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

/**
 * Builds the memoized read function backing one message's `payload` getter.
 *
 * Evaluation happens on first access (lazy), so bodies nobody reads are never
 * parsed and an invalid body cannot disturb normalization or handlers that
 * ignore it. The outcome — value OR thrown failure — is computed exactly once
 * per message instance and replayed afterwards: repeated accesses observe one
 * consistent payload across fan-out handlers of a round, custom strategies
 * with side effects run once, and failures rethrow the identical error.
 *
 * `getMessage` hands the strategy the fully built normalized message (the
 * getter is wired before the frozen instance exists, so the reference resolves
 * lazily); custom deserializers observe the same object consumers do.
 */
export function createPayloadReader(
  deserialize: QueueBodyDeserializer | undefined,
  body: string,
  getMessage: () => QueueMessage,
): () => unknown {
  // The effective strategy is resolved per message so transport-level
  // configuration cannot be swapped underneath a live delivery mid-batch.
  const strategy = deserialize ?? jsonBodyDeserializer;
  let outcome: PayloadOutcome | null = null;

  return (): unknown => {
    if (!outcome) {
      try {
        outcome = { ok: true, value: strategy(body, getMessage()) };
      } catch (error) {
        outcome = { ok: false, error };
      }
    }
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  };
}
