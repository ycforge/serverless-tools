import type { OpenApiDocument } from '../errors.js';
import type { AuthYamlDocument } from './types.js';
import { AuthConfigError } from './auth-errors.js';

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

export interface SecurityEntry {
  route: string;
  schemeName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectFrom(entries: SecurityEntry[], securityValue: unknown, route: string): void {
  if (!Array.isArray(securityValue)) {
    return;
  }
  for (const requirement of securityValue) {
    if (!isRecord(requirement)) {
      continue;
    }
    for (const schemeName of Object.keys(requirement)) {
      entries.push({ route, schemeName });
    }
  }
}

export function collectSecurityEntries(openApi: OpenApiDocument): readonly SecurityEntry[] {
  const entries: SecurityEntry[] = [];
  collectFrom(entries, openApi.security, 'root');
  const paths = openApi.paths;
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      if (!isRecord(operation)) {
        continue;
      }
      collectFrom(entries, operation.security, `${method.toUpperCase()} ${path}`);
    }
  }
  return entries;
}

export function validateSecurityReferences(
  openApi: OpenApiDocument,
  authYaml: AuthYamlDocument,
): void {
  const schemes = authYaml.schemes;
  for (const entry of collectSecurityEntries(openApi)) {
    if (!(entry.schemeName in schemes)) {
      throw new AuthConfigError('AUTH_SECURITY_UNDECLARED', {
        schemeName: entry.schemeName,
        route: entry.route,
      });
    }
    if (entry.schemeName === 'public') {
      throw new AuthConfigError('AUTH_SECURITY_PUBLIC_VIOLATION', { route: entry.route });
    }
  }
}