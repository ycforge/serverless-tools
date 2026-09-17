import type { RouteOwner } from './types.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export interface OperationIdRef {
  path: string;
  appId: string;
  method: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PathOwnership {
  readonly ownerByPath = new Map<string, RouteOwner>();
  readonly operationIdIndex = new Map<string, OperationIdRef>();

  constructor(
    participants?: readonly { appId: string; paths: Record<string, unknown> }[],
  ) {
    for (const { appId, paths } of participants ?? []) {
      this.assignApp(appId, paths);
    }
  }

  assignPath(path: string, owner: RouteOwner): void {
    this.ownerByPath.set(path, owner);
  }

  assignOperation(operationId: string, ref: OperationIdRef): void {
    this.operationIdIndex.set(operationId, ref);
  }

  ownerOf(path: string): RouteOwner | undefined {
    return this.ownerByPath.get(path);
  }

  resolveOperation(operationId: string): OperationIdRef | undefined {
    return this.operationIdIndex.get(operationId);
  }

  assignApp(appId: string, paths: Record<string, unknown>): void {
    for (const [path, pathItem] of Object.entries(paths)) {
      this.assignPath(path, appId);
      if (isRecord(pathItem)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (!HTTP_METHODS.has(method)) {
            continue;
          }
          if (!isRecord(operation)) {
            continue;
          }
          if (typeof operation.operationId === 'string' && operation.operationId !== '') {
            this.assignOperation(operation.operationId, { path, appId, method });
          }
        }
      }
    }
  }
}

export function walkJsonKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkJsonKeys(item, visit);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(key);
      walkJsonKeys(child, visit);
    }
  }
}