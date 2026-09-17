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

function expectComposeError(fn: () => void, expected: Record<string, unknown>): void {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ name: 'ComposeError', ...expected });
    return;
  }
  throw new Error(`expected ComposeError ${JSON.stringify(expected)} but no error was thrown`);
}

describe('mergeDocuments — conflict matrix (US2, FR-004/005/006)', () => {
  it('same path string across two apps → COMPOSE_PATH_COLLISION with both apps (US2/AC1)', () => {
    expectComposeError(
      () =>
        mergeDocuments([
          { appId: 'user_service', doc: doc('3.0.0', { '/users': { get: {} } }) },
          { appId: 'analytics', doc: doc('3.0.0', { '/users': { post: {} } }) },
        ]),
      { code: 'COMPOSE_PATH_COLLISION', path: '/users', apps: ['analytics', 'user_service'] },
    );
  });

  it('same path with only DIFFERENT methods is STILL a collision (strict path partition)', () => {
    expectComposeError(
      () =>
        mergeDocuments([
          { appId: 'user_service', doc: doc('3.0.0', { '/users': { get: {} } }) },
          { appId: 'analytics', doc: doc('3.0.0', { '/users': { delete: {} } }) },
        ]),
      { code: 'COMPOSE_PATH_COLLISION', path: '/users' },
    );
  });

  it('same operationId on different paths across apps → COMPOSE_OPERATIONID_COLLISION (US2/AC2)', () => {
    expectComposeError(
      () =>
        mergeDocuments([
          { appId: 'user_service', doc: doc('3.0.0', { '/a': { get: { operationId: 'listX' } } }) },
          { appId: 'analytics', doc: doc('3.0.0', { '/b': { post: { operationId: 'listX' } } }) },
        ]),
      {
        code: 'COMPOSE_OPERATIONID_COLLISION',
        operationId: 'listX',
        paths: ['/a', '/b'],
        apps: ['analytics', 'user_service'],
      },
    );
  });

  it('duplicate operationId WITHIN a single app (self-collision) → same code (edge)', () => {
    expectComposeError(
      () =>
        mergeDocuments([
          {
            appId: 'user_service',
            doc: doc('3.0.0', {
              '/a': { get: { operationId: 'dup' } },
              '/b': { post: { operationId: 'dup' } },
            }),
          },
        ]),
      { code: 'COMPOSE_OPERATIONID_COLLISION', operationId: 'dup', paths: ['/a', '/b'] },
    );
  });

  it('same component name in two apps → COMPOSE_COMPONENT_COLLISION (US2/AC3)', () => {
    expectComposeError(
      () =>
        mergeDocuments([
          { appId: 'user_service', doc: doc('3.0.0', {}, { schemas: { UserDto: {} } }) },
          { appId: 'analytics', doc: doc('3.0.0', {}, { schemas: { UserDto: {} } }) },
        ]),
      { code: 'COMPOSE_COMPONENT_COLLISION', componentName: 'UserDto', apps: ['analytics', 'user_service'] },
    );
  });
});

describe('mergeDocuments — order independence of conflict reports (US2, FR-017, V)', () => {
  it('the SAME conflict in either participant order reports the same code and context', () => {
    const forward = [
      { appId: 'user_service', doc: doc('3.0.0', { '/users': { get: { operationId: 'listX' } }, '/b': {} }) },
      { appId: 'analytics', doc: doc('3.0.0', { '/a': { get: { operationId: 'listX' } } }) },
    ];
    const backward = [...forward].reverse();

    let forwardErr: Record<string, unknown> = {};
    let backwardErr: Record<string, unknown> = {};
    try {
      mergeDocuments(forward);
    } catch (err) {
      forwardErr = {
        code: (err as { code: string }).code,
        operationId: (err as { operationId: string }).operationId,
        paths: (err as { paths: string[] }).paths.slice().sort(),
        apps: (err as { apps: string[] }).apps.slice().sort(),
      };
    }
    try {
      mergeDocuments(backward);
    } catch (err) {
      backwardErr = {
        code: (err as { code: string }).code,
        operationId: (err as { operationId: string }).operationId,
        paths: (err as { paths: string[] }).paths.slice().sort(),
        apps: (err as { apps: string[] }).apps.slice().sort(),
      };
    }
    expect(forwardErr).toEqual(backwardErr);
    expect(forwardErr).toMatchObject({
      code: 'COMPOSE_OPERATIONID_COLLISION',
      operationId: 'listX',
      paths: ['/a', '/users'],
      apps: ['analytics', 'user_service'],
    });
  });
});

describe('sortRecordKeys — canonical normalization helper', () => {
  it('returns a new record with lexicographically sorted keys', () => {
    const sorted = sortRecordKeys({ b: 1, a: 2, c: 3 });
    expect(Object.keys(sorted)).toEqual(['a', 'b', 'c']);
    expect(sorted).toEqual({ a: 2, b: 1, c: 3 });
  });
});

describe('mergeDocuments — documented path-template limitation (T037, Edge cases)', () => {
  it('path-template differences (/users/{id} vs /users/{name}) are NOT detected as a collision — string equality only', () => {
    const merged = mergeDocuments([
      { appId: 'user_service', doc: doc('3.0.0', { '/users/{id}': { get: {} } }) },
      { appId: 'analytics', doc: doc('3.0.0', { '/users/{name}': { get: {} } }) },
    ]);
    expect(Object.keys(merged.paths).sort()).toEqual(['/users/{id}', '/users/{name}']);
  });
});