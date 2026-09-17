import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/**
 * Hermetic mkdtemp fixture factories (T007). All fixtures live in `mkdtemp`
 * dirs and mutate nothing global; callers dispose via the returned root.
 */

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `materializers-core-${prefix}-`));
}

/**
 * Minimal stored-method ZIP writer (no external deps). Enough to produce a
 * structurally valid single-file archive whose bytes are deterministic.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(fileName: string, data: Buffer): Buffer {
  const name = Buffer.from(fileName, 'utf8');

  const local = Buffer.alloc(30 + name.length);
  local.write('PK\x03\x04');
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.write('PK\x01\x02');
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.write('PK\x05\x06');
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, data, central, eocd]);
}

export interface ZipFixture {
  /** Absolute path to the zip file on disk. */
  readonly path: string;
  /** `join('.', relative(process.cwd(), path))` — the infra-relative artifact form (DQ-2). */
  readonly relativePath: string;
  /** SHA-256 hex of the zip file bytes as written to disk. */
  readonly sha256: string;
}

/** Write a real single-entry zip under `tmpRoot` with known content bytes. */
export function makeZipUnder(tmpRoot: string, filename: string, bytes: Buffer): ZipFixture {
  const path = join(tmpRoot, filename);
  const archive = buildZip('index.js', bytes);
  writeFileSync(path, archive);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const relativePath = join('.', relative(process.cwd(), path)).split('\\').join('/');
  return { path, relativePath, sha256 };
}

/** Stable fixture bytes for a function archive. */
export function makeArchiveBytes(): Buffer {
  return Buffer.from('export async function handler() { return { ok: true }; }\n', 'utf8');
}

/** Write an OpenAPI YAML spec file to a tmp dir; returns its absolute path. */
export function makeSpecFile(content: string): string {
  const dir = makeTempDir('spec-');
  const path = join(dir, 'openapi.yaml');
  writeFileSync(path, content, 'utf8');
  return path;
}

/** A B-composed spec containing a logical resource reference (spec 009 syntax). */
export function makeSpecContent(): string {
  return [
    'openapi: "3.0.0"',
    'info:',
    '  title: openapi',
    '  version: "1.0.0"',
    'x-yc-apigateway:',
    '  backend:',
    '    function_id: ${resources.functions.user_service.id}',
    'paths: {}',
    '',
  ].join('\n');
}

/** tmp dir populated with one file per entry of `files`; returns the dir path. */
export function makeStaticDir(files: readonly string[] = ['index.html', 'style.css', 'app.js']): string {
  const dir = makeTempDir('static-');
  for (const file of files) {
    writeFileSync(join(dir, file), `/* ${file} */\n`, 'utf8');
  }
  return dir;
}

/** tmp (empty) dir — the empty-frontend fixture (FR-024). */
export function makeEmptyDir(): string {
  return makeTempDir('empty-');
}

/**
 * tmp dir with a nested structure (T116): the same `logo.png` basename appears
 * in two dirs and there is a deeper level — proves keys use the POSIX relative
 * path and TF names stay collision-free after sanitization.
 */
export function makeNestedStaticDir(): string {
  const dir = makeTempDir('nested-static-');
  writeFileSync(join(dir, 'index.html'), '/* index.html */\n', 'utf8');
  mkdirSync(join(dir, 'assets', 'img'), { recursive: true });
  mkdirSync(join(dir, 'img'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'logo.png'), '/* assets logo */\n', 'utf8');
  writeFileSync(join(dir, 'assets', 'img', 'banner.svg'), '/* banner */\n', 'utf8');
  writeFileSync(join(dir, 'img', 'logo.png'), '/* img logo */\n', 'utf8');
  return dir;
}

/** Read a file back as utf8 (companion content assertions). */
export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function makeQueueUrl(valid: boolean): string {
  return valid
    ? 'https://message-queue.api.cloud.yandex.net/b1g1/queues/my-queue'
    : 'https://message-queue.api.cloud.yandex.net/path-without-queues';
}