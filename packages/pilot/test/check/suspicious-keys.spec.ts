import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { YCK_SUSPICIOUS_KEY } from '../../src/contracts/check.js';
import { scanSuspiciousKeys } from '../../src/check/categories/suspicious-keys.js';

// T027: scanSuspiciousKeys — raw-YAML value-free walk over the EXACT/SUFFIX
// denylist (D-4), collect-all YCK_SUSPICIOUS_KEY (FR-012..FR-015, US-4).

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pilot-suspicious-keys-'));
}

function writeYcsf(root: string, filename: string, yaml: string): void {
  mkdirSync(dirname(join(root, filename)), { recursive: true });
  writeFileSync(join(root, filename), yaml, 'utf8');
}

function scanIn(root: string, appIds: string[] = ['user_service']): ReturnType<typeof scanSuspiciousKeys> {
  const apps = new Map(appIds.map((id) => [id, id]));
  return scanSuspiciousKeys(root, { apps });
}

function flush(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe('scanSuspiciousKeys', () => {
  it('EXACT positives: api_key, db_password, access_token, DB_TOKEN, client_secret, authorization all flagged', () => {
    const root = tmpRoot();
    try {
      writeYcsf(
        root,
        '.ycsf/apps.yaml',
        `version: 1
api_key: v1
db_password: v2
access_token: v3
DB_TOKEN: v4
client_secret: v5
authorization: v6
`,
      );
      const diagnostics = scanIn(root);
      const flagged = diagnostics.filter((d) => d.code === YCK_SUSPICIOUS_KEY);
      expect(flagged.map((d) => d.key)).toEqual(
        expect.arrayContaining(['api_key', 'db_password', 'access_token', 'DB_TOKEN', 'client_secret', 'authorization']),
      );
      const reasons = new Set(flagged.map((d) => d.reason));
      expect(reasons).toContain('exact-match:apikey');
      expect(reasons).toContain('exact-match:clientsecret');
      expect(reasons).toContain('exact-match:authorization');
      // dbtoken is not in the EXACT set → flagged via SUFFIX (D-4)
      expect(reasons).toContain('suffix-match:token');
      expect(reasons).toContain('suffix-match:password');
      // value-free: message renders key + path, never the value
      for (const d of flagged) {
        expect(d.message).not.toMatch(/v[1-6]/);
      }
    } finally {
      flush(root);
    }
  });

  it('D-4 boundary/negatives: token_endpoint NOT flagged, secretary NOT flagged, refresh_token pinned as conscious false-positive', () => {
    const root = tmpRoot();
    try {
      writeYcsf(
        root,
        '.ycsf/apps.yaml',
        `version: 1
token_endpoint: v1
refresh_token: v2
secretary: v3
`,
      );
      const diagnostics = scanIn(root);
      const flaggedKeys = new Set(diagnostics.map((d) => d.key));
      expect(flaggedKeys.has('token_endpoint')).toBe(false);
      expect(flaggedKeys.has('secretary')).toBe(false);
      expect(flaggedKeys.has('refresh_token')).toBe(true);
      const refresh = diagnostics.find((d) => d.key === 'refresh_token');
      expect(refresh?.reason).toBe('suffix-match:token');
    } finally {
      flush(root);
    }
  });

  it('numeric/non-string keys are ignored', () => {
    const root = tmpRoot();
    try {
      writeYcsf(
        root,
        '.ycsf/apps.yaml',
        `version: 1
123: v1
true: v2
`,
      );
      expect(scanIn(root)).toHaveLength(0);
    } finally {
      flush(root);
    }
  });

  it('walk goes through nesting + array indices: extensions.0.patch.API_KEY', () => {
    const root = tmpRoot();
    try {
      writeYcsf(
        root,
        '.ycsf/extensions.yaml',
        `version: 1
extensions:
  - target: x
    patch:
      API_KEY: raw
`,
      );
      const diagnostics = scanIn(root);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.field).toBe('extensions.0.patch.API_KEY');
      expect(diagnostics[0]?.key).toBe('API_KEY');
      expect(diagnostics[0]?.file).toBe('.ycsf/extensions.yaml');
    } finally {
      flush(root);
    }
  });

  it('collect-all: >=2 diagnostics for one run (FR-015 collect-all)', () => {
    const root = tmpRoot();
    try {
      writeYcsf(
        root,
        '.ycsf/apps.yaml',
        `version: 1
api_key: v1
db_password: v2
`,
      );
      const diagnostics = scanIn(root);
      expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    } finally {
      flush(root);
    }
  });

  it('missing files → silence (0 diagnostics)', () => {
    const root = tmpRoot();
    try {
      expect(scanIn(root)).toHaveLength(0);
    } finally {
      flush(root);
    }
  });

  it('syntactically broken YAML → skipped (never duplicates validators)', () => {
    const root = tmpRoot();
    try {
      writeYcsf(root, '.ycsf/apps.yaml', 'version: 1\n  bad indent: [\n');
      writeYcsf(root, 'user_service/build_config.yaml', 'version: 1\n  broken\n');
      expect(scanIn(root)).toHaveLength(0);
    } finally {
      flush(root);
    }
  });

  it('per-app build_config.yaml scanned: build_config.DB_TOKEN flagged with file+field', () => {
    const root = tmpRoot();
    try {
      writeYcsf(
        root,
        'user_service/build_config.yaml',
        `version: 1
build_config:
  DB_TOKEN: [tok]
build_env: {}
`,
      );
      const diagnostics = scanIn(root);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.file).toBe('user_service/build_config.yaml');
      expect(diagnostics[0]?.field).toBe('build_config.DB_TOKEN');
      expect(diagnostics[0]?.reason).toBe('suffix-match:token');
    } finally {
      flush(root);
    }
  });
});