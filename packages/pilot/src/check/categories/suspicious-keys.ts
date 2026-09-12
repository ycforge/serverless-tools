// spec 025 ycsf-check — suspicious-keys category (FR-012..FR-016, US-4, SC-005).
// Value-free scan of raw YAML key names against a deterministic EXACT/SUFFIX
// denylist (D-4). The value of a suspicious key is never read or rendered.
// Collect-all: every hit becomes its own YCK_SUSPICIOUS_KEY with machine
// readable `reason` = `exact-match:<normalized>` | `suffix-match:<suffix>`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

import { YCK_SUSPICIOUS_KEY, type YckDiagnostic } from '../../contracts/check.js';
import { yck } from '../errors.js';

// D-4 denylist (additive; frozen by `const` — spec 025 §8).
const EXACT = new Set<string>([
  'token', 'password', 'passwd', 'secret', 'apikey', 'accesskey',
  'secretkey', 'clientsecret', 'privatekey', 'authorization',
  'credential', 'sessionid',
]);

const SUFFIX = new Set<string>([
  'token', 'password', 'passwd', 'secret', 'apikey', 'accesskey',
  'secretkey', 'clientsecret', 'privatekey',
]);

// Files scanned in FR-012 order, then `<appId>/build_config.yaml` per app.
const YCSF_FILES = [
  '.ycsf/apps.yaml',
  '.ycsf/builders.yaml',
  '.ycsf/outputs.yaml',
  '.ycsf/extensions.yaml',
  '.ycsf/moved.yaml',
  '.ycsf/resources.yaml',
] as const;

export interface SuspiciousScanModel {
  readonly apps: ReadonlyMap<string, unknown>;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSuspicious(normalized: string): { suspicious: boolean; reason?: string } {
  if (EXACT.has(normalized)) {
    return { suspicious: true, reason: `exact-match:${normalized}` };
  }
  for (const suffix of SUFFIX) {
    if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
      return { suspicious: true, reason: `suffix-match:${suffix}` };
    }
  }
  return { suspicious: false };
}

function scanObject(
  value: unknown,
  path: readonly string[],
  file: string,
  diagnostics: YckDiagnostic[],
): void {
  if (typeof value !== 'object' || value === null) return;

  // Objects and arrays walk uniformly (array indices are string keys here).
  for (const [rawKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawKey !== 'string') continue; // non-string keys ignored
    const nextPath = [...path, rawKey];

    const normalized = normalizeKey(rawKey);
    const verdict = isSuspicious(normalized);
    if (verdict.suspicious === true) {
      diagnostics.push(
        yck({
          code: YCK_SUSPICIOUS_KEY,
          message: `suspicious key '${rawKey}' at '${nextPath.join('.')}' in ${file} (YCK_SUSPICIOUS_KEY)`,
          file,
          field: nextPath.join('.'),
          key: rawKey,
          ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
        }),
      );
    }

    scanObject(child, nextPath, file, diagnostics);
  }
}

export function scanSuspiciousKeys(rootDir: string, model: SuspiciousScanModel): readonly YckDiagnostic[] {
  const diagnostics: YckDiagnostic[] = [];

  const files: string[] = [...YCSF_FILES];
  for (const appId of [...model.apps.keys()].sort()) {
    files.push(`${appId}/build_config.yaml`);
  }

  // Each file is opened exactly once; unreadable or syntactically broken files
  // are skipped silently (the dedicated validators own structure errors).
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(rootDir, file), 'utf8');
    } catch {
      continue;
    }

    let data: unknown;
    try {
      const doc = parseDocument(content);
      if (doc.errors.length > 0) continue;
      data = doc.toJS();
    } catch {
      continue;
    }

    scanObject(data, [], file, diagnostics);
  }

  return diagnostics;
}