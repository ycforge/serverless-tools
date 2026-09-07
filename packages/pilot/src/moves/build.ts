// spec 017 moves — buildMoves compile wrapper + moved.ycsf.tf.json emission
// (CPU-only). All-or-nothing: any validation or chain diagnostic → invalid.
import type {
  BuildMovesResult,
  GeneratedTfFile,
  MoveEndpoint,
  MovesYaml,
  TerraformMoved,
} from '../contracts/index.js';
import { serializeJson } from '../materialize/serialize.js';
import { buildChains } from './chain.js';
import { validateMoves } from './validate.js';

const MOVED_FILENAME = 'moved.ycsf.tf.json';

export function buildMoves(
  currentResources: readonly MoveEndpoint[],
  moves: MovesYaml,
): BuildMovesResult {
  const validated = validateMoves(moves);
  if (validated.errors.length > 0) return { kind: 'invalid', errors: validated.errors };

  const { errors, chains } = buildChains(validated, moves.moves, currentResources);
  if (errors.length > 0) return { kind: 'invalid', errors };

  const moved: TerraformMoved[] = [];
  for (const chain of chains) {
    const target = chain.current;
    if (target === undefined) continue;
    let prevIdt = chain.start.idt;
    for (const entry of chain.entries) {
      if (entry.to.idt === prevIdt) continue;
      moved.push({ kind: 'moved', from: prevIdt, to: target.idt });
      prevIdt = entry.to.idt;
    }
  }
  return { kind: 'ok', moved };
}

/**
 * Overall move block (spec 002 `moved` shape): the Terraform `.tf.json` moved
 * entry is exactly `{"from": ..., "to": ...}` — the internal `kind` field is
 * projected away before serialization. `null` when there is nothing to move
 * (then nothing is written; provenance C overall, spec 017).
 */
export function buildMovedFile(moved: readonly TerraformMoved[]): GeneratedTfFile | null {
  if (moved.length === 0) return null;
  const blocks = moved.map(({ from, to }) => ({ from, to }));
  return { filename: MOVED_FILENAME, content: serializeJson({ moved: blocks }) };
}