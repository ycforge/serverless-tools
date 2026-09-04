import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseDocument,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  type YAMLParseError,
} from 'yaml';
import { AuthConfigError } from './auth-errors.js';

export interface RawAuthScheme {
  type?: unknown;
  [key: string]: unknown;
}

export type ParsedFunctionScheme = { type: 'function'; function: string };
export type ParsedAuthScheme =
  | { type: 'none' }
  | { type: 'jwt'; jwksUri: string; issuer: string; audience: string | readonly string[] }
  | ParsedFunctionScheme;

export interface ParsedAuthYamlDocument {
  version: 1;
  defaultScheme: string;
  schemes: Readonly<Record<string, ParsedAuthScheme>>;
}

export interface LoadedAuthYaml {
  text: string;
  sourcePath: string;
}

export type SchemeFieldValidator = (
  raw: RawAuthScheme,
  schemeName: string,
) => ParsedAuthScheme;

function requireNonEmptyString(raw: RawAuthScheme, schemeName: string, field: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value === '') {
    throw new AuthConfigError('AUTH_MISSING_FIELD', { schemeName, field });
  }
  return value;
}

function requireAudience(raw: RawAuthScheme, schemeName: string): string | readonly string[] {
  const value = raw.audience;
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
    return value;
  }
  throw new AuthConfigError('AUTH_MISSING_FIELD', { schemeName, field: 'audience' });
}

function validateNoneFields(): ParsedAuthScheme {
  return { type: 'none' };
}

function validateJwtFields(raw: RawAuthScheme, schemeName: string): ParsedAuthScheme {
  const jwksUri = requireNonEmptyString(raw, schemeName, 'jwksUri');
  const issuer = requireNonEmptyString(raw, schemeName, 'issuer');
  const audience = requireAudience(raw, schemeName);
  return { type: 'jwt', jwksUri, issuer, audience };
}

function validateFunctionFields(raw: RawAuthScheme, schemeName: string): ParsedAuthScheme {
  const functionRef = requireNonEmptyString(raw, schemeName, 'function');
  return { type: 'function', function: functionRef };
}

export const DEFAULT_SCHEME_VALIDATORS: Readonly<Record<string, SchemeFieldValidator>> = {
  none: validateNoneFields,
  jwt: validateJwtFields,
  function: validateFunctionFields,
};

export async function loadAuthYaml(appRoot: string): Promise<LoadedAuthYaml> {
  const sourcePath = join(appRoot, 'auth.yaml');
  try {
    const text = await readFile(sourcePath, 'utf8');
    return { text, sourcePath };
  } catch (error) {
    throw new AuthConfigError('AUTH_FILE_MISSING', { path: sourcePath, cause: error });
  }
}

interface DuplicateKeyFound {
  mapPath: string[];
  key: string;
  keyPath: string;
}

function findFirstDuplicateKey(node: unknown, prefix: readonly string[]): DuplicateKeyFound | null {
  if (isMap(node)) {
    const seen = new Set<string>();
    for (const item of node.items) {
      if (isScalar(item.key)) {
        const key = String(item.key.value);
        if (seen.has(key)) {
          return { mapPath: [...prefix], key, keyPath: [...prefix, key].join('.') };
        }
        seen.add(key);
      }
    }
    for (const item of node.items) {
      const key = isScalar(item.key) ? String(item.key.value) : '';
      const childPrefix = key === '' ? prefix : [...prefix, key];
      const found = findFirstDuplicateKey(item.value, childPrefix);
      if (found) {
        return found;
      }
    }
  } else if (isSeq(node)) {
    for (let index = 0; index < node.items.length; index += 1) {
      const found = findFirstDuplicateKey(node.items[index], [...prefix, String(index)]);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTypeName(rawScheme: unknown): string | undefined {
  if (!isRecord(rawScheme)) {
    return undefined;
  }
  return typeof rawScheme.type === 'string' ? rawScheme.type : undefined;
}

function validateSchemes(
  rawSchemes: Record<string, unknown>,
  sourcePath: string,
  validators: Readonly<Record<string, SchemeFieldValidator>>,
): Readonly<Record<string, ParsedAuthScheme>> {
  const schemes: Record<string, ParsedAuthScheme> = {};
  for (const schemeName of Object.keys(rawSchemes)) {
    if (schemeName === '') {
      throw new AuthConfigError('AUTH_FILE_INVALID_YAML', { path: sourcePath });
    }
    const rawScheme = rawSchemes[schemeName];
    const typeName = extractTypeName(rawScheme);
    const validator = typeName === undefined ? undefined : validators[typeName];
    if (!validator) {
      throw new AuthConfigError('AUTH_UNKNOWN_SCHEME_TYPE', { schemeName, type: typeName });
    }
    schemes[schemeName] = validator(rawScheme as RawAuthScheme, schemeName);
  }
  return schemes;
}

export function parseAuthYaml(
  text: string,
  sourcePath: string,
  validators: Readonly<Record<string, SchemeFieldValidator>> = DEFAULT_SCHEME_VALIDATORS,
): ParsedAuthYamlDocument {
  const doc = parseDocument(text, { uniqueKeys: true });
  const firstError = doc.errors[0] as YAMLParseError | undefined;
  if (firstError) {
    if (firstError.code === 'DUPLICATE_KEY') {
      const duplicate = findFirstDuplicateKey(doc.contents, []);
      if (duplicate) {
        if (duplicate.mapPath.join('.') === 'schemes') {
          throw new AuthConfigError('AUTH_DUPLICATE_SCHEME', { schemeName: duplicate.key });
        }
        throw new AuthConfigError('AUTH_DUPLICATE_KEY', { keyPath: duplicate.keyPath });
      }
    }
    throw new AuthConfigError('AUTH_FILE_INVALID_YAML', { path: sourcePath });
  }

  if (!isMap(doc.contents) || isAlias(doc.contents)) {
    throw new AuthConfigError('AUTH_FILE_INVALID_YAML', { path: sourcePath });
  }

  const raw = doc.toJS() as Record<string, unknown>;

  if (raw.version !== 1) {
    throw new AuthConfigError('AUTH_VERSION_UNSUPPORTED', { field: 'version' });
  }

  const defaultScheme = raw.defaultScheme;
  if (typeof defaultScheme !== 'string' || defaultScheme === '') {
    throw new AuthConfigError('AUTH_DEFAULT_MISSING', { field: 'defaultScheme' });
  }

  const rawSchemes = raw.schemes;
  if (rawSchemes === undefined || rawSchemes === null) {
    throw new AuthConfigError('AUTH_SCHEMES_EMPTY', { field: 'schemes' });
  }
  if (!isRecord(rawSchemes)) {
    throw new AuthConfigError('AUTH_SCHEMES_NOT_MAP', { field: 'schemes' });
  }
  if (Object.keys(rawSchemes).length === 0) {
    throw new AuthConfigError('AUTH_SCHEMES_EMPTY', { field: 'schemes' });
  }
  if (!(defaultScheme in rawSchemes)) {
    throw new AuthConfigError('AUTH_DEFAULT_UNRESOLVED', { schemeName: defaultScheme });
  }

  const schemes = validateSchemes(rawSchemes, sourcePath, validators);
  return { version: 1, defaultScheme, schemes };
}