// spec 017 moves — pure validation of a programmatic MovesYaml (CPU-only).
// CPU-only: no node:fs / node:path / yaml imports (static guard T103).
import {
  MOV_CONTRADICTORY,
  MOV_DUPLICATE,
  MOV_INVALID,
  MOV_TYPE_CHANGE,
  type MoveEndpoint,
  type MoveEntry,
  type MovesDiagnostic,
  type MovesYaml,
} from '../contracts/index.js';
import { mov } from './errors.js';

export interface ValidatedMoves {
  readonly errors: readonly MovesDiagnostic[];
  /** First-wins outgoing edge per from-key (only entries that passed validation). */
  readonly outEdge: ReadonlyMap<string, MoveEntry>;
  /** First-wins incoming edge per to-key. */
  readonly inEdge: ReadonlyMap<string, MoveEntry>;
}

export const IDL_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const IDT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidIdl(value: unknown): boolean {
  return typeof value === 'string' && IDL_RE.test(value);
}

export function isValidIdt(value: unknown): boolean {
  return typeof value === 'string' && IDT_RE.test(value);
}

/** Canonical key of a MoveEndpoint ({idl, idt} pair). */
export function endpointKey(e: MoveEndpoint): string {
  return `${e.idl}\u001f${e.idt}`;
}

/**
 * First offending field of a (possibly malformed) endpoint value:
 * 'from' | 'from.idl' | 'from.idt' | ... or null when structurally valid.
 * Defensive: tolerates runtime garbage on a typed MovesYaml.
 */
function endpointField(value: unknown, prefix: 'from' | 'to'): string | null {
  if (typeof value !== 'object' || value === null) return prefix;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 2 || keys[0] !== 'idl' || keys[1] !== 'idt') return prefix;
  if (!isValidIdl(obj.idl)) return `${prefix}.idl`;
  if (!isValidIdt(obj.idt)) return `${prefix}.idt`;
  return null;
}

function entryField(from: unknown, to: unknown): string | null {
  return endpointField(from, 'from') ?? endpointField(to, 'to');
}

export function validateMoves(moves: MovesYaml): ValidatedMoves {
  const errors: MovesDiagnostic[] = [];
  const outEdge = new Map<string, MoveEntry>();
  const inEdge = new Map<string, MoveEntry>();
  const seenPair = new Set<string>();
  const seenFrom = new Map<string, number>();
  const seenTo = new Map<string, number>();

  for (let i = 0; i < moves.moves.length; i++) {
    const m = moves.moves[i] as MoveEntry;
    const field = entryField(m.from, m.to);
    if (field !== null) {
      errors.push(
        mov({
          code: MOV_INVALID,
          message: `invalid move entry ${i}: malformed endpoint (${field})`,
          entry: i,
          endpoint: field.startsWith('from') ? m.from : m.to,
          field,
        }),
      );
      continue;
    }

    const fromKey = endpointKey(m.from);
    const toKey = endpointKey(m.to);

    if (fromKey === toKey) {
      errors.push(
        mov({
          code: MOV_INVALID,
          message: `no-op move ${i}: from and to are the same endpoint`,
          entry: i,
          endpoint: m.from,
        }),
      );
      continue;
    }

    const fromType = m.from.idt.split('.')[0];
    const toType = m.to.idt.split('.')[0];
    if (fromType !== toType) {
      errors.push(
        mov({
          code: MOV_TYPE_CHANGE,
          message: `move ${i} changes the terraform type (${fromType} → ${toType}); not a safe rename`,
          entry: i,
        }),
      );
      continue;
    }

    const pair = `${fromKey}\u001f${toKey}`;
    if (seenPair.has(pair)) {
      errors.push(
        mov({
          code: MOV_DUPLICATE,
          message: `duplicate move ${i}: same from and to as an earlier entry`,
          entry: i,
        }),
      );
      continue;
    }

    const fromIdx = seenFrom.get(fromKey);
    if (fromIdx !== undefined) {
      errors.push(
        mov({
          code: MOV_CONTRADICTORY,
          message: `contradictory move ${i}: from endpoint already migrated by entry ${fromIdx}`,
          entry: i,
        }),
      );
      continue;
    }

    const toIdx = seenTo.get(toKey);
    if (toIdx !== undefined) {
      errors.push(
        mov({
          code: MOV_CONTRADICTORY,
          message: `contradictory move ${i}: to endpoint already targeted by entry ${toIdx}`,
          entry: i,
        }),
      );
      continue;
    }

    seenPair.add(pair);
    seenFrom.set(fromKey, i);
    seenTo.set(toKey, i);
    outEdge.set(fromKey, m);
    inEdge.set(toKey, m);
  }

  return { errors, outEdge, inEdge };
}