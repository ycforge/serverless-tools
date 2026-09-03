import { ConnectorError } from "./connector-error";
import type { TransportAdapter } from "./transport";

/** Upper bound for field names echoed into unknown-event diagnostics. */
const MAX_DIAGNOSTIC_FIELD_NAMES = 20;

/**
 * Transport detection boundary of the core runtime (docs/ARCHITECTURE.md
 * section 4).
 *
 * Runs exactly once per invocation: adapters are consulted in their fixed
 * registration order and the first `supports()` claim wins exclusively.
 * `supports()` is trusted to honor its cheap, non-throwing SPI contract
 * (`src/core/transport.ts`); a violation is an internal programming error
 * and is deliberately not masked here.
 *
 * Unclaimed events never fall through silently: they fail with
 * {@link ConnectorError} code `UNKNOWN_INVOCATION_EVENT`.
 */
export function detectTransport(
  transports: readonly TransportAdapter[],
  rawEvent: unknown,
): TransportAdapter {
  for (const transport of transports) {
    if (transport.supports(rawEvent)) {
      return transport;
    }
  }

  throw ConnectorError.unknownInvocationEvent(describeUnclaimedEvent(rawEvent));
}

/**
 * Builds a value-free structural description of an event no transport
 * claimed. Field NAMES and value kinds only — payload values may contain
 * credentials or client data and are never included (AGENTS.md section 6).
 */
function describeUnclaimedEvent(rawEvent: unknown): string {
  if (rawEvent === null) {
    return "received null instead of a structured event object";
  }

  if (Array.isArray(rawEvent)) {
    return "received an array instead of a structured event object";
  }

  if (typeof rawEvent !== "object") {
    return `received ${typeof rawEvent} instead of a structured event object`;
  }

  const fieldNames = Object.keys(rawEvent).sort();
  if (fieldNames.length === 0) {
    return "received a structured event object without any top-level fields";
  }

  const shown = fieldNames.slice(0, MAX_DIAGNOSTIC_FIELD_NAMES);
  const overflow = fieldNames.length - shown.length;
  const suffix = overflow > 0 ? `, … (+${overflow} more)` : "";
  return `top-level fields: ${shown.join(", ")}${suffix}`;
}
