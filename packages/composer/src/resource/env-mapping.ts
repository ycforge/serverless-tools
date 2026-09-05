import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, parseDocument } from 'yaml';

import { ResourceRefError } from './errors.js';
import { DOMAIN_PROPERTIES, RESOURCE_DOMAINS } from './types.js';
import type { EnvMapping, ResourceDomain, ResourceIndex } from './types.js';

const EMPTY_ENV_MAPPING: EnvMapping = Object.freeze({
  entries: Object.freeze(new Map<string, ReadonlyMap<string, ReadonlyMap<string, string>>>()),
  getEnvVar: () => undefined,
  hasEntry: () => false,
});

export function emptyEnvMapping(): EnvMapping {
  return EMPTY_ENV_MAPPING;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pure, deterministic parse of an `.ycsf/env.yaml` text document against a `ResourceIndex`. */
export function parseEnvMapping(text: string, filePath: string, index: ResourceIndex): EnvMapping {
  const doc = parseDocument(text, { uniqueKeys: false });
  const firstError = doc.errors[0];
  if (firstError !== undefined) {
    throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
  }
  if (!isMap(doc.contents)) {
    throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
  }

  const raw = doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown>;

  if (raw['version'] !== 1) {
    throw new ResourceRefError('RESOURCE_REF_VERSION_UNSUPPORTED', {
      filePath,
      version: String(raw['version']),
    });
  }

  const entries = new Map<string, Map<string, Map<string, string>>>();

  for (const [domainKey, domainValueRaw] of Object.entries(raw)) {
    if (domainKey === 'version') {
      continue;
    }
    if (!RESOURCE_DOMAINS.includes(domainKey as ResourceDomain)) {
      throw new ResourceRefError('RESOURCE_REF_DOMAIN_UNKNOWN', { domain: domainKey, filePath });
    }
    const domain = domainKey as ResourceDomain;
    if (!isRecord(domainValueRaw)) {
      throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
    }

    const allowedProperties = DOMAIN_PROPERTIES.get(domain);
    const names = new Map<string, Map<string, string>>();
    for (const [name, nameValueRaw] of Object.entries(domainValueRaw)) {
      if (!isRecord(nameValueRaw)) {
        throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
      }
      const props = new Map<string, string>();
      for (const [property, leafRaw] of Object.entries(nameValueRaw)) {
        if (!isRecord(leafRaw)) {
          throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
        }
        if ('default' in leafRaw && leafRaw.default !== undefined) {
          throw new ResourceRefError('RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED', {
            domain,
            name,
            property,
          });
        }
        if (!('env' in leafRaw)) {
          throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
        }
        const envVar = leafRaw.env;
        if (typeof envVar !== 'string' || envVar.length === 0) {
          throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
        }
        if (allowedProperties !== undefined && !allowedProperties.has(property)) {
          throw new ResourceRefError('RESOURCE_REF_ENV_UNDECLARED_RESOURCE', {
            domain,
            name,
            property,
          });
        }
        if (!index.has(domain, name) || !index.validateProperty(domain, name, property)) {
          throw new ResourceRefError('RESOURCE_REF_ENV_UNDECLARED_RESOURCE', {
            domain,
            name,
            property,
          });
        }
        props.set(property, envVar);
      }
      names.set(name, props);
    }
    entries.set(domain, names);
  }

  const frozen: EnvMapping = {
    entries: Object.freeze(
      new Map<string, ReadonlyMap<string, ReadonlyMap<string, string>>>(
        Array.from(entries, ([domain, names]) => [
          domain,
          Object.freeze(
            new Map<string, ReadonlyMap<string, string>>(
              Array.from(names, ([name, props]) => [
                name,
                Object.freeze(new Map(props)) as ReadonlyMap<string, string>,
              ]),
            ),
          ) as ReadonlyMap<string, ReadonlyMap<string, string>>,
        ]),
      ),
    ) as ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, string>>>,
    getEnvVar(domain: string, name: string, property: string): string | undefined {
      return entries.get(domain)?.get(name)?.get(property);
    },
    hasEntry(domain: string, name: string, property: string): boolean {
      return entries.get(domain)?.get(name)?.has(property) ?? false;
    },
  };
  return Object.freeze(frozen);
}

/** Reads `<compositionRoot>/.ycsf/env.yaml` validated against `index`; absent file → empty mapping. */
export async function loadEnvMapping(
  compositionRoot: string,
  index: ResourceIndex,
): Promise<EnvMapping> {
  const filePath = join(compositionRoot, '.ycsf', 'env.yaml');
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_ENV_MAPPING;
    }
    throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
  }
  return parseEnvMapping(text, filePath, index);
}
