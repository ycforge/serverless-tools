import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, isScalar, parseDocument, type YAMLMap } from 'yaml';

import { ResourceRefError } from './errors.js';
import { DOMAIN_PROPERTIES, RESOURCE_DOMAINS } from './types.js';
import type { ResourceDomain, ResourceIndex } from './types.js';

const EMPTY_RESOURCE_INDEX: ResourceIndex = Object.freeze({
  domains: Object.freeze(new Set<ResourceDomain>()),
  resources: Object.freeze(new Map<string, ReadonlyMap<string, ReadonlySet<string>>>()),
  entries: Object.freeze(new Map<ResourceDomain, ReadonlyMap<string, ReadonlySet<string>>>()),
  has: () => false,
  getProperties: () => undefined,
  validateProperty: () => false,
  isValidProperty: () => false,
});

export function emptyResourceIndex(): ResourceIndex {
  return EMPTY_RESOURCE_INDEX;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarKeyOf(node: unknown): string | undefined {
  if (isScalar(node)) {
    return typeof node.value === 'string' ? node.value : undefined;
  }
  return undefined;
}

function firstDuplicateKey(map: YAMLMap): string | undefined {
  const seen = new Set<string>();
  for (const item of map.items) {
    const key = scalarKeyOf(item.key);
    if (key === undefined) {
      continue;
    }
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return undefined;
}

function findIdentityCollision(
  contents: YAMLMap,
): { domain?: string; name: string } | undefined {
  const dupDomain = firstDuplicateKey(contents);
  if (dupDomain !== undefined) {
    return { name: dupDomain };
  }
  for (const item of contents.items) {
    const domainKey = scalarKeyOf(item.key);
    if (domainKey === undefined || domainKey === 'version') {
      continue;
    }
    if (isMap(item.value)) {
      const dupName = firstDuplicateKey(item.value);
      if (dupName !== undefined) {
        return { domain: domainKey, name: dupName };
      }
    }
  }
  return undefined;
}

function buildIndex(
  entries: Map<ResourceDomain, Map<string, Set<string>>>,
): ResourceIndex {
  const domains = new Set<ResourceDomain>();
  const layers = new Map<ResourceDomain, ReadonlyMap<string, ReadonlySet<string>>>();

  for (const [domain, names] of entries) {
    domains.add(domain);
    const frozenNames = new Map<string, ReadonlySet<string>>();
    for (const [name, props] of names) {
      frozenNames.set(name, Object.freeze(new Set(props)));
    }
    layers.set(domain, Object.freeze(frozenNames));
  }

  Object.freeze(domains);
  Object.freeze(layers);

  const index: ResourceIndex = {
    domains: domains as ReadonlySet<ResourceDomain>,
    resources: layers as unknown as ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
    entries: layers,
    has(domain: string, name: string): boolean {
      return layers.get(domain as ResourceDomain)?.has(name) ?? false;
    },
    getProperties(domain: string, name: string): ReadonlySet<string> | undefined {
      return layers.get(domain as ResourceDomain)?.get(name);
    },
    validateProperty(domain: string, name: string, property: string): boolean {
      return layers.get(domain as ResourceDomain)?.get(name)?.has(property) ?? false;
    },
    isValidProperty(domain: string, property: string): boolean {
      return DOMAIN_PROPERTIES.get(domain as ResourceDomain)?.has(property) ?? false;
    },
  };
  return Object.freeze(index);
}

/** Pure, deterministic parse of a `resources.yaml` text document. */
export function parseResourceIndex(text: string, filePath: string): ResourceIndex {
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

  const collision = findIdentityCollision(doc.contents);
  if (collision !== undefined) {
    throw new ResourceRefError('RESOURCE_REF_IDENTITY_COLLISION', collision);
  }

  const entries = new Map<ResourceDomain, Map<string, Set<string>>>();

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

    const allowed = DOMAIN_PROPERTIES.get(domain);
    const names = new Map<string, Set<string>>();
    for (const [name, resourceRaw] of Object.entries(domainValueRaw)) {
      if (!isRecord(resourceRaw)) {
        throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
      }
      const declared = new Set<string>();
      for (const property of Object.keys(resourceRaw)) {
        if (allowed !== undefined && !allowed.has(property)) {
          throw new ResourceRefError('RESOURCE_REF_PROPERTY_INVALID', {
            domain,
            name,
            property,
            allowedProperties: [...allowed].sort(),
          });
        }
        declared.add(property);
      }
      names.set(name, declared.size === 0 && allowed !== undefined ? new Set(allowed) : declared);
    }
    entries.set(domain, names);
  }

  return buildIndex(entries);
}

/** Reads `<compositionRoot>/.ycsf/resources.yaml`; absent file → empty index (FR-001). */
export async function loadResourceIndex(compositionRoot: string): Promise<ResourceIndex> {
  const filePath = join(compositionRoot, '.ycsf', 'resources.yaml');
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_RESOURCE_INDEX;
    }
    throw new ResourceRefError('RESOURCE_REF_INVALID_YAML', { filePath });
  }
  return parseResourceIndex(text, filePath);
}