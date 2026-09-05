import { describe, expect, it } from 'vitest';

import type { GatewayDocument } from '../types.js';
import { PathOwnership } from '../provenance.js';
import type { OverrideFile } from './override-types.js';
import { applyOverrides } from './apply.js';

function ownershipOf(paths: Record<string, unknown>, appId = 'app'): PathOwnership {
  const ownership = new PathOwnership();
  for (const path of Object.keys(paths)) {
    ownership.assignPath(path, appId);
  }
  return ownership;
}

function baseDocument(): GatewayDocument {
  return {
    openapi: '3.0.0',
    paths: {
      '/users': { get: { operationId: 'listUsers', summary: 'orig' } },
      '/legacy': { get: { operationId: 'listLegacy' } },
    },
    components: {
      schemas: { UserDto: { type: 'object' } },
      securitySchemes: { auth: { type: 'apiKey', name: 'x', in: 'header' } },
    },
  };
}

function file(rules: OverrideFile['rules']): OverrideFile {
  return { version: 1, rules, sourcePath: '/root/overrides.yaml' };
}

const RULE = (raw: Omit<Parameters<typeof file>[0][number], 'ruleIndex'>, ruleIndex = 0) => ({
  ...raw,
  ruleIndex,
});

function expectComposeError(fn: () => void, expected: Record<string, unknown>): void {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ name: 'ComposeError', ...expected });
    return;
  }
  throw new Error(`expected ComposeError ${JSON.stringify(expected)} but none was thrown`);
}

describe('applyOverrides — target semantics (US3, FR-007/008/010)', () => {
  it('replace atomically replaces the WHOLE target value — no deep merge (FR-010)', () => {
    const document = baseDocument();
    applyOverrides(
      document,
      ownershipOf(document.paths as Record<string, unknown>),
      file([
        RULE({
          op: 'replace',
          target: { kind: 'operation', path: '/users', method: 'get' },
          value: { summary: 'replaced' },
        }),
      ]),
      [],
    );
    const paths = document.paths as Record<string, Record<string, unknown>>;
    expect(paths['/users']?.['get']).toEqual({ summary: 'replaced' });
  });

  it('add inserts a missing target (path level)', () => {
    const document = baseDocument();
    applyOverrides(
      document,
      ownershipOf(document.paths as Record<string, unknown>),
      file([
        RULE({
          op: 'add',
          target: { kind: 'path', path: '/_health' },
          value: { get: { operationId: 'health' } },
        }),
      ]),
      [],
    );
    const paths = document.paths as Record<string, unknown>;
    expect(paths['/_health']).toEqual({ get: { operationId: 'health' } });
  });

  it('remove deletes the target; replace/remove on a missing target → OVERRIDE_TARGET_MISSING', () => {
    const document = baseDocument();
    applyOverrides(
      document,
      ownershipOf(document.paths as Record<string, unknown>),
      file([
        RULE({ op: 'remove', target: { kind: 'operation', path: '/legacy', method: 'get' } }),
      ]),
      [],
    );
    expect((document.paths as Record<string, { get?: unknown }>)['/legacy']?.['get']).toBeUndefined();

    expectComposeError(
      () =>
        applyOverrides(
          baseDocument(),
          ownershipOf({}),
          file([
            RULE({
              op: 'replace',
              target: { kind: 'operation', path: '/nope', method: 'get' },
              value: {},
            }),
          ]),
          [],
        ),
      { code: 'OVERRIDE_TARGET_MISSING', ruleIndex: 0, path: '/nope' },
    );

    expectComposeError(
      () =>
        applyOverrides(
          baseDocument(),
          ownershipOf({}),
          file([RULE({ op: 'remove', target: { kind: 'path', path: '/nope' } })]),
          [],
        ),
      { code: 'OVERRIDE_TARGET_MISSING', ruleIndex: 0, path: '/nope' },
    );
  });

  it('add on an existing target → OVERRIDE_TARGET_ALREADY_EXISTS', () => {
    expectComposeError(
      () =>
        applyOverrides(
          baseDocument(),
          ownershipOf({ '/users': {} }),
          file([
            RULE({
              op: 'add',
              target: { kind: 'path', path: '/users' },
              value: {},
            }),
          ]),
          [],
        ),
      { code: 'OVERRIDE_TARGET_ALREADY_EXISTS', ruleIndex: 0, path: '/users' },
    );
  });

  it('info rule replace → document.info is EXACTLY the override value (US3/AC1)', () => {
    const document = baseDocument();
    applyOverrides(
      document,
      ownershipOf(document.paths as Record<string, unknown>),
      file([
        RULE({
          op: 'replace',
          target: { kind: 'info' },
          value: { title: 'gateway', version: '1.0.0' },
        }),
      ]),
      [],
    );
    expect(document.info).toEqual({ title: 'gateway', version: '1.0.0' });
  });

  it('global then local on the same target → local wins, never an error (US3/AC4)', () => {
    const document = baseDocument();
    applyOverrides(
      document,
      ownershipOf(document.paths as Record<string, unknown>),
      file([
        RULE({
          op: 'replace',
          target: { kind: 'operation', path: '/users', method: 'get' },
          value: { summary: 'global' },
        }),
      ]),
      [
        {
          appId: 'app',
          file: file([
            RULE({
              op: 'replace',
              target: { kind: 'operation', path: '/users', method: 'get' },
              value: { summary: 'local' },
            }),
          ]),
        },
      ],
    );
    const get = (document.paths as Record<string, Record<string, unknown>>)['/users']?.['get'];
    expect(get).toEqual({ summary: 'local' });
  });

  it('two rules in one file addressing the same target follow sequential semantics', () => {
    const document = baseDocument();
    applyOverrides(
      document,
      ownershipOf(document.paths as Record<string, unknown>),
      file([
        RULE({
          op: 'replace',
          target: { kind: 'operation', path: '/users', method: 'get' },
          value: { summary: 'first' },
        }),
        RULE(
          {
            op: 'replace',
            target: { kind: 'operation', path: '/users', method: 'get' },
            value: { summary: 'second' },
          },
          1,
        ),
      ]),
      [],
    );
    const get = (document.paths as Record<string, Record<string, unknown>>)['/users']?.['get'];
    expect(get).toEqual({ summary: 'second' });
  });
});

