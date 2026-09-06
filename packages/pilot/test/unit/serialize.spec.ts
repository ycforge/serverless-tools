import { describe, expect, it } from 'vitest';

import type { GeneratedTfFile, TerraformResource } from '../../src/contracts/index.js';
import { MTL_FILENAME_COLLISION, MTL_INVALID_TERRAFORM_ADDRESS } from '../../src/contracts/index.js';
import {
  computeFilename,
  detectFilenameCollision,
  serializeResource,
  serializeResourceFile,
  validateAddress,
  type SerializeResourceFileResult,
} from '../../src/materialize/serialize.js';
import { GOLDEN_USER_SERVICE_TF_JSON } from '../helpers/materialize-fixtures.js';

// T010–T013: serialize.spec.ts — .tf.json content + address/filename
// validation (US-1, US-8, FR-007..FR-011).

const userServiceResource: TerraformResource = {
  kind: 'resource',
  type: 'yandex_function',
  name: 'user_service',
  configuration: {
    runtime: 'nodejs20',
    name: 'user_service',
    content: { source: 'dist/user_service.zip' },
  },
};

describe('serialize.ts', () => {
  it('T010: serializeResource emits the quickstart Sc1 golden bytes, keys sorted lexicographically inside configuration (FR-007/009, US-1 AC1)', () => {
    const content = serializeResource(userServiceResource);
    expect(content).toBe(GOLDEN_USER_SERVICE_TF_JSON);
    const parsed = JSON.parse(content) as {
      resource: { yandex_function: Record<string, unknown> };
    };
    expect(Object.keys(parsed.resource.yandex_function.user_service as Record<string, unknown>)).toEqual([
      'content',
      'name',
      'runtime',
    ]);
  });

  it('T011: address validation — hyphen type and digit-leading name → MTL_INVALID_TERRAFORM_ADDRESS (FR-011, spec Edge Case)', () => {
    const badType = validateAddress('yandex-function', 'user_service');
    expect(badType).not.toBeNull();
    expect(badType?.code).toBe(MTL_INVALID_TERRAFORM_ADDRESS);
    expect(badType?.type).toBe('yandex-function');
    expect(badType?.name).toBe('user_service');
    expect(badType?.message).toContain('-');

    const badName = validateAddress('yandex_function', '1bad');
    expect(badName).not.toBeNull();
    expect(badName?.code).toBe(MTL_INVALID_TERRAFORM_ADDRESS);
    expect(badName?.type).toBe('yandex_function');
    expect(badName?.name).toBe('1bad');
    expect(badName?.message).toContain('1');

    expect(validateAddress('yandex_function', 'user_service')).toBeNull();
  });

  it('T011b: filename guard — app_id with invalid charset → same MTL_INVALID_TERRAFORM_ADDRESS code (defensive, research 6)', () => {
    const result = serializeResourceFile('bad app id!', userServiceResource);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.errors[0]?.code).toBe(MTL_INVALID_TERRAFORM_ADDRESS);
    }
  });

  it('T012: computeFilename is <app_id>.ycsf.tf.json (FR-008); duplicate filename → MTL_FILENAME_COLLISION with both artifact ids (FR-010, Sc10)', () => {
    expect(computeFilename('user_service')).toBe('user_service.ycsf.tf.json');

    const collisions = detectFilenameCollision([
      { appId: 'a', filename: 'x.ycsf.tf.json' },
      { appId: 'b', filename: 'x.ycsf.tf.json' },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.code).toBe(MTL_FILENAME_COLLISION);
    expect(collisions[0]?.filename).toBe('x.ycsf.tf.json');
    expect(collisions[0]?.message).toContain('a');
    expect(collisions[0]?.message).toContain('b');
    expect(detectFilenameCollision([{ appId: 'a', filename: 'a.ycsf.tf.json' }])).toHaveLength(0);
  });

  it('T013: serializeResource is deterministic — same input → same bytes; configuration key order in input is irrelevant (FR-009, US-8, SC-003)', () => {
    const first = serializeResource(userServiceResource);
    const second = serializeResource(userServiceResource);
    expect(second).toBe(first);

    const shuffled: TerraformResource = {
      kind: 'resource',
      type: 'yandex_function',
      name: 'user_service',
      configuration: {
        name: 'user_service',
        content: { source: 'dist/user_service.zip' },
        runtime: 'nodejs20',
      },
    };
    expect(serializeResource(shuffled)).toBe(first);
  });

  it('serializeResourceFile returns ok with a GeneratedTfFile for a valid resource', () => {
    const result: SerializeResourceFileResult = serializeResourceFile('user_service', userServiceResource);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const file: GeneratedTfFile = result.file;
      expect(file.filename).toBe('user_service.ycsf.tf.json');
      expect(file.content).toBe(GOLDEN_USER_SERVICE_TF_JSON);
    }
  });
});