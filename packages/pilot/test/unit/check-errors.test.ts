import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  YCK_MISSING_TARGET,
  YCK_ENV_IN_PATCH,
  YCK_REF_UNRESOLVED,
  YCK_TERRAFORM_INVALID,
  YCK_TERRAFORM_UNAVAILABLE,
  type YckDiagnostic,
} from '../../src/contracts/check.js';
import { yck } from '../../src/check/errors.js';

const CONTRACT_PATH = join(import.meta.dirname, '../../../../specs/020-ycsf-check/contracts/ycsf-check.json');

describe('check errors (T012)', () => {
  it('exactly 5 YCK_* constants defined', () => {
    const codes = [
      YCK_MISSING_TARGET,
      YCK_ENV_IN_PATCH,
      YCK_REF_UNRESOLVED,
      YCK_TERRAFORM_INVALID,
      YCK_TERRAFORM_UNAVAILABLE,
    ];
    expect(codes).toHaveLength(5);
  });

  it('constant names byte-for-byte match #/errorCodes keys in JSON contract', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
      errorCodes: { properties: Record<string, unknown> };
    };
    const contractKeys = Object.keys(contract.errorCodes.properties).sort();
    const codeValues = [
      YCK_MISSING_TARGET,
      YCK_ENV_IN_PATCH,
      YCK_REF_UNRESOLVED,
      YCK_TERRAFORM_INVALID,
      YCK_TERRAFORM_UNAVAILABLE,
    ].sort();
    expect(contractKeys).toEqual(codeValues);
  });

  it('yck({ code, message }) returns YckDiagnostic with only defined fields', () => {
    const d: YckDiagnostic = yck({
      code: YCK_MISSING_TARGET,
      message: 'test message',
    });
    expect(d.code).toBe(YCK_MISSING_TARGET);
    expect(d.message).toBe('test message');
    expect(d.target).toBeUndefined();
    expect(d.resourceRef).toBeUndefined();
    expect(d.field).toBeUndefined();
    expect(d.file).toBeUndefined();
    expect(d.availableIdls).toBeUndefined();
  });

  it('yck({ code, message, target, availableIdls }) sets optional fields', () => {
    const d: YckDiagnostic = yck({
      code: YCK_MISSING_TARGET,
      message: 'missing target',
      target: 'functions.user_service',
      availableIdls: ['functions.analytics', 'gateways.openapi'],
    });
    expect(d.code).toBe(YCK_MISSING_TARGET);
    expect(d.target).toBe('functions.user_service');
    expect(d.availableIdls).toEqual(['functions.analytics', 'gateways.openapi']);
  });

  it('yck() for ENV_IN_PATCH sets target and field', () => {
    const d: YckDiagnostic = yck({
      code: YCK_ENV_IN_PATCH,
      message: 'env ref in patch',
      target: 'functions.user_service',
      field: 'environment.API_KEY',
    });
    expect(d.code).toBe(YCK_ENV_IN_PATCH);
    expect(d.target).toBe('functions.user_service');
    expect(d.field).toBe('environment.API_KEY');
  });

  it('yck() for REF_UNRESOLVED sets resourceRef and file', () => {
    const d: YckDiagnostic = yck({
      code: YCK_REF_UNRESOLVED,
      message: 'unresolved ref',
      resourceRef: 'functions.external_svc',
      file: '.ycsf/resources.yaml',
    });
    expect(d.code).toBe(YCK_REF_UNRESOLVED);
    expect(d.resourceRef).toBe('functions.external_svc');
    expect(d.file).toBe('.ycsf/resources.yaml');
  });
});
