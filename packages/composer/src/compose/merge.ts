import { ComposeError } from './compose-errors.js';
import { PathOwnership, type OperationIdRef } from './provenance.js';
import type { MergeParticipant } from './types.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const COMPONENT_KEY_SEPARATOR = '\u0000';

export interface MergeResult {
  openapi: string;
  paths: Record<string, unknown>;
  components: Record<string, unknown>;
  ownership: PathOwnership;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sortRecordKeys<T>(record: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key] as T;
  }
  return sorted;
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertVersionConsensus(participants: readonly MergeParticipant[]): string {
  const first = participants[0];
  if (first === undefined) {
    return '';
  }
  const expected = first.doc.openapi;
  for (const { doc } of participants) {
    if (doc.openapi !== expected) {
      throw new ComposeError('COMPOSE_OPENAPI_VERSION_MISMATCH', {
        apps: participants.map((p) => p.appId).sort(),
        versions: participants.map((p) => p.doc.openapi).sort(),
      });
    }
  }
  return expected;
}

function collectPathApp(pathApps: Map<string, string[]>, path: string, appId: string): void {
  const apps = pathApps.get(path);
  if (apps === undefined) {
    pathApps.set(path, [appId]);
  } else if (!apps.includes(appId)) {
    apps.push(appId);
  }
}

function collectOperation(
  operationRefs: Map<string, OperationIdRef[]>,
  operationId: string,
  ref: OperationIdRef,
): void {
  const refs = operationRefs.get(operationId);
  if (refs === undefined) {
    operationRefs.set(operationId, [ref]);
  } else {
    refs.push(ref);
  }
}

function collectComponentApp(
  componentApps: Map<string, string[]>,
  subsection: string,
  name: string,
  appId: string,
): void {
  const key = `${subsection}${COMPONENT_KEY_SEPARATOR}${name}`;
  const apps = componentApps.get(key);
  if (apps === undefined) {
    componentApps.set(key, [appId]);
  } else if (!apps.includes(appId)) {
    apps.push(appId);
  }
}

export function mergeDocuments(participants: readonly MergeParticipant[]): MergeResult {
  const openapi = assertVersionConsensus(participants);

  const pathApps = new Map<string, string[]>();
  const operationRefs = new Map<string, OperationIdRef[]>();
  const componentApps = new Map<string, string[]>();

  for (const { appId, doc } of participants) {
    for (const path of Object.keys(doc.paths)) {
      collectPathApp(pathApps, path, appId);
    }
    if (isRecord(doc.components)) {
      for (const [subsection, subsectionValue] of Object.entries(doc.components)) {
        if (!isRecord(subsectionValue)) {
          continue;
        }
        for (const name of Object.keys(subsectionValue)) {
          collectComponentApp(componentApps, subsection, name, appId);
        }
      }
    }
    for (const [path, pathItem] of Object.entries(doc.paths)) {
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
        if (typeof operation.operationId === 'string' && operation.operationId !== '') {
          collectOperation(operationRefs, operation.operationId, { path, appId, method });
        }
      }
    }
  }

  for (const path of [...pathApps.keys()].sort()) {
    const apps = distinct(pathApps.get(path) ?? []);
    if (apps.length > 1) {
      throw new ComposeError('COMPOSE_PATH_COLLISION', { path, apps: apps.sort() });
    }
  }

  for (const operationId of [...operationRefs.keys()].sort()) {
    const refs = operationRefs.get(operationId) ?? [];
    if (refs.length > 1) {
      throw new ComposeError('COMPOSE_OPERATIONID_COLLISION', {
        operationId,
        paths: refs.map((ref) => ref.path).sort(),
        apps: distinct(refs.map((ref) => ref.appId)).sort(),
      });
    }
  }

  for (const key of [...componentApps.keys()].sort()) {
    const separatorIndex = key.indexOf(COMPONENT_KEY_SEPARATOR);
    const name =
      separatorIndex === -1 ? key : key.slice(separatorIndex + COMPONENT_KEY_SEPARATOR.length);
    const apps = distinct(componentApps.get(key) ?? []).sort();
    if (apps.length > 1) {
      throw new ComposeError('COMPOSE_COMPONENT_COLLISION', { componentName: name, apps });
    }
  }

  const paths: Record<string, unknown> = {};
  const components: Record<string, Record<string, unknown>> = {};
  const ownership = new PathOwnership();

  for (const { appId, doc } of participants) {
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      paths[path] = structuredClone(pathItem);
    }
    if (isRecord(doc.components)) {
      for (const [subsection, subsectionValue] of Object.entries(doc.components)) {
        if (!isRecord(subsectionValue)) {
          continue;
        }
        const bucket = (components[subsection] ??= {});
        for (const [name, value] of Object.entries(subsectionValue)) {
          bucket[name] = structuredClone(value);
        }
      }
    }
    ownership.assignApp(appId, doc.paths);
  }

  const sortedComponents: Record<string, unknown> = {};
  for (const subsection of Object.keys(components).sort()) {
    sortedComponents[subsection] = sortRecordKeys(components[subsection] ?? {});
  }

  return {
    openapi,
    paths: sortRecordKeys(paths),
    components: sortedComponents,
    ownership,
  };
}