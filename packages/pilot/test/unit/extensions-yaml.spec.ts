import { describe, expect, it } from 'vitest';

import { EXT_INVALID, EXT_VERSION } from '../../src/contracts/index.js';
import { parseExtensionsYaml } from '../../src/extensions/extensions-yaml.js';
import {
  canonicalExtensionsYaml,
  extensionsYaml,
} from '../helpers/extensions-fixtures.js';

const FILE = '.ycsf/extensions.yaml';

function expectInvalidCode(
  result: ReturnType<typeof parseExtensionsYaml>,
  code: string,
): void {
  expect(result.kind).toBe('invalid');
  if (result.kind === 'ok') return;
  expect(result.errors.some((e) => e.code === code)).toBe(true);
}

describe('parseExtensionsYaml (T010–T014)', () => {
  it('T010 parses a valid canonical file → ok, version 1, rules {target, patch} (FR-001, US-1, Sc1)', () => {
    const result = parseExtensionsYaml(canonicalExtensionsYaml(), FILE);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.version).toBe(1);
    expect(result.data.extensions).toHaveLength(1);
    expect(result.data.extensions[0]).toEqual({
      target: 'functions.user_service',
      patch: {
        environment: { CUSTOM_VAR: 'value' },
        execution_timeout: '30s',
        service_account_id: '${yandex_iam_service_account.custom.id}',
      },
    });
  });

  it('T011 version gate: missing → EXT_VERSION, unsupported → EXT_VERSION (FR-003, US-7 AC1, Sc7)', () => {
    const missing = parseExtensionsYaml(
      'extensions:\n  - target: "functions.user_service"\n    patch: {}\n',
      FILE,
    );
    expect(missing.kind).toBe('invalid');
    if (missing.kind === 'ok') return;
    expect(missing.errors).toHaveLength(1);
    expect(missing.errors[0]).toMatchObject({ code: EXT_VERSION, file: FILE });
    expect(missing.errors[0]?.message).toMatch(/missing version/);

    const unsupported = parseExtensionsYaml('version: 2\nextensions: []\n', FILE);
    expect(unsupported.kind).toBe('invalid');
    if (unsupported.kind === 'ok') return;
    expect(unsupported.errors[0]).toMatchObject({ code: EXT_VERSION });
    expect(unsupported.errors[0]?.message).toMatch(/unsupported version '2'.*supported: 1/);
  });

  it('T012 unknown/structural top-level keys → EXT_INVALID (FR-004, research 7, Sc7/Sc10.4)', () => {
    const foobar = parseExtensionsYaml('version: 1\nextensions: []\nfoobar: 1\n', FILE);
    expectInvalidCode(foobar, EXT_INVALID);

    const extraRuleKey = parseExtensionsYaml(
      extensionsYaml('  - target: "functions.user_service"\n    patch: {}\n    weight: 10\n'),
      FILE,
    );
    expectInvalidCode(extraRuleKey, EXT_INVALID);

    const noExtensions = parseExtensionsYaml('version: 1\n', FILE);
    expectInvalidCode(noExtensions, EXT_INVALID);
    if (noExtensions.kind === 'invalid') {
      expect(noExtensions.errors[0]?.message).toMatch(/extensions/);
    }

    const scalar = parseExtensionsYaml('version: 1\nextensions: 5\n', FILE);
    expectInvalidCode(scalar, EXT_INVALID);

    const mapping = parseExtensionsYaml('version: 1\nextensions:\n  target: "a.b"\n', FILE);
    expectInvalidCode(mapping, EXT_INVALID);
  });

  it('T013 rule form, IDL target grammar, patch type → EXT_INVALID (FR-004, US-7 AC3, Sc7)', () => {
    const elementNotMapping = parseExtensionsYaml('version: 1\nextensions:\n  - 42\n', FILE);
    expectInvalidCode(elementNotMapping, EXT_INVALID);

    const noTarget = parseExtensionsYaml('version: 1\nextensions:\n  - patch: {}\n', FILE);
    expectInvalidCode(noTarget, EXT_INVALID);

    const noPatch = parseExtensionsYaml(
      'version: 1\nextensions:\n  - target: "functions.user_service"\n',
      FILE,
    );
    expectInvalidCode(noPatch, EXT_INVALID);

    const targetNotString = parseExtensionsYaml(
      'version: 1\nextensions:\n  - target: 42\n    patch: {}\n',
      FILE,
    );
    expectInvalidCode(targetNotString, EXT_INVALID);

    for (const bad of [
      'functions',
      'functions.user_service.extra',
      'Functions.user_service',
      'functions.user-service',
      'functions/user_service',
      'functions..x',
      '.x',
      'x.',
      '',
    ]) {
      const result = parseExtensionsYaml(
        `version: 1\nextensions:\n  - target: "${bad}"\n    patch: {}\n`,
        FILE,
      );
      expectInvalidCode(result, EXT_INVALID);
    }

    for (const badPatch of ['"not-an-object"', '[1, 2]', 'null']) {
      const result = parseExtensionsYaml(
        `version: 1\nextensions:\n  - target: "functions.user_service"\n    patch: ${badPatch}\n`,
        FILE,
      );
      expectInvalidCode(result, EXT_INVALID);
    }
  });

  it('T014 duplicate YAML keys (parse gate, line/column) + collect-all (FR-004, Sc7)', () => {
    const dupInPatch = parseExtensionsYaml(
      'version: 1\nextensions:\n  - target: "functions.user_service"\n' +
        '    patch:\n      environment:\n        A: 1\n        A: 2\n',
      FILE,
    );
    expect(dupInPatch.kind).toBe('invalid');
    if (dupInPatch.kind === 'ok') return;
    expect(dupInPatch.errors.some((e) => e.code === EXT_INVALID)).toBe(true);
    const withLocation = dupInPatch.errors.find(
      (e) => e.line !== undefined && e.column !== undefined,
    );
    expect(withLocation).toBeDefined();

    const dupTopLevel = parseExtensionsYaml('version: 1\nextensions: []\nextensions: []\n', FILE);
    expectInvalidCode(dupTopLevel, EXT_INVALID);

    const dupRule = parseExtensionsYaml(
      'version: 1\nextensions:\n  - target: "a.b"\n    target: "a.b"\n    patch: {}\n',
      FILE,
    );
    expectInvalidCode(dupRule, EXT_INVALID);

    const multi = parseExtensionsYaml(
      'version: 1\nextensions:\n  target: "functions.user_service"\n  patch: "not-an-object"\n',
      FILE,
    );
    expect(multi.kind).toBe('invalid');
    if (multi.kind === 'ok') return;
    expect(multi.errors.length).toBeGreaterThanOrEqual(2);
    expect(multi.errors.filter((e) => e.code === EXT_INVALID).length).toBeGreaterThanOrEqual(2);
  });
});