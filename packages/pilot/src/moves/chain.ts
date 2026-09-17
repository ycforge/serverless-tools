// spec 017 moves — migration-chain building over the validated edge maps
// (CPU-only). Weakly connected paths compile into chains; cycles and dangling
// (terminal-not-current) chains produce MOV_* chain diagnostics.
import {
  MOV_CYCLE,
  MOV_DANGLING,
  MOV_TARGET_UNRESOLVED,
  type MoveEndpoint,
  type MoveEntry,
  type MovesDiagnostic,
} from '../contracts/index.js';
import { mov } from './errors.js';
import { endpointKey, type ValidatedMoves } from './validate.js';

export interface Chain {
  /** Migration records in chronological (walk) order. */
  readonly entries: readonly MoveEntry[];
  /** First endpoint of the chain (oldest identity). */
  readonly start: MoveEndpoint;
  /** Last endpoint of the chain. */
  readonly terminal: MoveEndpoint;
  /** Exact {idl, idt} current resource matching the terminal (absent → dangling). */
  readonly current?: MoveEndpoint;
}

export interface ChainsResult {
  readonly errors: readonly MovesDiagnostic[];
  readonly chains: readonly Chain[];
}

export function buildChains(
  validated: ValidatedMoves,
  entries: readonly MoveEntry[],
  currentResources: readonly MoveEndpoint[],
): ChainsResult {
  const errors: MovesDiagnostic[] = [];
  const outEdge = validated.outEdge;

  const nodeOf = new Map<string, MoveEndpoint>();
  for (const m of outEdge.values()) {
    if (!nodeOf.has(endpointKey(m.from))) nodeOf.set(endpointKey(m.from), m.from);
    if (!nodeOf.has(endpointKey(m.to))) nodeOf.set(endpointKey(m.to), m.to);
  }

  const firstEntryIndex = new Map<MoveEntry, number>();
  entries.forEach((m, i) => {
    if (!firstEntryIndex.has(m)) firstEntryIndex.set(m, i);
  });

  const inKeys = new Set(validated.inEdge.keys());
  const sources = [...outEdge.keys()].filter((k) => !inKeys.has(k)).sort();
  const visited = new Set<string>();
  const chains: Chain[] = [];

  for (const source of sources) {
    const walkEntries: MoveEntry[] = [];
    let cursor: string | null = source;
    while (cursor !== null && !visited.has(cursor) && outEdge.has(cursor)) {
      const m = outEdge.get(cursor);
      if (m === undefined) break;
      visited.add(cursor);
      walkEntries.push(m);
      cursor = endpointKey(m.to);
    }
    if (walkEntries.length === 0) continue;

    const start = nodeOf.get(source);
    if (start === undefined) continue;
    const last = walkEntries[walkEntries.length - 1];
    if (last === undefined) continue;
    const terminal = last.to;

    const current = currentResources.find(
      (c) => c.idl === terminal.idl && c.idt === terminal.idt,
    );
    if (current === undefined) {
      const available = [...new Set(currentResources.map((c) => c.idl))].sort();
      errors.push(
        mov({
          code: MOV_TARGET_UNRESOLVED,
          message: `chain terminal '${terminal.idl}/${terminal.idt}' does not match any current resource; available: ${available.join(', ')}`,
          endpoint: terminal,
          available,
        }),
      );
      for (const m of walkEntries) {
        const idx = firstEntryIndex.get(m);
        errors.push(
          mov({
            code: MOV_DANGLING,
            message: `entry ${String(idx ?? '?')} of the unresolved chain (terminal '${terminal.idl}/${terminal.idt}')`,
            ...(idx !== undefined ? { entry: idx } : {}),
          }),
        );
      }
      continue;
    }

    chains.push({ entries: walkEntries, start, terminal, current });
  }

  const cycleKeys = [...nodeOf.keys()].filter((k) => !visited.has(k)).sort();
  for (const start of cycleKeys) {
    if (visited.has(start)) continue;
    const cycle: MoveEndpoint[] = [];
    let cursor: string | null = start;
    while (cursor !== null && !visited.has(cursor) && outEdge.has(cursor)) {
      const m = outEdge.get(cursor);
      if (m === undefined) break;
      visited.add(cursor);
      cycle.push(m.from);
      cursor = endpointKey(m.to);
    }
    if (cycle.length === 0) continue;
    errors.push(
      mov({
        code: MOV_CYCLE,
        message: `cycle in migration history: ${cycle.map((n) => n.idt).join(' → ')}`,
      }),
    );
  }

  return { errors, chains };
}