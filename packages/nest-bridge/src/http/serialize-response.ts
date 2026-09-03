import type { YandexFunctionHttpResponse } from "./response";
import type { YandexHttpResponseFacade } from "./response-facade";

/**
 * Serializes the per-invocation response state into the wire envelope the
 * function runtime expects (issue #6).
 *
 * This module owns exactly one transport policy: **body encoding**. Text goes
 * out plain; binary goes out Base64 with `isBase64Encoded` set, because
 * binary data must never be corrupted by string coercion through the gateway
 * (AGENTS.md section 4.4). Content types are deliberately NOT defaulted here
 * — that policy lives at payload-write time in `response-facade.ts`, so an
 * explicit handler decision always wins and the rule exists in one place.
 */
export function serializeResponse(facade: YandexHttpResponseFacade): YandexFunctionHttpResponse {
  const payload = facade.bodyPayload;

  let body: string;
  let isBase64Encoded = false;

  if (payload === undefined || payload === null) {
    body = "";
  } else if (Buffer.isBuffer(payload)) {
    body = payload.toString("base64");
    isBase64Encoded = true;
  } else {
    body = payload;
  }

  const headers: Record<string, string> = {};
  const multiValueHeaders: Record<string, string[]> = {};
  for (const entry of facade.headerEntries) {
    if (entry.values.length === 1) {
      headers[entry.name] = entry.values[0]!;
      continue;
    }
    // Repeated values cannot live in the flat map without being joined
    // lossily (a comma is legal inside Set-Cookie attributes), so they move
    // to the multi-value field; per the platform docs a header present there
    // overrides the flat map, so the name stays out of it.
    multiValueHeaders[entry.name] = [...entry.values];
  }

  return isMultiValueHeadersEmpty(multiValueHeaders)
    ? deepFreezeEnvelope({
        statusCode: facade.statusCode,
        headers,
        body,
        isBase64Encoded,
      })
    : deepFreezeEnvelope({
        statusCode: facade.statusCode,
        headers,
        multiValueHeaders,
        body,
        isBase64Encoded,
      });
}

function isMultiValueHeadersEmpty(multiValueHeaders: Record<string, string[]>): boolean {
  return Object.keys(multiValueHeaders).length === 0;
}

/**
 * Freezes the envelope so nothing downstream can mutate an invocation's
 * response after it left the adapter (warm-environment discipline,
 * AGENTS.md section 11).
 */
function deepFreezeEnvelope(
  envelope: YandexFunctionHttpResponse & {
    readonly multiValueHeaders?: Readonly<Record<string, readonly string[]>>;
  },
): YandexFunctionHttpResponse {
  Object.freeze(envelope.headers);
  if (envelope.multiValueHeaders !== undefined) {
    for (const values of Object.values(envelope.multiValueHeaders)) {
      Object.freeze(values);
    }
    Object.freeze(envelope.multiValueHeaders);
  }
  return envelope;
}
