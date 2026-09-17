import { describe, expect, it } from 'vitest';

import {
  PML_DEPENDS_CYCLE,
  PML_ENV_NOT_SET,
  ProjectModelError,
} from '../../src/contracts/index.js';
import { diag } from '../../src/model/errors.js';

// FR-015: every diagnostic carries code/message/file and, where applicable,
// app/identity/field/line/column (contracts/project-model.json
// #/definitions/diagnostic). errors.ts owns the model-layer diagnostic factory.

describe('diag factory (FR-015)', () => {
  it('carries all provided fields', () => {
    const diagnostic = diag({
      code: PML_DEPENDS_CYCLE,
      message: 'depends_on cycle detected',
      file: '.ycsf/apps.yaml',
      app: 'user_service',
      identity: 'functions.user_service',
      field: 'depends_on',
      line: 3,
      column: 7,
    });
    expect(diagnostic).toEqual({
      code: PML_DEPENDS_CYCLE,
      message: 'depends_on cycle detected',
      file: '.ycsf/apps.yaml',
      app: 'user_service',
      identity: 'functions.user_service',
      field: 'depends_on',
      line: 3,
      column: 7,
    });
  });

  it('omits optional fields when not provided (no undefined keys)', () => {
    const diagnostic = diag({
      code: PML_ENV_NOT_SET,
      message: "required ENV 'NPM_TOKEN' is not set",
      file: 'analytics/build_config.yaml',
      field: 'NPM_TOKEN',
    });
    expect(diagnostic).toEqual({
      code: PML_ENV_NOT_SET,
      message: "required ENV 'NPM_TOKEN' is not set",
      file: 'analytics/build_config.yaml',
      field: 'NPM_TOKEN',
    });
    expect('app' in diagnostic).toBe(false);
    expect('identity' in diagnostic).toBe(false);
    expect('line' in diagnostic).toBe(false);
    expect('column' in diagnostic).toBe(false);
  });
});

describe('ProjectModelError (data-model.md, FR-015)', () => {
  it('aggregates a list of diagnostics', () => {
    const error = new ProjectModelError([
      diag({ code: PML_ENV_NOT_SET, message: 'missing A', file: 'a/build_config.yaml', field: 'A' }),
      diag({ code: PML_ENV_NOT_SET, message: 'missing B', file: 'a/build_config.yaml', field: 'B' }),
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProjectModelError');
    expect(error.code).toBe(PML_ENV_NOT_SET);
    expect(error.diagnostics).toHaveLength(2);
    expect(error.message).toContain('missing A');
    expect(error.message).toContain('missing B');
  });
});