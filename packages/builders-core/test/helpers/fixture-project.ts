import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test-fixture factories for hermetic builder unit tests (T007). All fixtures
 * live in `mkdtemp` dirs; callers must remove them (see `makeTempDir`).
 */

export interface TempDir {
  readonly root: string;
  remove(): void;
}

export function makeTempDir(prefix: string): TempDir {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** Write a map of `relPath → content` under `root`, creating parents. */
export function writeProject(root: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

/**
 * Minimal self-contained NestJS-style function fixture with an exported
 * `handler`. With `external`, adds a fake `node_modules/sharp` package (with a
 * distinctive source marker) resolvable from the fixture root.
 */
export function nestjsFixture(options: { external?: boolean } = {}): TempDir {
  const dir = makeTempDir('bc-nestjs-');
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'user_service', version: '0.0.0' }, null, 2),
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'src/main.ts': [
      `import { add } from './math';`,
      `export function handler(event: unknown): string {`,
      `  return 'ok:' + add(1, 2);`,
      `}`,
    ].join('\n'),
  };
  if (options.external) {
    files['src/main.ts'] = [
      `import sharp from 'sharp';`,
      `export function handler(): string {`,
      `  return 'sharp:' + typeof sharp;`,
      `}`,
    ].join('\n');
    files['node_modules/sharp/package.json'] = JSON.stringify(
      { name: 'sharp', version: '9.0.0', main: 'index.js' },
      null,
      2,
    );
    files['node_modules/sharp/index.js'] =
      'module.exports = function native() { return SHARP_NATIVE_MARKER.repeat(1); }; // SHARP_NATIVE_MARKER\n';
  }
  writeProject(dir.root, files);
  return dir;
}

/** Docker project fixture: a Dockerfile + a tiny app body. */
export function dockerFixture(): TempDir {
  const dir = makeTempDir('bc-docker-');
  writeProject(dir.root, {
    'Dockerfile': 'FROM node:22-alpine\nCMD ["node", "index.js"]\n',
    'index.js': 'console.log("analytics");\n',
  });
  return dir;
}

/**
 * Vite project fixture. The fake vite binary is placed at
 * `${root}/node_modules/.bin/vite` (the app owns its toolchain, D-RE-10).
 */
export function viteFixture(options: { withFakeVite?: boolean } = {}): TempDir {
  const dir = makeTempDir('bc-vite-');
  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      { name: 'frontend', version: '0.0.0', devDependencies: { vite: '^5.0.0' } },
      null,
      2,
    ),
    'index.html': '<!doctype html><html><body id="app"></body></html>\n',
    'src/main.ts': 'document.getElementById("app").textContent = "frontend";\n',
    'secret.txt': 'do-not-publish\n',
  };
  writeProject(dir.root, files);
  return dir;
}

/** `unzip -Z1` — list zip entry paths (stdout lines). */
export function unzipList(zipPath: string): string[] {
  const out = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return out.split('\n').filter((line) => line.length > 0);
}

/** `unzip -t` — integrity test; throws on a corrupt archive. */
export function unzipTest(zipPath: string): void {
  execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' });
}

/** `unzip -p` — extract one entry's bytes. */
export function unzipEntry(zipPath: string, entryPath: string): Buffer {
  return execFileSync('unzip', ['-p', zipPath, entryPath]);
}

/** Make an executable bash script (mode 0o755). */
export function writeExecutable(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}