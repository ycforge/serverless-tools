import { describe, expect, it } from 'vitest';
import { replaceResourceRefs } from '../../src/yandex-api-gateway/ref-resolver.js';

describe('ref-resolver (D-RE-4)', () => {
  it('replaces logical resource refs with TF expressions', () => {
    const spec = 'function_id: ${resources.functions.user_service.id}';
    const refs = [{ logical: 'functions.user_service', terraformType: 'yandex_function' }];
    expect(replaceResourceRefs(spec, refs)).toBe('function_id: ${yandex_function.user_service.id}');
  });

  it('empty references returns spec as-is (FR-017)', () => {
    const spec = 'openapi: "3.0.0"\nbackend: ${resources.functions.user_service.id}';
    expect(replaceResourceRefs(spec, [])).toBe(spec);
  });

  it('multiple refs are replaced independently', () => {
    const spec = '${resources.functions.a.id} ${resources.functions.b.id}';
    const refs = [
      { logical: 'functions.a', terraformType: 'yandex_function' },
      { logical: 'functions.b', terraformType: 'yandex_function' },
    ];
    expect(replaceResourceRefs(spec, refs)).toBe('${yandex_function.a.id} ${yandex_function.b.id}');
  });

  it('ref not found in spec is not an error', () => {
    const spec = 'no refs here';
    const refs = [{ logical: 'functions.missing', terraformType: 'yandex_function' }];
    expect(replaceResourceRefs(spec, refs)).toBe('no refs here');
  });
});
