import { describe, expect, it } from 'vitest';

import type { OverrideFile } from './override-types.js';
import { parseOverrideFile } from './override-yaml.js';

const SOURCE = '/root/overrides.yaml';

function expectComposeError(fn: () => void, expected: Record<string, unknown>): void {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ name: 'ComposeError', ...expected });
    return;
  }
  throw new Error(`expected ComposeError ${JSON.stringify(expected)} but none was thrown`);
}

describe('parseOverrideFile — grammar (US3/AC6, FR-007), yaml v2, inline', () => {
  it('parses version: 1 + rules[] into typed rules', () => {
    const file: OverrideFile = parseOverrideFile(
      [
        'version: 1',
        'rules:',
        '  - op: replace',
        '    target: { kind: info }',
        '    value: { title: gw, version: "1.0.0" }',
        '  - op: add',
        '    target: { kind: path, path: /_health }',
        '    value: { get: {} }',
        '  - op: remove',
        '    target: { kind: operation, path: /users, method: get }',
        '  - op: add',
        '    target: { kind: operationId, operationId: getUsers }',
        '    value: {}',
        '  - op: replace',
        '    target: { kind: component, name: UserDto }',
        '    value: { type: object }',
      ].join('\n'),
      SOURCE,
    );

    expect(file.version).toBe(1);
    expect(file.sourcePath).toBe(SOURCE);
    expect(file.rules).toHaveLength(5);
    expect(file.rules[0]).toMatchObject({ op: 'replace', target: { kind: 'info' } });
    expect(file.rules[1]).toMatchObject({ op: 'add', target: { kind: 'path', path: '/_health' } });
    expect(file.rules[2]).toMatchObject({
      op: 'remove',
      target: { kind: 'operation', path: '/users', method: 'get' },
    });
    expect(file.rules[3]).toMatchObject({
      op: 'add',
      target: { kind: 'operationId', operationId: 'getUsers' },
    });
    expect(file.rules[4]).toMatchObject({
      op: 'replace',
      target: { kind: 'component', name: 'UserDto' },
    });
  });

  it('rejects a missing or foreign version → OVERRIDE_VERSION_UNSUPPORTED (filePath)', () => {
    expectComposeError(() => parseOverrideFile('rules:\n  - op: add\n    target: { kind: info }\n    value: {}', SOURCE), {
      code: 'OVERRIDE_VERSION_UNSUPPORTED',
      filePath: SOURCE,
    });
    expectComposeError(() => parseOverrideFile('version: 2\nrules:\n  - op: replace\n    target: { kind: info }\n    value: {}', SOURCE), {
      code: 'OVERRIDE_VERSION_UNSUPPORTED',
      filePath: SOURCE,
    });
  });

  it('rejects rules that are not a list → OVERRIDE_RULES_NOT_LIST', () => {
    expectComposeError(() => parseOverrideFile('version: 1\nrules: { op: replace }', SOURCE), {
      code: 'OVERRIDE_RULES_NOT_LIST',
      filePath: SOURCE,
    });
    expectComposeError(() => parseOverrideFile('version: 1', SOURCE), {
      code: 'OVERRIDE_RULES_NOT_LIST',
      filePath: SOURCE,
    });
  });

  it('rejects an empty rules list → OVERRIDE_RULES_EMPTY', () => {
    expectComposeError(() => parseOverrideFile('version: 1\nrules: []', SOURCE), {
      code: 'OVERRIDE_RULES_EMPTY',
      filePath: SOURCE,
    });
  });

  it('rejects an unknown op → OVERRIDE_UNKNOWN_OP (ruleIndex, op)', () => {
    expectComposeError(
      () =>
        parseOverrideFile(
          'version: 1\nrules:\n  - op: merge\n    target: { kind: info }\n    value: {}\n',
          SOURCE,
        ),
      { code: 'OVERRIDE_UNKNOWN_OP', ruleIndex: 0, op: 'merge' },
    );
  });

  it('rejects an invalid or unknown target.kind → OVERRIDE_INVALID_TARGET (ruleIndex, kind)', () => {
    expectComposeError(
      () => parseOverrideFile('version: 1\nrules:\n  - op: replace\n    target: { kind: globals }\n    value: {}\n', SOURCE),
      { code: 'OVERRIDE_INVALID_TARGET', ruleIndex: 0, kind: 'globals' },
    );
    expectComposeError(
      () => parseOverrideFile('version: 1\nrules:\n  - op: replace\n    value: {}\n', SOURCE),
      { code: 'OVERRIDE_INVALID_TARGET', ruleIndex: 0 },
    );
  });

  it('rejects an operation target missing path/method → OVERRIDE_INVALID_TARGET', () => {
    expectComposeError(
      () => parseOverrideFile('version: 1\nrules:\n  - op: remove\n    target: { kind: operation, path: /users }\n', SOURCE),
      { code: 'OVERRIDE_INVALID_TARGET', ruleIndex: 0 },
    );
    expectComposeError(
      () => parseOverrideFile('version: 1\nrules:\n  - op: remove\n    target: { kind: operation, method: get }\n', SOURCE),
      { code: 'OVERRIDE_INVALID_TARGET', ruleIndex: 0 },
    );
  });

  it('rejects replace/add without value → OVERRIDE_VALUE_REQUIRED (ruleIndex, op)', () => {
    expectComposeError(
      () => parseOverrideFile('version: 1\nrules:\n  - op: replace\n    target: { kind: info }\n', SOURCE),
      { code: 'OVERRIDE_VALUE_REQUIRED', ruleIndex: 0, op: 'replace' },
    );
    expectComposeError(
      () => parseOverrideFile('version: 1\nrules:\n  - op: add\n    target: { kind: info }\n', SOURCE),
      { code: 'OVERRIDE_VALUE_REQUIRED', ruleIndex: 0, op: 'add' },
    );
  });

  it('rejects remove carrying a value → OVERRIDE_VALUE_FORBIDDEN (ruleIndex)', () => {
    expectComposeError(
      () =>
        parseOverrideFile(
          'version: 1\nrules:\n  - op: remove\n    target: { kind: info }\n    value: {}\n',
          SOURCE,
        ),
      { code: 'OVERRIDE_VALUE_FORBIDDEN', ruleIndex: 0 },
    );
  });

  it('rejects a non-HTTP method on an operation target → OVERRIDE_METHOD_INVALID', () => {
    expectComposeError(
      () =>
        parseOverrideFile(
          'version: 1\nrules:\n  - op: remove\n    target: { kind: operation, path: /users, method: FETCH }\n',
          SOURCE,
        ),
      { code: 'OVERRIDE_METHOD_INVALID', ruleIndex: 0, method: 'FETCH', path: '/users' },
    );
  });

  it('rejects malformed YAML or a non-map document → OVERRIDE_FILE_INVALID_YAML (filePath)', () => {
    expectComposeError(() => parseOverrideFile('rules: [', SOURCE), {
      code: 'OVERRIDE_FILE_INVALID_YAML',
      filePath: SOURCE,
    });
    expectComposeError(() => parseOverrideFile('- just\n- a\n- list\n', SOURCE), {
      code: 'OVERRIDE_FILE_INVALID_YAML',
      filePath: SOURCE,
    });
  });

  it('rejects duplicate keys → OVERRIDE_FILE_INVALID_YAML (filePath)', () => {
    expectComposeError(
      () => parseOverrideFile('version: 1\nversion: 2\nrules:\n  - op: remove\n    target: { kind: info }\n', SOURCE),
      { code: 'OVERRIDE_FILE_INVALID_YAML', filePath: SOURCE },
    );
  });
});