import { ComposeError } from '../compose-errors.js';
import type { PathOwnership } from '../provenance.js';
import type { GatewayDocument } from '../types.js';
import type { OverrideFile, OverrideRule, OverrideTarget } from './override-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ResolvedTarget {
  container: Record<string, unknown>;
  key: string;
}

interface LocalOverride {
  appId: string;
  file: OverrideFile | null;
}

function targetDescriptor(target: OverrideTarget): string {
  switch (target.kind) {
    case 'info':
      return 'info';
    case 'path':
      return `path ${target.path ?? ''}`;
    case 'operation':
      return `${target.method ?? ''} ${target.path ?? ''}`;
    case 'operationId':
      return `operationId ${target.operationId ?? ''}`;
    case 'component':
      return `component ${target.name ?? ''}`;
  }
}

function pathOwnerOf(ownership: PathOwnership, path: string): string | undefined {
  return ownership.ownerOf(path);
}

function resolveComponentBucket(
  document: GatewayDocument,
  name: string,
): Record<string, unknown> | undefined {
  const components = document['components'];
  if (!isRecord(components)) {
    return undefined;
  }
  const namespaces = Object.entries(components).filter((entry): entry is [string, Record<string, unknown>] =>
    isRecord(entry[1]),
  );
  for (const [, bucket] of namespaces) {
    if (name in bucket) {
      return bucket;
    }
  }
  return undefined;
}

function resolveTarget(
  document: GatewayDocument,
  ownership: PathOwnership,
  target: OverrideTarget,
  ruleIndex: number,
): { container: Record<string, unknown>; key: string } | undefined {
  switch (target.kind) {
    case 'info':
      return { container: document, key: 'info' };
    case 'path': {
      const key = target.path ?? '';
      const paths = document['paths'];
      if (!isRecord(paths)) {
        throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex, kind: 'path' });
      }
      return { container: paths, key };
    }
    case 'operation': {
      const paths = document['paths'];
      if (!isRecord(paths)) {
        throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex, kind: 'operation' });
      }
      const pathItem = paths[target.path ?? ''];
      if (!isRecord(pathItem)) {
        return undefined;
      }
      return { container: pathItem, key: target.method ?? '' };
    }
    case 'operationId': {
      const operationId = target.operationId ?? '';
      const ref = ownership.resolveOperation(operationId);
      if (ref === undefined) {
        return undefined;
      }
      const paths = document['paths'];
      const pathItem = isRecord(paths) ? paths[ref.path] : undefined;
      if (!isRecord(pathItem)) {
        return undefined;
      }
      return { container: pathItem, key: ref.method };
    }
    case 'component': {
      const bucket = resolveComponentBucket(document, target.name ?? '');
      if (bucket === undefined) {
        return undefined;
      }
      return { container: bucket, key: target.name ?? '' };
    }
  }
}

function assertLocalScope(
  ownership: PathOwnership,
  target: OverrideTarget,
  appId: string,
): void {
  if (target.kind === 'info' || target.kind === 'component') {
    throw new ComposeError('OVERRIDE_OUT_OF_SCOPE', { app: appId, targetKind: target.kind });
  }

  let owner: string | undefined;
  let targetPath = target.path;
  if (target.kind === 'operationId') {
    const ref = ownership.resolveOperation(target.operationId ?? '');
    if (ref !== undefined) {
      owner = ownership.ownerOf(ref.path);
      targetPath = ref.path;
    }
  } else if (targetPath !== undefined) {
    owner = pathOwnerOf(ownership, targetPath);
  }

  if (owner !== undefined && owner !== appId) {
    throw new ComposeError('OVERRIDE_OUT_OF_SCOPE', {
      app: appId,
      targetPath,
      targetKind: target.kind,
      owner,
    });
  }
}

function materializeTarget(
  document: GatewayDocument,
  target: OverrideTarget,
): ResolvedTarget | undefined {
  if (target.kind === 'operation') {
    const paths = document['paths'];
    if (!isRecord(paths)) {
      return undefined;
    }
    const path = target.path ?? '';
    const pathItem = paths[path];
    const container =
      isRecord(pathItem) ? pathItem : (paths[path] = {}) as Record<string, unknown>;
    return { container, key: target.method ?? '' };
  }
  return undefined;
}

