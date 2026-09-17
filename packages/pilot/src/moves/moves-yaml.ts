// spec 017 moves — `.ycsf/moved.yaml` parse gate (the ONLY yaml user,
// mirroring model/parse.ts; static guard T103). Load-stage diagnostics reuse
// the ProjectModelDiagnostic shape with file/line/column populated.
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

import {
  MOV_INVALID,
  MOV_VERSION,
  type MoveEndpoint,
  type MoveEntry,
  type MovesYaml,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';
import { diag } from './errors.js';
import { isValidIdl, isValidIdt } from './validate.js';

export type ParseMovesYamlResult =
  | { kind: 'ok'; data: MovesYaml }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

/** 1-based line/column of a YAML node offset. */
function locationOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (text.charAt(i) === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function startOffset(node: unknown): number {
  const range = (node as { range?: [number, number, number] } | null)?.range;
  return range?.[0] ?? 0;
}

function lineColumn(text: string, node: unknown): { line: number; column: number } {
  return locationOf(text, startOffset(node));
}

type EndpointReadResult =
  | { ok: true; endpoint: MoveEndpoint }
  | { ok: false; field: string };

function readEndpoint(node: unknown, prefix: 'from' | 'to'): EndpointReadResult {
  if (!isMap(node)) return { ok: false, field: prefix };
  for (const { key } of node.items) {
    if (scalarString(key) !== 'idl' && scalarString(key) !== 'idt') {
      return { ok: false, field: prefix };
    }
  }
  const idl = scalarString(node.get('idl', true));
  const idt = scalarString(node.get('idt', true));
  if (idl === undefined || !isValidIdl(idl)) return { ok: false, field: `${prefix}.idl` };
  if (idt === undefined || !isValidIdt(idt)) return { ok: false, field: `${prefix}.idt` };
  return { ok: true, endpoint: { idl, idt } };
}

export function parseMovesYaml(text: string, file: string): ParseMovesYamlResult {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) {
    const errors = doc.errors.map((error) => {
      const pos = error.linePos?.[0];
      return diag({
        code: MOV_INVALID,
        message: error.message,
        file,
        ...(pos !== undefined ? { line: pos.line, column: pos.col } : {}),
      });
    });
    return { kind: 'invalid', errors };
  }

  const root = doc.contents;
  if (root === null || !isMap(root)) {
    return {
      kind: 'invalid',
      errors: [
        diag({ code: MOV_INVALID, message: `expected a top-level mapping in ${file}`, file, field: 'moves' }),
      ],
    };
  }

  if (!root.has('version')) {
    return {
      kind: 'invalid',
      errors: [
        diag({ code: MOV_VERSION, message: `missing version in ${file} (supported: 1)`, file, field: 'version' }),
      ],
    };
  }
  const versionNode = root.get('version', true);
  const scalarVersion = isScalar(versionNode) ? versionNode : undefined;
  const versionRaw: unknown = scalarVersion === undefined ? undefined : scalarVersion.value;
  const isOne = typeof versionRaw === 'number' && versionRaw === 1;
  if (!isOne) {
    return {
      kind: 'invalid',
      errors: [
        diag({
          code: MOV_VERSION,
          message: `unsupported version '${versionRaw === undefined ? '?' : String(versionRaw)}' in ${file} (supported: 1)`,
          file,
          field: 'version',
        }),
      ],
    };
  }

  if (!root.has('moves')) {
    return {
      kind: 'invalid',
      errors: [
        diag({
          code: MOV_INVALID,
          message: `missing moves list in ${file}`,
          file,
          field: 'moves',
          ...lineColumn(text, root),
        }),
      ],
    };
  }
  const movesNode = root.get('moves', true);
  if (!isSeq(movesNode)) {
    return {
      kind: 'invalid',
      errors: [
        diag({
          code: MOV_INVALID,
          message: `'moves' must be a list in ${file}`,
          file,
          field: 'moves',
          ...lineColumn(text, movesNode),
        }),
      ],
    };
  }

  const errors: ProjectModelDiagnostic[] = [];
  const entries: MoveEntry[] = [];

  for (let i = 0; i < movesNode.items.length; i++) {
    const item = movesNode.items[i];
    const loc = lineColumn(text, item);
    const bad = (message: string, field: string): ProjectModelDiagnostic =>
      diag({ code: MOV_INVALID, message, file, field, line: loc.line, column: loc.column });

    if (!isMap(item)) {
      errors.push(bad(`moves[${i}] must be a mapping`, 'moves'));
      continue;
    }

    const keyNames = item.items.map(({ key }) => scalarString(key) ?? '<key>');
    if (keyNames.some((k) => k !== 'from' && k !== 'to')) {
      errors.push(bad(`moves[${i}] allows only 'from' and 'to' keys`, 'moves'));
      continue;
    }

    const fromResult = readEndpoint(item.get('from', true), 'from');
    if (!fromResult.ok) {
      errors.push(bad(`moves[${i}] invalid 'from' endpoint (${fromResult.field})`, fromResult.field));
      continue;
    }
    const toResult = readEndpoint(item.get('to', true), 'to');
    if (!toResult.ok) {
      errors.push(bad(`moves[${i}] invalid 'to' endpoint (${toResult.field})`, toResult.field));
      continue;
    }

    const from = fromResult.endpoint;
    const to = toResult.endpoint;
    if (from.idl === to.idl && from.idt === to.idt) {
      errors.push(bad(`moves[${i}] is a no-op (from equals to)`, 'moves'));
      continue;
    }

    entries.push({ from, to });
  }

  for (const { key } of root.items) {
    const name = scalarString(key);
    if (name === undefined || name === 'version' || name === 'moves') continue;
    const loc = lineColumn(text, key);
    errors.push(
      diag({
        code: MOV_INVALID,
        message: `unknown top-level key '${name}' in ${file}`,
        file,
        field: name,
        line: loc.line,
        column: loc.column,
      }),
    );
  }

  if (errors.length > 0) return { kind: 'invalid', errors };
  return { kind: 'ok', data: { version: 1, moves: entries } };
}