import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAlias, isMap, parseDocument, type YAMLParseError } from 'yaml';

import { ComposeError } from '../compose-errors.js';
import type { OverrideFile, OverrideRule, OverrideRuleOp, OverrideTarget } from './override-types.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const TARGET_KINDS = new Set(['info', 'path', 'operation', 'operationId', 'component']);
const RULE_OPS = new Set(['replace', 'add', 'remove']);

export async function loadOverrideFile(root: string): Promise<OverrideFile | null> {
  const filePath = join(root, 'overrides.yaml');
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new ComposeError('OVERRIDE_FILE_UNREADABLE', { filePath });
  }
  return parseOverrideFile(text, filePath);
}

function validateTarget(
  raw: Record<string, unknown>,
  ruleIndex: number,
): OverrideTarget {
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !TARGET_KINDS.has(kind)) {
    throw new ComposeError('OVERRIDE_INVALID_TARGET', {
      ruleIndex,
      kind: typeof kind === 'string' ? kind : undefined,
    });
  }

  const target: OverrideTarget = { kind: kind as OverrideTarget['kind'] };

  if (target.kind === 'operation') {
    const path = raw['path'];
    const method = raw['method'];
    if (typeof path !== 'string' || path === '' || typeof method !== 'string' || method === '') {
      throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex, kind: target.kind });
    }
    if (!HTTP_METHODS.has(method)) {
      throw new ComposeError('OVERRIDE_METHOD_INVALID', { ruleIndex, method, path });
    }
    target.path = path;
    target.method = method;
    return target;
  }

  if (target.kind === 'path') {
    const path = raw['path'];
    if (typeof path !== 'string' || path === '') {
      throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex, kind: target.kind });
    }
    target.path = path;
    return target;
  }

  if (target.kind === 'operationId') {
    const operationId = raw['operationId'];
    if (typeof operationId !== 'string' || operationId === '') {
      throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex, kind: target.kind });
    }
    target.operationId = operationId;
    return target;
  }

  if (target.kind === 'component') {
    const name = raw['name'];
    if (typeof name !== 'string' || name === '') {
      throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex, kind: target.kind });
    }
    target.name = name;
    return target;
  }

  return target;
}

function validateRule(raw: unknown, ruleIndex: number): OverrideRule {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex });
  }
  const rule = raw as Record<string, unknown>;

  const op = rule['op'];
  if (typeof op !== 'string' || !RULE_OPS.has(op)) {
    throw new ComposeError('OVERRIDE_UNKNOWN_OP', {
      ruleIndex,
      op: typeof op === 'string' ? op : undefined,
    });
  }

  const targetRaw = rule['target'];
  if (typeof targetRaw !== 'object' || targetRaw === null || Array.isArray(targetRaw)) {
    throw new ComposeError('OVERRIDE_INVALID_TARGET', { ruleIndex });
  }
  const target = validateTarget(targetRaw as Record<string, unknown>, ruleIndex);

  const hasValue = 'value' in rule;
  if (op === 'remove') {
    if (hasValue) {
      throw new ComposeError('OVERRIDE_VALUE_FORBIDDEN', { ruleIndex });
    }
  } else if (!hasValue) {
    throw new ComposeError('OVERRIDE_VALUE_REQUIRED', { ruleIndex, op: op as OverrideRuleOp });
  }

  return { op: op as OverrideRuleOp, target, value: rule['value'], ruleIndex };
}

export function parseOverrideFile(text: string, sourcePath: string): OverrideFile {
  const doc = parseDocument(text, { uniqueKeys: true });
  const firstError = doc.errors[0] as YAMLParseError | undefined;
  if (firstError !== undefined) {
    throw new ComposeError('OVERRIDE_FILE_INVALID_YAML', { filePath: sourcePath });
  }
  if (!isMap(doc.contents) || isAlias(doc.contents)) {
    throw new ComposeError('OVERRIDE_FILE_INVALID_YAML', { filePath: sourcePath });
  }

  const raw = doc.toJS() as Record<string, unknown>;
  if (raw['version'] !== 1) {
    throw new ComposeError('OVERRIDE_VERSION_UNSUPPORTED', { filePath: sourcePath });
  }
  if (!Array.isArray(raw['rules'])) {
    throw new ComposeError('OVERRIDE_RULES_NOT_LIST', { filePath: sourcePath });
  }
  if (raw['rules'].length === 0) {
    throw new ComposeError('OVERRIDE_RULES_EMPTY', { filePath: sourcePath });
  }

  const rules = raw['rules'].map((rule: unknown, index: number) => validateRule(rule, index));
  return { version: 1, rules, sourcePath };
}