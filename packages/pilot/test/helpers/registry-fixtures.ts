import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Registry test fixture helper (T002). Writes `.mjs` modules to a given
 * directory, returning absolute POSIX-safe paths for `import()`.
 *
 * These do NOT touch real `node_modules` or `builders.yaml`.
 */

export function writeFixtureModule(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name.endsWith('.mjs') ? name : `${name}.mjs`);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function createFixtureBuilder(name: string, exportStyle: 'default' | 'named' = 'default'): string {
  const dir = join(tmpdir(), `pilot-registry-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const code =
    exportStyle === 'default'
      ? `export default { build: async () => ({ type: 'ycforge:function', value: {} }) };\n`
      : `export const build = async () => ({ type: 'ycforge:function', value: {} });\n`;
  return writeFixtureModule(dir, `${name}.mjs`, code);
}

export function createFixtureMaterializer(name: string, exportStyle: 'default' | 'named' = 'default'): string {
  const dir = join(tmpdir(), `pilot-registry-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const code =
    exportStyle === 'default'
      ? `export default { supports: () => true, materialize: async () => ({}) };\n`
      : `export const supports = () => true;\nexport const materialize = async () => ({});\n`;
  return writeFixtureModule(dir, `${name}.mjs`, code);
}

export function createFixtureBoth(): string {
  const dir = join(tmpdir(), `pilot-registry-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const code = `export default {
  build: async () => ({ type: 'ycforge:function', value: {} }),
  supports: () => true,
  materialize: async () => ({}),
};\n`;
  return writeFixtureModule(dir, `both.mjs`, code);
}

export function createFixtureNotAPlugin(): string {
  const dir = join(tmpdir(), `pilot-registry-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const code = `export default { foo: () => {} };\n`;
  return writeFixtureModule(dir, `not-a-plugin.mjs`, code);
}

export function createFixtureLoadError(): string {
  const dir = join(tmpdir(), `pilot-registry-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const code = `throw new Error('boom');\n`;
  return writeFixtureModule(dir, `load-error.mjs`, code);
}
