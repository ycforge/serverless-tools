import type { IncomingMessage } from 'node:http';
import type { RawHttpApiGatewayV2Event } from '@ycforge/nestjs-connector';

// DEVIATION from platform: R-10 fidelity deviations documented in
// specs/023-local-dev-server/research.md §R-10 and quickstart.md Sc11.
// Reconcile at /speckit.converge.

const LOOPBACK_IP = '127.0.0.1';

const CLF_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Splits a request URL into path and query string, leaving percent-encoding
 * untouched (US2-SC6, FR-010). A missing query yields `""` so the gateway
 * `requestContext.http.path` keeps its trailing `?` like the platform (R-3#5).
 */
function splitUrl(url: string | undefined): { rawPath: string; rawQueryString: string } {
  if (url === undefined) {
    return { rawPath: '', rawQueryString: '' };
  }
  const question = url.indexOf('?');
  if (question === -1) {
    return { rawPath: url, rawQueryString: '' };
  }
  return { rawPath: url.slice(0, question), rawQueryString: url.slice(question + 1) };
}

/** Original-case header names, duplicates comma-joined without a space (FR-011, R-8). */
function buildHeaders(rawHeaders: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name === undefined || value === undefined) {
      break;
    }
    const existing = headers[name];
    headers[name] = existing === undefined ? value : `${existing},${value}`;
  }
  return headers;
}

function readHeader(headers: Record<string, string>, wanted: string): string | undefined {
  const lower = wanted.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function decodeForm(segment: string): string {
  const plusDecoded = segment.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plusDecoded);
  } catch {
    // Broken escape (US2): keep the raw form-decoded value instead of failing.
    return plusDecoded;
  }
}

/** Form-decoded query parameters; repeated keys join with `,` (fr-012, R-8). */
export function parseRawQuery(query: string): {
  values: Record<string, string>;
  multi: Record<string, string[]>;
} {
  const multi: Record<string, string[]> = {};
  for (const segment of query.split('&')) {
    if (segment === '') {
      continue;
    }
    const eq = segment.indexOf('=');
    const rawKey = eq === -1 ? segment : segment.slice(0, eq);
    const rawValue = eq === -1 ? '' : segment.slice(eq + 1);
    const key = decodeForm(rawKey);
    const value = decodeForm(rawValue);
    const bucket = multi[key] ??= [];
    bucket.push(value);
  }
  const values: Record<string, string> = {};
  for (const key of Object.keys(multi)) {
    values[key] = multi[key]!.join(',');
  }
  return { values, multi };
}

const utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : undefined;

function isUtf8(buffer: Buffer, start: number, end: number): boolean {
  try {
    const view = buffer.subarray(start, end) as Uint8Array;
    utf8Decoder?.decode(view);
    return true;
  } catch {
    return false;
  }
}

/** Body encoding (A-11, FR-014): empty/text → UTF-8, else base64. */
export function encodeBody(
  buffer: Buffer,
  contentType?: string,
): { body: string; isBase64Encoded: boolean } {
  if (buffer.length === 0) {
    return { body: '', isBase64Encoded: false };
  }
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  if (
    (mediaType !== undefined && mediaType.startsWith('text/')) ||
    mediaType === 'application/json' ||
    mediaType === 'application/x-www-form-urlencoded'
  ) {
    return { body: buffer.toString('utf8'), isBase64Encoded: false };
  }
  if (isUtf8(buffer, 0, buffer.length)) {
    return { body: buffer.toString('utf8'), isBase64Encoded: false };
  }
  return { body: buffer.toString('base64'), isBase64Encoded: true };
}

/** Apache Common Log Format timestamp in UTC (R-9). */
export function toClfTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const month = CLF_MONTHS[date.getUTCMonth()] ?? 'Jan';
  return (
    `${pad(date.getUTCDate())}/${month}/${date.getUTCFullYear()}` +
    `:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

export interface BuildEventOptions {
  readonly requestId: string;
}

/**
 * Synthesizes a gateway v2 event from one node:http request (S-5, FR-010..015).
 * The path is deliberately NOT decoded and `requestContext.http.path` keeps the
 * `rawPath + '?' + rawQueryString` form of the platform (R-10 documented
 * deviation, quickstart Sc11).
 */
export function buildGatewayV2Event(
  req: IncomingMessage,
  body: Buffer,
  options: BuildEventOptions,
): RawHttpApiGatewayV2Event {
  const { rawPath, rawQueryString } = splitUrl(req.url);
  const headers = buildHeaders(req.rawHeaders);
  const parsedQuery = parseRawQuery(rawQueryString);
  const contentType = readHeader(headers, 'content-type');
  const encoded = encodeBody(body, contentType);
  const sourceIp = readHeader(headers, 'x-forwarded-for')?.split(',')[0]?.trim() ?? LOOPBACK_IP;
  const userAgent = readHeader(headers, 'user-agent') ?? '';
  const now = new Date();

  return {
    version: '2.0',
    rawPath,
    rawQueryString,
    headers,
    queryStringParameters: parsedQuery.values,
    multiValueParameters: parsedQuery.multi,
    pathParameters: {},
    parameters: {},
    operationId: '',
    body: encoded.body,
    isBase64Encoded: encoded.isBase64Encoded,
    requestContext: {
      authorizer: {},
      http: {
        method: (req.method ?? 'GET').toUpperCase(),
        path: `${rawPath}?${rawQueryString}`,
        sourceIp,
        userAgent,
      },
      requestId: options.requestId,
      time: toClfTime(now),
      timeEpoch: Math.floor(now.getTime() / 1000),
      apiGateway: { operationContext: {} },
    },
  };
}