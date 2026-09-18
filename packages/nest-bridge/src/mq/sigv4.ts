import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 signer (spec 005/037) for Yandex Message
 * Queue's SQS-compatible API.
 *
 * YMQ accepts only SigV4 authorization with a static access key; IAM bearer
 * tokens are rejected ("Invalid authorization parameters structure"), and the
 * metadata service exposes only IAM tokens — so a function must be given a
 * static key to publish to a queue (options or environment).
 *
 * Implemented with `node:crypto` only: no AWS SDK dependency is added to the
 * thin runtime adapter (Project A).
 */

export interface SigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface SigV4Request {
  readonly method: string;
  /** Absolute request URL; path + query are canonicalized. */
  readonly url: string;
  readonly region: string;
  readonly service: string;
  readonly credentials: SigV4Credentials;
  /** Extra headers to include in the signature (lowercase names). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request body used for the payload hash (default: empty). */
  readonly body?: string;
  /** Injectable clock for deterministic tests. */
  readonly now?: Date;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/** Canonical URI: each path segment URI-encoded, slashes preserved. */
function canonicalUri(pathname: string): string {
  if (pathname === "" || pathname === "/") {
    return "/";
  }
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Canonical query: sorted `k=v` pairs, values URI-encoded. */
function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of searchParams.entries()) {
    pairs.push([key, value]);
  }
  pairs.sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    if (aValue !== bValue) return aValue < bValue ? -1 : 1;
    return 0;
  });
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function signSigV4(request: SigV4Request): Record<string, string> {
  const url = new URL(request.url);
  const { amzDate, dateStamp } = amzDates(request.now ?? new Date());
  const payloadHash = sha256Hex(request.body ?? "");

  const headers: Record<string, string> = {
    ...(request.headers ?? {}),
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${request.credentials.secretAccessKey}`, dateStamp), request.region), request.service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${request.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
