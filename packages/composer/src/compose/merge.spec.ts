import { describe, expect, it } from 'vitest';

import type { OpenApiDocument } from '../errors.js';
import type { MergeParticipant } from './types.js';
import { mergeDocuments, sortRecordKeys } from './merge.js';

function doc(openapi: string, paths: Record<string, unknown>, components?: unknown): OpenApiDocument {
  return { openapi, info: { title: 'app', version: '1.0.0' }, paths, components };
}

const appA: MergeParticipant = {
  appId: 'a',
  doc: doc(
    '3.0.0',
    { '/a': { get: { operationId: 'getA' } }, '/zz': { get: {} } },
    { schemas: { ADto: { type: 'object' } }, securitySchemes: { sA: { type: 'apiKey' } } },
  ),
};

describe('mergeDocuments — US1 merge (FR-002/016/017)', () => {
  it('merges two non-overlapping docs into the union of paths and components (US1/AC1)', () => {
    const merged = mergeDocuments([
      appA,
      { appId: 'b', doc: doc('3.0.0', { '/b': { get: { operationId: 'getB' } } }, { schemas: { BDto: {} } }) },
    ]);
    expect(Object.keys(merged.paths).sort()).toEqual(['/a', '/b', '/zz']);
    expect(merged.components).toEqual({
      schemas: { ADto: { type: 'object' }, BDto: {} },
      securitySchemes: { sA: { type: 'apiKey' } },
    });
  });

  it('an empty participant contributes an empty set, not an error (FR-002 edge)', () => {
    const merged = mergeDocuments([appA, { appId: 'empty', doc: doc('3.0.0', {}) }]);
    expect(Object.keys(merged.paths).sort()).toEqual(['/a', '/zz']);
    expect(merged.ownership.ownerOf('/a')).toBe('a');
  });

  it('rejects a version mismatch with COMPOSE_OPENAPI_VERSION_MISMATCH (FR-016)', () => {
    expect(() =>
      mergeDocuments([
        appA,
        { appId: 'b', doc: doc('3.1.0', { '/b': { get: {} } }) },
      ]),
    ).toThrowError(
      expect.objectContaining({ name: 'ComposeError', code: 'COMPOSE_OPENAPI_VERSION_MISMATCH' }),
    );
  });

  it('normalizes merged paths/components keys canonically (lexicographic) (FR-017, SC-002)', () => {
    const merged = mergeDocuments([
      appA,
      { appId: 'b', doc: doc('3.0.0', { '/zzz': { get: {} } }, { schemas: { ZDto: {} } }) },
    ]);
    const pathKeys = Object.keys(merged.paths);
    expect(pathKeys).toEqual([...pathKeys].sort());
    expect(pathKeys).toEqual(['/a', '/zz', '/zzz']);
    const componentKeys = Object.keys(merged.components);
    expect(componentKeys).toEqual([...componentKeys].sort());
  });

  it('never mutates the input documents (FR-014)', () => {
    const input = [`${JSON.stringify(appA.doc)}\n`];
    const before = input[0];
    mergeDocuments([appA, { appId: 'b', doc: doc('3.0.0', { '/b': {} }) }]);
    expect(`${JSON.stringify(appA.doc)}\n`).toBe(before);
  });
});

describe('sortRecordKeys — canonical normalization helper', () => {
  it('returns a new record with lexicographically sorted keys', () => {
    const sorted = sortRecordKeys({ b: 1, a: 2, c: 3 });
    expect(Object.keys(sorted)).toEqual(['a', 'b', 'c']);
    expect(sorted).toEqual({ a: 2, b: 1, c: 3 });
  });
});