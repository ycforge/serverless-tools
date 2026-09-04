import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { appendByteCapped, resolveRunnerPath, spawnRunner } from './spawn-runner.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/runner-apps/', import.meta.url));
const APP_ROOT = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));

const OVERFLOW_NOTE = '\n<maximum bytes exceeded; rest omitted>';

describe('appendByteCapped', () => {
  it('enforces the cap in bytes, not characters (multi-byte UTF-8)', () => {
    const acc = { text: '', bytes: 0 };
    const euros = Buffer.from('€'.repeat(10), 'utf8');
    expect(euros.length).toBe(30);
    appendByteCapped(acc, euros, 12, OVERFLOW_NOTE);
    expect(acc.bytes).toBe(12);
    const payload = acc.text.slice(0, -OVERFLOW_NOTE.length);
    expect(Buffer.byteLength(payload)).toBe(12);
    expect(payload).toBe('€'.repeat(4));
  });

  it('keeps appending across chunks while under the cap and stops past it', () => {
    const acc = { text: '', bytes: 0 };
    appendByteCapped(acc, Buffer.from('abc'), 5, OVERFLOW_NOTE);
    appendByteCapped(acc, Buffer.from('de'), 5, OVERFLOW_NOTE);
    expect(acc.bytes).toBe(5);
    expect(acc.text).toBe('abcde');
    appendByteCapped(acc, Buffer.from('xyz'), 5, OVERFLOW_NOTE);
    expect(acc.text).toBe('abcde');
  });

  it('appends the overflow note exactly once on a partial chunk', () => {
    const acc = { text: '', bytes: 0 };
    appendByteCapped(acc, Buffer.from('abcdef'), 4, OVERFLOW_NOTE);
    appendByteCapped(acc, Buffer.from('ghi'), 4, OVERFLOW_NOTE);
    expect(acc.bytes).toBe(4);
    expect(acc.text).toBe(`abcd${OVERFLOW_NOTE}`);
  });
});

describe('resolveRunnerPath', () => {
  it('resolves the shipped runner script from a source-layout import.meta.url', () => {
    const sourceModule = new URL('../../src/runner/spawn-runner.js', import.meta.url).href;
    const path = resolveRunnerPath(sourceModule);
    expect(path).toBe(fileURLToPath(new URL('../../runner/runner.mjs', import.meta.url)));
    expect(existsSync(path)).toBe(true);
  });

  it('resolves the shipped runner script from a bundled dist/index.js import.meta.url', () => {
    const distEntry = new URL('../../dist/index.js', import.meta.url).href;
    const path = resolveRunnerPath(distEntry);
    expect(path).toBe(fileURLToPath(new URL('../../runner/runner.mjs', import.meta.url)));
    expect(existsSync(path)).toBe(true);
  });
});

describe('spawnRunner', () => {
  it('returns the document produced by the entry, with the safe-mode env visible inside the child', async () => {
    const doc = await spawnRunner(APP_ROOT, `${FIXTURES}runner-ok.mjs`, 10000);
    expect(doc?.['info']).toEqual({ title: 'runner-ok', version: '1.0.0' });
    expect(doc?.['x-env-observed']).toBe('1');
  });

  it('classifies an entry that throws as ENTRY_EXECUTION_FAILED without exposing app error detail, ignoring lookalike stderr markers', async () => {
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}runner-throws.mjs`, 10000),
    ).rejects.toMatchObject({ code: 'ENTRY_EXECUTION_FAILED' });
    const err = await spawnRunner(APP_ROOT, `${FIXTURES}runner-throws.mjs`, 10000).catch(
      (e: Error) => e,
    );
    expect(err.message).not.toContain('SUPER-SECRET-xyz');
    expect(err.message).not.toContain('boom: provider init failed');
  });

  it('still returns the document when the entry writes to stdout and stderr (console.log)', async () => {
    const doc = await spawnRunner(APP_ROOT, `${FIXTURES}runner-console-log.mjs`, 10000);
    expect(doc?.['info']).toEqual({ title: 'runner-console-log', version: '1.0.0' });
  });

  it('kills a hanging entry as ENTRY_TIMEOUT and leaves the main process alive', async () => {
    const started = Date.now();
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}runner-hangs.mjs`, 250),
    ).rejects.toMatchObject({ code: 'ENTRY_TIMEOUT' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it('classifies a child that writes malformed bytes on the result channel as ENTRY_RETURNED_INVALID', async () => {
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}runner-garbage.mjs`, 10000),
    ).rejects.toMatchObject({ code: 'ENTRY_RETURNED_INVALID' });
  });

  it('classifies a missing entry as ENTRY_LOAD_FAILED', async () => {
    await expect(
      spawnRunner(APP_ROOT, `${FIXTURES}does-not-exist.mjs`, 10000),
    ).rejects.toMatchObject({ code: 'ENTRY_LOAD_FAILED' });
  });
});