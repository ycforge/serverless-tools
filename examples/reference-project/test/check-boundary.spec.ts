import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '../..');
const CLI = join(REPO, 'packages/pilot/dist/cli/index.js');

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ref-check-'));
  cpSync(ROOT, dir, {
    recursive: true,
    dereference: false,
    filter: (s) => !['node_modules', '.git', 'cache', 'artifacts', '.terraform', 'dist'].includes(s.split('/').pop() ?? ''),
  });
  return dir;
}

function runCheck(cwd: string): { code: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, 'check'], { cwd, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

describe.skipIf(!existsSync(CLI))('ycsf check — границы', () => {
  it('каноническое дерево: cold checkout → exit 0, All checks passed (T033)', () => {
    const { code, out } = runCheck(ROOT);
    expect(code).toBe(0);
    expect(out).toContain('All checks passed.');
  });

  it('suspicious-key RED: VITE_TOKEN в build_env → YCK_SUSPICIOUS_KEY (suffix-match)', () => {
    const dirty = makeTmpProject();
    try {
      writeFileSync(
        join(dirty, 'frontend/build_config.yaml'),
        '\n  VITE_TOKEN: injected-secret\n',
        { flag: 'a' } as Parameters<typeof writeFileSync>[2],
      );
      const { code, out } = runCheck(dirty);
      expect(code).toBe(1);
      expect(out).toContain('YCK_SUSPICIOUS_KEY');
      expect(out).toContain('suffix-match:token');
      expect(out).toContain("'VITE_TOKEN'");
    } finally {
      rmSync(dirty, { recursive: true, force: true });
    }
  });
});
