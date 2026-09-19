import { describe, expect, it } from 'vitest';
import { buildGatewayTemplate, replaceResourceRefs } from '../../src/yandex-api-gateway/ref-resolver.js';

describe('ref-resolver (D-RE-4)', () => {
  it('replaces logical resource refs with template placeholders + builds the variable map', () => {
    const spec = 'function_id: ${resources.functions.user_service.id}';
    const refs = [{ logical: 'functions.user_service', terraformType: 'yandex_function' }];
    const { content, variableMap } = buildGatewayTemplate(spec, refs);
    expect(content).toBe('function_id: ${yandex_function_user_service_id}');
    expect(variableMap).toEqual({
      yandex_function_user_service_id: 'yandex_function.user_service.id',
    });
  });

  it('empty references returns spec as-is (FR-017)', () => {
    const spec = 'openapi: "3.0.0"\nbackend: ${resources.functions.user_service.id}';
    const { content, variableMap } = buildGatewayTemplate(spec, []);
    expect(content).toBe(spec);
    expect(variableMap).toEqual({});
  });

  it('multiple refs are replaced independently into distinct placeholders', () => {
    const spec = '${resources.functions.a.id} ${resources.functions.b.id}';
    const refs = [
      { logical: 'functions.a', terraformType: 'yandex_function' },
      { logical: 'functions.b', terraformType: 'yandex_function' },
    ];
    const { content, variableMap } = buildGatewayTemplate(spec, refs);
    expect(content).toBe('${yandex_function_a_id} ${yandex_function_b_id}');
    expect(variableMap).toEqual({
      yandex_function_a_id: 'yandex_function.a.id',
      yandex_function_b_id: 'yandex_function.b.id',
    });
  });

  it('replaces non-id properties via the full canonical template (buckets .name -> .bucket)', () => {
    const spec = 'bucket: ${resources.buckets.frontend.name}';
    const refs = [{ logical: 'buckets.frontend', terraformType: 'yandex_storage_bucket', property: 'name' }];
    const { content, variableMap } = buildGatewayTemplate(spec, refs);
    expect(content).toBe('bucket: ${yandex_storage_bucket_frontend_name}');
    expect(variableMap).toEqual({
      yandex_storage_bucket_frontend_name: 'yandex_storage_bucket.frontend.bucket',
    });
  });

  it('replaces cloud_functions function_id refs (functions .id with explicit property)', () => {
    const spec = 'function_id: ${resources.functions.user_service.id}';
    const refs = [{ logical: 'functions.user_service', terraformType: 'yandex_function', property: 'id' }];
    const { content, variableMap } = buildGatewayTemplate(spec, refs);
    expect(content).toBe('function_id: ${yandex_function_user_service_id}');
    expect(variableMap).toEqual({ yandex_function_user_service_id: 'yandex_function.user_service.id' });
  });

  it('mixed properties resolve independently (id + name)', () => {
    const spec = '${resources.containers.analytics.id} ${resources.buckets.frontend.name}';
    const refs = [
      { logical: 'containers.analytics', terraformType: 'yandex_serverless_container', property: 'id' },
      { logical: 'buckets.frontend', terraformType: 'yandex_storage_bucket', property: 'name' },
    ];
    const { content, variableMap } = buildGatewayTemplate(spec, refs);
    expect(content).toBe(
      '${yandex_serverless_container_analytics_id} ${yandex_storage_bucket_frontend_name}',
    );
    expect(variableMap).toEqual({
      yandex_serverless_container_analytics_id: 'yandex_serverless_container.analytics.id',
      yandex_storage_bucket_frontend_name: 'yandex_storage_bucket.frontend.bucket',
    });
  });

  it('missing property defaults to id (backward compat)', () => {
    const spec = 'function_id: ${resources.functions.legacy.id}';
    const refs = [{ logical: 'functions.legacy', terraformType: 'yandex_function' }];
    expect(replaceResourceRefs(spec, refs)).toBe('function_id: ${yandex_function_legacy_id}');
  });

  it('ref not found in spec is not an error', () => {
    const spec = 'no refs here';
    const refs = [{ logical: 'functions.missing', terraformType: 'yandex_function' }];
    const { content, variableMap } = buildGatewayTemplate(spec, refs);
    expect(content).toBe('no refs here');
    expect(variableMap).toEqual({});
  });
});