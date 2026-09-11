// spec 022 — fingerprint helpers
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(canonicalize(obj));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = canonicalize(obj[k]);
  }
  return sorted;
}

export function hashString(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export interface OwnFingerprintInputs {
  readonly filesHash: string;
  readonly buildConfig: unknown;
  readonly buildEnv: Readonly<Record<string, string>>;
  readonly builder: string;
}

export function computeOwnFingerprint(inputs: OwnFingerprintInputs): string {
  const payload = canonicalJson({
    filesHash: inputs.filesHash,
    buildConfig: inputs.buildConfig,
    buildEnv: inputs.buildEnv,
    builder: inputs.builder,
  });
  return hashString(payload);
}

export function computeEffectiveFingerprint(own: string, depEffects: readonly string[]): string {
  if (depEffects.length === 0) return own;
  const sorted = [...depEffects].sort();
  return hashString(own + '|' + sorted.join('|'));
}

// fixed excludes per spec S-2
const EXCLUDED_DIR_NAMES = new Set(['.git', 'node_modules']);
const EXCLUDED_PATH_PREFIXES = ['.ycsf/cache', '.ycsf/artifacts', 'infra'];

function isExcluded(relativePosix: string): boolean {
  // check dir components
  const parts = relativePosix.split('/');
  for (const p of parts) {
    if (EXCLUDED_DIR_NAMES.has(p)) return true;
  }
  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (relativePosix === prefix || relativePosix.startsWith(prefix + '/')) return true;
  }
  return false;
}

export async function computeFilesHash(projectRoot: string, sourcePath: string | undefined): Promise<string> {
  const absSource = sourcePath ? join(projectRoot, sourcePath) : projectRoot;
  const entries: Array<{ rel: string; hash: string }> = [];
  try {
    await collectFiles(absSource, projectRoot, entries);
  } catch (e) {
    if (e instanceof Error && e.message.includes('symlink')) throw e;
    return hashString('');
  }
  if (entries.length === 0) {
    return hashString('');
  }
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const e of entries) {
    h.update(e.rel, 'utf8');
    h.update('\0', 'utf8');
    h.update(e.hash, 'utf8');
    h.update('\0', 'utf8');
  }
  return h.digest('hex');
}

async function collectFiles(dir: string, projectRoot: string, out: Array<{ rel: string; hash: string }>): Promise<void> {
  let st;
  try {
    st = await stat(dir);
  } catch {
    // if dir doesn't exist, treat as empty? but spec says exists check; we throw
    throw new Error('source_path missing');
  }
  if (!st.isDirectory()) {
    // single file source_path
    const rel = toPosixRelative(projectRoot, dir);
    if (!isExcluded(rel)) {
      const fileHash = await hashFile(dir);
      out.push({ rel, hash: fileHash });
    }
    return;
  }
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const d of dirents) {
    const full = join(dir, d.name);
    const rel = toPosixRelative(projectRoot, full);
    if (isExcluded(rel)) continue;
    if (d.isSymbolicLink()) {
      // symlink → error will be treated as miss
      throw new Error(`symlink not supported: ${rel}`);
    }
    if (d.isDirectory()) {
      await collectFiles(full, projectRoot, out);
    } else if (d.isFile()) {
      const fileHash = await hashFile(full);
      out.push({ rel, hash: fileHash });
    }
  }
}

function toPosixRelative(projectRoot: string, fullPath: string): string {
  const rel = relative(projectRoot, fullPath);
  // posix normalize
  return rel.split('/').join(posix.sep).split('\\').join(posix.sep) || '.';
  // Actually we want POSIX with /; relative already uses OS sep, convert
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(filePath);
    s.on('data', (chunk) => h.update(chunk as Buffer));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export function resolveBuilderVersion(registry: { records: Map<string, { packageName?: string }> }, builderId: string): string | null {
  const rec = registry.records.get(builderId) as { packageName?: string } | undefined;
  const pkgName = rec?.packageName;
  if (!pkgName) return null;
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve(`${pkgName}/package.json`);
    const content = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(content) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}
