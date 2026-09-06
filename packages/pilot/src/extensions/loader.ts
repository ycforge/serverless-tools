// spec 015 extensions — loader: reads `.ycsf/extensions.yaml` under rootDir.
// Missing file → throw (EXT_MISSING_FILE); structurally invalid → `invalid`
// result. The loader deliberately does NOT check duplicate targets — that is
// the apply-time concern (A7, FR-005).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionsLoadResult } from '../contracts/index.js';
import { parseExtensionsYaml } from './extensions-yaml.js';

export function loadExtensions(rootDir: string): ExtensionsLoadResult {
  let text: string;
  try {
    text = readFileSync(join(rootDir, '.ycsf', 'extensions.yaml'), 'utf8');
  } catch {
    throw new Error('missing .ycsf/extensions.yaml (EXT_MISSING_FILE)');
  }

  const parsed = parseExtensionsYaml(text, '.ycsf/extensions.yaml');
  if (parsed.kind === 'invalid') return { kind: 'invalid', errors: parsed.errors };

  return { kind: 'ok', data: parsed.data };
}