describe('applyOverrides — local scope (US3/AC5, FR-008) and provenance', () => {
  it('local rule addressing a foreign path → OVERRIDE_OUT_OF_SCOPE (owner)', () => {
    expectComposeError(
      () =>
        applyOverrides(
          baseDocument(),
          ownershipOf({ '/users': {}, '/analytics': {} }, 'other'),
          null,
          [
            {
              appId: 'app',
              file: file([
                RULE({
                  op: 'replace',
                  target: { kind: 'operation', path: '/analytics', method: 'get' },
                  value: {},
                }),
              ]),
            },
          ],
        ),
      { code: 'OVERRIDE_OUT_OF_SCOPE', app: 'app', targetPath: '/analytics', owner: 'other' },
    );
  });

  it('local rule addressing root info/component → OVERRIDE_OUT_OF_SCOPE (targetKind)', () => {
    expectComposeError(
      () =>
        applyOverrides(
          baseDocument(),
          ownershipOf({ '/users': {} }, 'other').assignApp('app', {}),
          null,
          [
            {
              appId: 'app',
              file: file([
                RULE({ op: 'replace', target: { kind: 'info' }, value: {} }),
              ]),
            },
          ],
        ),
      { code: 'OVERRIDE_OUT_OF_SCOPE', app: 'app', targetKind: 'info' },
    );

    expectComposeError(
      () =>
        applyOverrides(
          baseDocument(),
          ownershipOf({ '/users': {} }, 'other'),
          null,
          [
            {
              appId: 'app',
              file: file([
                RULE({
                  op: 'replace',
                  target: { kind: 'component', name: 'UserDto' },
                  value: {},
                }),
              ]),
            },
          ],
        ),
      { code: 'OVERRIDE_OUT_OF_SCOPE', app: 'app', targetKind: 'component' },
    );
  });

  it('added paths get the correct owner in provenance: global → "global", local → appId (US3/AC2)', () => {
    const document = baseDocument();
    const ownership = ownershipOf(document.paths as Record<string, unknown>, 'app');
    applyOverrides(
      document,
      ownership,
      file([
        RULE({
          op: 'add',
          target: { kind: 'path', path: '/_health' },
          value: { get: {} },
        }),
      ]),
      [
        {
          appId: 'app',
          file: file([
            RULE(
              {
                op: 'add',
                target: { kind: 'operation', path: '/app-only', method: 'get' },
                value: { operationId: 'appOnly' },
              },
              1,
            ),
          ]),
        },
      ],
    );
    expect(ownership.ownerOf('/_health')).toBe('global');
    expect(ownership.ownerOf('/app-only')).toBe('app');
    const ref = ownership.resolveOperation('appOnly');
    expect(ref).toEqual({ path: '/app-only', appId: 'app', method: 'get' });
  });
});