/**
 * Value redaction for log records (spec 004, FR-009/014; AGENTS.md §6.2).
 *
 * The connector must never place credentials or client-sensitive data into
 * logs: the IAM `token`, authorization/cookie header values and the raw
 * payloads (`raw`/`rawEvent`) are replaced with a redaction placeholder. The
 * same redactor backs both boundary records (FR-009) and user-supplied
 * `context` objects passed to the `YandexLogger` provider (FR-014), keeping
 * the redaction policy in exactly one place.
 */

/** Placeholder matched by the context `toJSON()` redaction convention. */
export const REDACTED_VALUE = "REDACTED_TOKEN";

/** Secret-bearing keys, matched case-insensitively (headers are lower-cased). */
const SECRET_KEYS = new Set(["token", "authorization", "cookie", "raw", "rawevent"]);

/**
 * Recursively redacts secret-bearing values.
 *
 * Recognized secret keys are replaced by {@link REDACTED_VALUE} regardless of
 * nesting depth. Arrays are mapped element-wise; plain objects are walked
 * producing a new object (inputs are never mutated). Primitives pass through
 * untouched. Cyclic user objects are not expected — application `context`
 * values are data, not graphs; a `"circular"` error would surface at the
 * provider call site and stay fail-open via the writer.
 */
export function redactForLogging(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactForLogging);
  }
  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED_VALUE : redactForLogging(item);
    }
    return redacted;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}