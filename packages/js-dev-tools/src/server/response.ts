import type { ServerResponse } from 'node:http';
import type { YandexFunctionHttpResponse } from '@ycforge/nestjs-connector';
import { redactSecrets } from './diagnostics';

const TRACE_HEADER = 'X-Trace-Id';

export function isYandexFunctionHttpResponse(
  value: unknown,
): value is YandexFunctionHttpResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.statusCode === 'number' &&
    typeof candidate.body === 'string' &&
    typeof candidate.isBase64Encoded === 'boolean' &&
    typeof candidate.headers === 'object' &&
    candidate.headers !== null
  );
}

/**
 * Maps a connector envelope to a real HTTP response (S-7, FR-021). Multi-value
 * headers (e.g. multiple Set-Cookie) are appended individually so Node writes
 * them as separate lines rather than comma-joining.
 */
export function applyEnvelope(
  res: ServerResponse,
  envelope: YandexFunctionHttpResponse,
  traceId: string,
): void {
  res.statusCode = envelope.statusCode;

  for (const [name, value] of Object.entries(envelope.headers)) {
    res.setHeader(name, value);
  }

  if (envelope.multiValueHeaders) {
    for (const [name, values] of Object.entries(envelope.multiValueHeaders)) {
      for (const value of values) {
        res.appendHeader(name, value);
      }
    }
  }

  res.setHeader(TRACE_HEADER, traceId);

  const rawBody = envelope.isBase64Encoded
    ? Buffer.from(envelope.body, 'base64')
    : envelope.body;
  res.end(rawBody);
}

/**
 * Writes a fatal error envelope (S-7, FR-022): JSON `{ error, message, trace_id }`.
 * The error message is sanitized via `redactSecrets` with the per-request
 * credential set so token/Authorization/Cookie values never leak.
 */
export function errorResponse(
  res: ServerResponse,
  statusCode: number,
  error: unknown,
  traceId: string,
  secrets: ReadonlyArray<string | undefined> = [],
): void {
  const name = error instanceof Error ? error.name : 'Error';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(rawMessage, secrets);

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(TRACE_HEADER, traceId);
  res.end(JSON.stringify({ error: name, message, trace_id: traceId }));
}