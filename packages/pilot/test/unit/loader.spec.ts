import { afterEach, describe, expect, it } from 'vitest';

import { EXT_INVALID, EXT_VERSION } from '../../src/contracts/index.js';
import { loadExtensions } from '../../src/extensions/loader.js';
import {
  canonicalExtensionsYaml,
  extensionsYaml,
  writeExtensionsYaml,
} from '../helpers/extensions-fixtures.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

describe('loadExtensions (T026)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) {
      removeTempProject(project);
      project = undefined;
    }
  });

  it('missing .ycsf/extensions.yaml → throws EXT_MISSING_FILE Error (FR-002, US-8 AC4, Sc8.4)', () => {
    project = createTempProject({});
    const root = project.root;
    expect(() => loadExtensions(root)).toThrow(
      /missing \.ycsf\/extensions\.yaml.*EXT_MISSING_FILE/,
    );
  });

  it('valid file → kind ok with ExtensionsYaml data', () => {
    project = createTempProject({});
    writeExtensionsYaml(project, canonicalExtensionsYaml());
    const result = loadExtensions(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.version).toBe(1);
    expect(result.data.extensions).toHaveLength(1);
  });

  it('structurally invalid file → kind invalid with ProjectModelDiagnostics (FR-004, Sc7)', () => {
    project = createTempProject({});

    writeExtensionsYaml(project, 'version: 2\nextensions: []\n');
    const badVersion = loadExtensions(project.root);
    expect(badVersion.kind).toBe('invalid');
    if (badVersion.kind === 'ok') return;
    expect(badVersion.errors[0]).toMatchObject({ code: EXT_VERSION, file: '.ycsf/extensions.yaml' });

    writeExtensionsYaml(
      project,
      'version: 1\nextensions:\n  - target: "functions.user_service"\n    patch: "not-an-object"\n',
    );
    const badPatch = loadExtensions(project.root);
    expect(badPatch.kind).toBe('invalid');
    if (badPatch.kind === 'ok') return;
    expect(badPatch.errors[0]).toMatchObject({ code: EXT_INVALID, file: '.ycsf/extensions.yaml' });

    writeExtensionsYaml(
      project,
      'version: 1\nextensions:\n  - target: "functions.user_service"\n' +
        '    patch:\n      environment:\n        A: 1\n        A: 2\n',
    );
    const dupKeys = loadExtensions(project.root);
    expect(dupKeys.kind).toBe('invalid');
    if (dupKeys.kind === 'ok') return;
    const withLocation = dupKeys.errors.find((e) => e.line !== undefined && e.column !== undefined);
    expect(withLocation).toBeDefined();
    expect(withLocation?.file).toBe('.ycsf/extensions.yaml');
  });

  it('duplicate targets are NOT checked by the loader (FR-005 boundary, A7)', () => {
    project = createTempProject({});
    writeExtensionsYaml(
      project,
      extensionsYaml(
        '  - target: "functions.user_service"\n    patch: {}\n' +
          '  - target: "functions.user_service"\n    patch: {}\n',
      ),
    );
    const result = loadExtensions(project.root);
    expect(result.kind).toBe('ok');
  });
});