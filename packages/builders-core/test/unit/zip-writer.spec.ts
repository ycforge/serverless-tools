import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BLC_ARCHIVE_FAILED } from '../../src/diagnostics.js';
import { crc32, zipEntries } from '../../src/zip/writer.js';
import { collectDir } from '../../src/zip/collect.js';
import { makeTempDir, unzipEntry, unzipList, unzipTest, type TempDir } from '../helpers/fixture-project.js';

// DQ-1: deterministic zip writer — STORE/deflate, CRC-32, DOS time/date = 0,
// sorted entries, no directory entries.

const CRC_CHECK_STRING = '123456789';

interface LocalHeader {
  readonly name: string;
  readonly time: number;
  readonly date: number;
  readonly method: number;
}

function localHeaders(buf: Buffer): LocalHeader[] {
  const out: LocalHeader[] = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const time = buf.readUInt16LE(off + 10);
    const date = buf.readUInt16LE(off + 12);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const compLen = buf.readUInt32LE(off + 22);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    out.push({ name, time, date, method });
    off += 30 + nameLen + extraLen + compLen;
  }
  return out;
}

describe('zip/writer DQ-1 determinism + structural invariants', () => {
  it('crc32 matches the standard CRC-32 check value (0xCBF43926), empty → 0', () => {
    expect(crc32(Buffer.from(CRC_CHECK_STRING)).toString(16).toUpperCase()).toBe('CBF43926');
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('a')).toString(16).toUpperCase()).toBe('E8B7BE43');
  });

  it('zipEntries: writes a valid single-entry zip, creates missing parent dirs', async () => {
    const dir = makeTempDir('bc-zip-');
    const outPath = join(dir.root, 'nested', 'out.zip');
    await zipEntries([{ path: 'main.js', data: Buffer.from('console.log(1)\n'), mtime: 1_700_000_000 }], outPath);
    expect(unzipList(outPath)).toEqual(['main.js']);
    expect(unzipEntry(outPath, 'main.js').toString('utf8')).toBe('console.log(1)\n');
    unzipTest(outPath);
    dir.remove();
  });

  it('sorted entries regardless of input order; directory-like entries dropped', async () => {
    const dir = makeTempDir('bc-zip-');
    const outPath = join(dir.root, 'out.zip');
    await zipEntries(
      [
        { path: 'b.txt', data: Buffer.from('b'), mtime: 0 },
        { path: 'sub/d.txt', data: Buffer.from('d'), mtime: 0 },
        { path: 'a.txt', data: Buffer.from('a'), mtime: 0 },
        { path: 'sub/', data: Buffer.alloc(0), mtime: 0 },
      ],
      outPath,
    );
    expect(unzipList(outPath)).toEqual(['a.txt', 'b.txt', 'sub/d.txt']);
    dir.remove();
  });

  it('DOS time/date = 0 in every local header (fixed timestamp)', async () => {
    const dir = makeTempDir('bc-zip-');
    const outPath = join(dir.root, 'out.zip');
    const mtimes = [1_704_067_200, 1_600_000_000];
    await zipEntries(
      [
        { path: 'one.js', data: Buffer.from('1'), mtime: mtimes[0] ?? 0 },
        { path: 'two.js', data: Buffer.from('2'), mtime: mtimes[1] ?? 0 },
      ],
      outPath,
    );
    const headers = localHeaders(readFileSync(outPath));
    expect(headers.map((h) => h.time)).toEqual([0, 0]);
    expect(headers.map((h) => h.date)).toEqual([0, 0]);
    dir.remove();
  });

  it('determinism: identical entries → byte-identical archives', async () => {
    const dir = makeTempDir('bc-zip-');
    const a = join(dir.root, 'a.zip');
    const b = join(dir.root, 'b.zip');
    const entries = [
      { path: 'z.txt', data: Buffer.from('z'), mtime: 123 },
      { path: 'y.txt', data: Buffer.from('y'), mtime: 456 },
    ];
    await zipEntries(entries, a);
    await zipEntries(entries, b);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
    dir.remove();
  });

  it('BLC_ARCHIVE_FAILED when the zip write fails (read-only output dir)', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(true).toBe(true);
      return;
    }
    const dir = makeTempDir('bc-zip-');
    const roDir = join(dir.root, 'ro');
    mkdirSync(roDir);
    chmodSync(roDir, 0o555);
    try {
      zipEntries([{ path: 'a.txt', data: Buffer.from('a'), mtime: 0 }], join(roDir, 'out.zip'));
      expect.unreachable('zipEntries should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(BLC_ARCHIVE_FAILED);
    } finally {
      chmodSync(roDir, 0o755);
    }
    dir.remove();
  });
});

describe('zip/collect — collectDir', () => {
  it('collects files recursively (sorted), excludes .DS_Store and empty dirs', async () => {
    const dir = makeTempDir('bc-collect-');
    writeFileSync(join(dir.root, 'b.txt'), 'b');
    writeFileSync(join(dir.root, 'a.txt'), 'a');
    writeFileSync(join(dir.root, '.DS_Store'), 'junk');
    mkdirSync(join(dir.root, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(dir.root, 'nested', 'c.ts'), 'c');
    writeFileSync(join(dir.root, 'nested', 'deep', 'd.js'), 'd');
    mkdirSync(join(dir.root, 'empty-dir'), { recursive: true });

    const entries = await collectDir(dir.root);
    expect(entries.map((e) => e.path)).toEqual(['a.txt', 'b.txt', 'nested/c.ts', 'nested/deep/d.js']);
    expect(Buffer.from(entries.find((e) => e.path === 'a.txt')!.data).toString('utf8')).toBe('a');
    dir.remove();
  });

  it('mtime is floored to whole seconds', async () => {
    const dir = makeTempDir('bc-collect-');
    const file = join(dir.root, 'f.txt');
    writeFileSync(file, 'f');
    const expected = Math.floor(statSync(file).mtimeMs / 1000);
    const entries = await collectDir(dir.root);
    expect(entries[0]?.mtime).toBe(expected);
    dir.remove();
  });
});