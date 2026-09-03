import { ConnectorError } from "../core/connector-error";
import type { RawHttpApiGatewayV2Event } from "./raw-event";

/**
 * Deep structural validation of an API Gateway v2 event after the HTTP
 * transport claimed it (docs/ARCHITECTURE.md sections 4 and 6.3).
 *
 * `supports()` only answers the cheap discriminator question; this pass owns
 * the full observed-shape contract (AGENTS.md section 4.1, DATA-ANALYSE.md
 * section B). Every field the gateway delivered in 46/46 captured invocations
 * must be present with its observed type: a violation means the payload was
 * misidentified or Yandex changed its contract, and failing loudly beats
 * flowing half-typed data into application code (AGENTS.md section 2.3).
 *
 * Diagnostics are strictly value-free: they name fields and expected types,
 * never header values, bodies, cookies or IPs — request payloads may carry
 * credentials and personal data (AGENTS.md section 6.2).
 */
export function validateHttpApiGatewayV2Event(rawEvent: unknown): RawHttpApiGatewayV2Event {
  const event = requireEventObject(rawEvent);

  requireString(event, "rawPath");
  requireString(event, "rawQueryString");
  requireStringRecord(event, "headers");
  requireStringRecord(event, "queryStringParameters");
  validateRequestContext(event.requestContext);
  requireString(event, "body");
  requireBoolean(event, "isBase64Encoded");
  requireStringRecord(event, "pathParameters");
  requireStringRecord(event, "parameters");
  requireMultiValueParameters(event.multiValueParameters);
  requireString(event, "operationId");

  return event;
}

function requireEventObject(rawEvent: unknown): RawHttpApiGatewayV2Event {
  if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
    throw invalid("expected a structured event object");
  }
  return rawEvent as RawHttpApiGatewayV2Event;
}

function validateRequestContext(requestContext: unknown): void {
  if (typeof requestContext !== "object" || requestContext === null) {
    throw invalid('expected field "requestContext" to be an object');
  }

  const source = requestContext as Record<string, unknown>;
  if (typeof source["authorizer"] !== "object" || source["authorizer"] === null) {
    throw invalid('expected field "requestContext.authorizer" to be an object');
  }

  const http = source["http"];
  if (typeof http !== "object" || http === null) {
    throw invalid('expected field "requestContext.http" to be an object');
  }
  const httpSource = http as Record<string, unknown>;
  for (const field of ["method", "path", "sourceIp", "userAgent"] as const) {
    if (typeof httpSource[field] !== "string") {
      throw invalid(`expected field "requestContext.http.${field}" to be a string`);
    }
  }

  if (typeof source["requestId"] !== "string") {
    throw invalid('expected field "requestContext.requestId" to be a string');
  }
  if (typeof source["time"] !== "string") {
    throw invalid('expected field "requestContext.time" to be a string');
  }
  if (typeof source["timeEpoch"] !== "number") {
    throw invalid('expected field "requestContext.timeEpoch" to be a number');
  }

  // Observed as present-but-empty without an authorizer configuration; when
  // present it is an object, absence itself is tolerated for forward
  // compatibility (AGENTS.md section 36).
  const apiGateway = source["apiGateway"];
  if (apiGateway !== undefined && (typeof apiGateway !== "object" || apiGateway === null)) {
    throw invalid('expected field "requestContext.apiGateway" to be an object when present');
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

/**
 * `multiValueParameters` keeps repeated values as lists (observed); anything
 * but a record of string arrays breaks that representation.
 */
function requireMultiValueParameters(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid('expected field "multiValueParameters" to be an object');
  }
  for (const values of Object.values(value)) {
    if (!Array.isArray(values) || values.some((entry) => typeof entry !== "string")) {
      throw invalid('expected every value of field "multiValueParameters" to be a string array');
    }
  }
}

/** Value-free boundary failure carrying the claiming transport id. */
function invalid(reason: string): ConnectorError {
  return ConnectorError.invalidInvocationEvent("http", reason);
}
