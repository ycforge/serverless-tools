import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.terraform', 'artifacts', 'cache', 'dist', 'tmp', 'test']);
const SKIP_FILES = new Set(['.env.example', 'package-lock.json', 'pnpm-lock.yaml']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.gz', '.lock.hcl']);

// Value-aware scan: matches only <KEY>[:=]<non-empty value>; пропускает e.g.
// .env.example-вокабуляр («YC_TOKEN=» без значения) и prose README.
const PATTERNS = [
  /(^|\n)\s*[A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*[:=]\s*\S/,
  /(^|\n)\s*[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*[:=]\s*\S/,
  /(^|\n)\s*[A-Za-z0-9_]*PASSWORD[A-Za-z0-9_]*\s*[:=]\s*\S/,
  /(^|\n)\s*[A-Za-z0-9_]*KEY[A-Za-z0-9_]*\s*[:=]\s*\S/,
  /\{\{\$ENV\}\}/,
];

export function scanText(text: string): string[] {
  const hits: string[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re, 'gm'))) {
      hits.push(m[0].trim().split('\n')[0]);
    }
  }
  return hits;
}

function committedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else {
        const name = e.name.split('.').pop() ?? '';
        if (
          !SKIP_FILES.has(e.name) &&
          name !== '.ycsf.tf.json' &&
          ![...BINARY_EXT].some((x) => e.name.endsWith(x)) &&
          statSync(p).size <= 1_000_000
        ) {
          out.push(p);
        }
      }
    }
  };
  walk(ROOT);
  return out;
}

describe('secret-scan', () => {
  it('в коммите-дереве нет секретных присваиваний и {{$ENV}}', () => {
    const files = committedFiles();
    expect(files.length).toBeGreaterThan(10);
    const bad: Array<[string, string[]]> = [];
    for (const f of files) {
      const hits = scanText(readFileSync(f, 'utf8'));
      if (hits.length) bad.push([f, hits]);
    }
    expect(bad).toEqual([]);
  });

  it('сторожевой RED: инъекция TOKEN-присваивания ловится', () => {
    const probe = 'build_env:\n  VITE_TOKEN: injected-secret\n  ok: 1\n';
    const hits = scanText(probe);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('VITE_TOKEN');
  });

  it('.env.example содержит только пустые ссылки на runtime-env (без значений)', () => {
    const dotenv = readFileSync(join(ROOT, '.env.example'), 'utf8');
    for (const line of dotenv.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))) {
      expect(line).toMatch(/^[A-Z_]+=$/);
    }
  });
});