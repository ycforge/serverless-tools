import { ConnectorError } from "../core/connector-error";
import type { YcApiGatewayEvent } from "./yc-apigw-raw-event";

/**
 * Deep structural validation of an API Gateway `cloud_functions` (v1) event
 * after the HTTP transport claimed it (spec 036; docs/ARCHITECTURE.md
 * sections 4 and 6.3).
 *
 * `supports()` only answers the cheap discriminator question; this pass owns
 * the full observed-shape contract (evidence: 7 real gateway invocations
 * captured 2026-09-17, fixtures/http-apigw/).
 *
 * The contract is deliberately split into a strict core and a tolerant
 * optional layer (spec 036 FR-002/FR-003, clarify 2026-09-17):
 *
 * - The **core** fields are delivered by the gateway in every observed
 *   invocation: method, path, header/query maps, body and its encoding flag,
 *   plus the request context (identity, method, ids, timestamps). A violation
 *   means the payload was misidentified or Yandex changed its contract, and
 *   failing loudly beats flowing half-typed data into application code
 *   (AGENTS.md section 2.3).
 * - The **optional** fields (`url`, `multiValue*`, `params`, `pathParams`,
 *   `operationId`, anything additive) MAY legitimately be absent; absence is
 *   tolerated and normalized to `{}`/`""` by the adapter, never rejected.
 *
 * Diagnostics are strictly value-free: they name fields and expected types,
 * never header values, bodies, cookies or IPs — request payloads may carry
 * credentials and personal data (AGENTS.md section 6.2).
 */
export function validateYcApiGatewayEvent(rawEvent: unknown): YcApiGatewayEvent {
  const event = requireEventObject(rawEvent);

  requireString(event, "httpMethod");
  requireString(event, "path");
  requireStringRecord(event, "headers");
  requireStringRecord(event, "queryStringParameters");
  requireString(event, "body");
  requireBoolean(event, "isBase64Encoded");
  validateRequestContext(event.requestContext);

  // Optional layer: presence is validated, absence is tolerated. Type-only
  // guard keeps `YcApiGatewayEvent` typings honest for these optional fields.
  if (event.url !== undefined) {
    requireString(event, "url");
  }
  for (const field of ["multiValueHeaders", "multiValueQueryStringParameters"] as const) {
    if (event[field] !== undefined) {
      requireStringListRecord(event, field);
    }
  }
  for (const field of ["params", "pathParams"] as const) {
    if (event[field] !== undefined) {
      requireStringRecord(event, field);
    }
  }
  if (event.multiValueParams !== undefined) {
    requireStringListRecord(event, "multiValueParams");
  }
  if (event.operationId !== undefined) {
    requireString(event as Record<string, unknown>, "operationId");
  }

  return event;
}

function requireEventObject(rawEvent: unknown): YcApiGatewayEvent {
  if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
    throw invalid("expected a structured event object");
  }
  return rawEvent as YcApiGatewayEvent;
}

function validateRequestContext(requestContext: unknown): void {
  if (typeof requestContext !== "object" || requestContext === null) {
    throw invalid('expected field "requestContext" to be an object');
  }

  const source = requestContext as Record<string, unknown>;
  if (typeof source["httpMethod"] !== "string") {
    throw invalid('expected field "requestContext.httpMethod" to be a string');
  }
  if (typeof source["requestId"] !== "string") {
    throw invalid('expected field "requestContext.requestId" to be a string');
  }
  if (typeof source["requestTime"] !== "string") {
    throw invalid('expected field "requestContext.requestTime" to be a string');
  }
  if (typeof source["requestTimeEpoch"] !== "number") {
    throw invalid('expected field "requestContext.requestTimeEpoch" to be a number');
  }

  // The v1 gateway delivers client metadata in `identity` (not in a
  // `requestContext.http` block as the v2/ALB frame does) — observed.
  const identity = source["identity"];
  if (typeof identity !== "object" || identity === null) {
    throw invalid('expected field "requestContext.identity" to be an object');
  }
  const identitySource = identity as Record<string, unknown>;
  for (const field of ["sourceIp", "userAgent"] as const) {
    if (typeof identitySource[field] !== "string") {
      throw invalid(`expected field "requestContext.identity.${field}" to be a string`);
    }
  }
}

function requireString(source: Record<string, unknown>, field: string): void {
  if (typeof source[field] !== "string") {
    throw invalid(`expected field "${field}" to be a string`);
  }
}

function requireBoolean(source: Record<string, unknown>, field: string): void {
  if (typeof source[field] !== "boolean") {
    throw invalid(`expected field "${field}" to be a boolean`);
  }
}

function requireStringRecord(source: Record<string, unknown>, field: string): void {
  const value = source[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`expected field "${field}" to be an object`);
  }
  for (const entry of Object.values(value)) {
    if (typeof entry !== "string") {
      throw invalid(`expected every value of field "${field}" to be a string`);
    }
  }
}

/** Optional multi-value fields keep repeated values as lists (observed). */
function requireStringListRecord(source: Record<string, unknown>, field: string): void {
  const value = source[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`expected field "${field}" to be an object`);
  }
  for (const values of Object.values(value)) {
    if (!Array.isArray(values) || values.some((entry) => typeof entry !== "string")) {
      throw invalid(`expected every value of field "${field}" to be a string array`);
    }
  }
}

/** Value-free boundary failure carrying the claiming transport id. */
function invalid(reason: string): ConnectorError {
  return ConnectorError.invalidInvocationEvent("http", reason);
}