// spec 017 moves — loader: the ONLY fs-touching module of the moves surface.
// Missing `.ycsf/moved.yaml` is a valid no-migrations state (ok with moves:
// []); any other I/O failure propagates.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MovesLoadResult } from '../contracts/index.js';
import { parseMovesYaml } from './moves-yaml.js';

const MOVES_FILE = '.ycsf/moved.yaml';

export function loadMoves(rootDir: string): MovesLoadResult {
  const path = join(rootDir, MOVES_FILE);
  if (!existsSync(path)) return { kind: 'ok', data: { version: 1, moves: [] } };
  const text = readFileSync(path, 'utf8');
  return parseMovesYaml(text, MOVES_FILE);
}