function applyRule(document: GatewayDocument, ownership: PathOwnership, rule: OverrideRule, appId?: string): void {
  const { op, target, value, ruleIndex } = rule;

  const resolved = resolveTarget(document, ownership, target, ruleIndex);
  const targetTag = targetDescriptor(target);
  const pathForError = target.path;

  if (appId !== undefined) {
    assertLocalScope(ownership, target, appId);
  }

  const present = resolved !== undefined && resolved.key in resolved.container;

  if (op === 'replace' || op === 'remove') {
    if (target.kind === 'info' && op === 'replace' && !present) {
      document['info'] = value as Record<string, unknown>;
      return;
    }
    if (!present) {
      throw new ComposeError('OVERRIDE_TARGET_MISSING', {
        ruleIndex,
        target: targetTag,
        path: pathForError,
      });
    }
    const container = resolved as ResolvedTarget;
    if (op === 'replace') {
      container.container[container.key] = value;
    } else {
      delete container.container[container.key];
    }
  } else {
    if (present) {
      throw new ComposeError('OVERRIDE_TARGET_ALREADY_EXISTS', {
        ruleIndex,
        target: targetTag,
        path: pathForError,
      });
    }
    const container = resolved ?? materializeTarget(document, target);
    if (container === undefined) {
      throw new ComposeError('OVERRIDE_TARGET_MISSING', {
        ruleIndex,
        target: targetTag,
        path: pathForError,
      });
    }
    container.container[container.key] = value;
  }

  updateOwnership(document, ownership, target, op, appId);
}

function deleteOperationsInPath(ownership: PathOwnership, path: string, method?: string): void {
  for (const [operationId, ref] of ownership.operationIdIndex) {
    if (ref.path === path && (method === undefined || ref.method === method)) {
      ownership.operationIdIndex.delete(operationId);
    }
  }
}

function updateOwnership(
  document: GatewayDocument,
  ownership: PathOwnership,
  target: OverrideTarget,
  op: OverrideRule['op'],
  appId: string | undefined,
): void {
  const owner = appId ?? 'global';

  if (target.kind === 'path') {
    const path = target.path;
    if (path === undefined) {
      return;
    }
    if (op === 'add') {
      ownership.assignPath(path, owner);
    } else if (op === 'remove') {
      ownership.ownerByPath.delete(path);
      deleteOperationsInPath(ownership, path);
    }
    return;
  }

  if (target.kind === 'operation') {
    const path = target.path ?? '';
    const method = target.method ?? '';
    if (op === 'add') {
      ownership.assignPath(path, owner);
    } else if (op === 'remove') {
      deleteOperationsInPath(ownership, path, method);
      return;
    }
    const paths = document['paths'];
    if (isRecord(paths)) {
      const pathItem = isRecord(paths[path]) ? (paths[path] as Record<string, unknown>) : undefined;
      const operation = pathItem?.[method];
      const operationId =
        isRecord(operation) && typeof operation['operationId'] === 'string' && operation['operationId'] !== ''
          ? operation['operationId']
          : undefined;
      if (operationId !== undefined) {
        ownership.assignOperation(operationId, { path, appId: owner, method });
      }
    }
    return;
  }

  if (target.kind === 'operationId') {
    const ref = ownership.resolveOperation(target.operationId ?? '');
    if (ref === undefined) {
      return;
    }
    const paths = document['paths'];
    if (isRecord(paths)) {
      const pathItem = isRecord(paths[ref.path]) ? (paths[ref.path] as Record<string, unknown>) : undefined;
      const operation = pathItem?.[ref.method];
      const newOperationId =
        isRecord(operation) &&
        typeof operation['operationId'] === 'string' &&
        operation['operationId'] !== ''
          ? operation['operationId']
          : undefined;
      if (op === 'remove') {
        ownership.operationIdIndex.delete(target.operationId ?? '');
      } else if (newOperationId !== undefined && newOperationId !== target.operationId) {
        ownership.operationIdIndex.delete(target.operationId ?? '');
        ownership.assignOperation(newOperationId, { path: ref.path, appId: owner, method: ref.method });
      }
    }
  }
}

export function applyOverrides(
  document: GatewayDocument,
  ownership: PathOwnership,
  global: OverrideFile | null,
  locals: readonly LocalOverride[],
): void {
  if (global !== null) {
    for (const rule of global.rules) {
      applyRule(document, ownership, rule);
    }
  }
  for (const local of locals) {
    if (local.file === null) {
      continue;
    }
    for (const rule of local.file.rules) {
      applyRule(document, ownership, rule, local.appId);
    }
  }
}