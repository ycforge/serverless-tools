import { describe, expect, it } from 'vitest';

import { moveEndpointsFromResources } from '../../src/cli/resource-endpoints.js';
import type { TerraformResource } from '../../src/contracts/index.js';

function resource(type: string, name: string): TerraformResource {
  return { kind: 'resource', type, name, configuration: {} };
}

describe('moveEndpointsFromResources (spec 017/037)', () => {
  it('derives the logical IDL for IDL-addressable Terraform types', () => {
    expect(
      moveEndpointsFromResources([
        resource('yandex_function', 'e2e_api'),
        resource('yandex_api_gateway', 'e2e_openapi'),
        resource('yandex_serverless_container', 'e2e_container'),
      ]),
    ).toEqual([
      { idl: 'functions.e2e_api', idt: 'yandex_function.e2e_api' },
      { idl: 'gateways.e2e_openapi', idt: 'yandex_api_gateway.e2e_openapi' },
      { idl: 'containers.e2e_container', idt: 'yandex_serverless_container.e2e_container' },
    ]);
  });

  it('falls back to the Terraform address for types without an IDL domain', () => {
    expect(moveEndpointsFromResources([resource('yandex_storage_bucket', 'e2e_web')])).toEqual([
      { idl: 'yandex_storage_bucket.e2e_web', idt: 'yandex_storage_bucket.e2e_web' },
    ]);
  });
});
