// spec 016 outputs — `.ycsf/outputs.yaml` discovery + read (patchn loadExtensions).
// Sole fs I/O point of the feature (FR-018/SC-003). Missing file → THROW
// (FR-002, pattern EXT_MISSING_FILE/BRG_MISSING_FILE) — never a result.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { OutputsLoadResult } from '../contracts/index.js';
import { parseOutputsYaml } from './outputs-yaml.js';

export const OUTPUTS_FILE = join('.ycsf', 'outputs.yaml');
const OUTPUTS_FILE_LABEL = '.ycsf/outputs.yaml';

export function loadOutputs(rootDir: string): OutputsLoadResult {
  const filePath = join(rootDir, OUTPUTS_FILE);
  if (!existsSync(filePath)) {
    throw new Error(`missing ${OUTPUTS_FILE_LABEL} (OUT_MISSING_FILE)`);
  }
  const text = readFileSync(filePath, 'utf8');
  return parseOutputsYaml(text, OUTPUTS_FILE_LABEL);
}