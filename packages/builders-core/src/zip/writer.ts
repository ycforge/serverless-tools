/**
 * Dependency-free deterministic ZIP writer (DQ-1, research D-RE-7).
 *
 * Per-entry deflateRawSync with a STORE fallback when deflated >= raw,
 * fixed DOS time/date = 0, hand-rolled CRC-32, entries sorted by normalized
 * path, no directory entries. Throws `BLC_ARCHIVE_FAILED` on fs errors.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { constants as ZLIB, deflateRawSync } from 'node:zlib';

import { BLC_ARCHIVE_FAILED, builderError } from '../diagnostics.js';

export interface ZipEntryInput {
  readonly path: string; // normalized, forward-slash, relative
  readonly data: Uint8Array;
  /** Whole-second source timestamp (informational); DOS time/date is always 0. */
  readonly mtime: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const CRC_TABLE: readonly number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return Object.freeze(table);
})();

/** Classic CRC-32 (IEEE 802.3, reflected). `crc32('123456789') === 0xCBF43926`. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

interface CentralRecord {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly compSize: number;
  readonly uncompSize: number;
  readonly offset: number;
}

function writeEntry(
  name: Buffer,
  payload: Buffer,
  crc: number,
  method: number,
  chunks: Buffer[],
): void {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(LOCAL_HEADER, 0);
  local.writeUInt16LE(20, 4); // version needed 2.0
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10); // DOS time = 0
  local.writeUInt16LE(0, 12); // DOS date = 0
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra field
  chunks.push(local, name, payload);
}

/** Deterministically serialize+write sorted entries to `outPath`. */
export function zipEntries(entries: readonly ZipEntryInput[], outPath: string): void {
  try {
    const sorted = entries
      .map((e) => ({ path: normalizePath(e.path), data: e.data }))
      .filter((e) => e.path.length > 0 && !e.path.endsWith('/'))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const chunks: Buffer[] = [];
    const central: CentralRecord[] = [];
    let offset = 0;

    for (const entry of sorted) {
      const bytes = Buffer.from(entry.data);
      const crc = crc32(bytes);
      let method = 0;
      let payload: Buffer = bytes;
      if (bytes.length > 0) {
        const deflated = deflateRawSync(bytes, { level: ZLIB.Z_DEFAULT_COMPRESSION });
        if (deflated.length < bytes.length) {
          method = 8;
          payload = deflated;
        }
      }
      const name = Buffer.from(entry.path, 'utf8');
      writeEntry(name, payload, crc, method, chunks);
      central.push({
        name,
        method,
        crc,
        compSize: payload.length,
        uncompSize: bytes.length,
        offset,
      });
      offset += 30 + name.length + payload.length;
    }

    const cdOffset = offset;
    const centralChunks: Buffer[] = [];
    for (const record of central) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(CENTRAL_HEADER, 0);
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0, 8); // flags
      cd.writeUInt16LE(record.method, 10);
      cd.writeUInt16LE(0, 12); // DOS time
      cd.writeUInt16LE(0, 14); // DOS date
      cd.writeUInt32LE(record.crc, 16);
      cd.writeUInt32LE(record.compSize, 20);
      cd.writeUInt32LE(record.uncompSize, 24);
      cd.writeUInt16LE(record.name.length, 28);
      cd.writeUInt16LE(0, 30); // extra len
      cd.writeUInt16LE(0, 32); // comment len
      cd.writeUInt16LE(0, 34); // disk number
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(record.offset, 42);
      centralChunks.push(cd, record.name);
    }

    const cdSize = central.reduce((sum, record) => sum + 46 + record.name.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // cd start disk
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment len

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.concat([...chunks, ...centralChunks, eocd]));
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw builderError(BLC_ARCHIVE_FAILED, `zip write failed: ${cause} (${BLC_ARCHIVE_FAILED})`);
  }
}