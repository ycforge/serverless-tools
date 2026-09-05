import { describe, expect, it } from 'vitest';

import { parseResourceIndex } from './resource-index.js';
import { validateResourceReference, resolveReferences } from './reference-resolver.js';
import { REFERENCE_BEARER_FIELDS } from './types.js';
import { parseEnvMapping } from './env-mapping.js';
import type { ResourceIndex } from './types.js';
import { ResourceRefError } from './errors.js';

function inlineIndex(yamlText: string): ResourceIndex {
  return parseResourceIndex(yamlText, '/p/.ycsf/resources.yaml');
}

function inlineEnv(yamlText: string, index: ResourceIndex) {
  return parseEnvMapping(yamlText, '/p/.ycsf/env.yaml', index);
}

const INDEX = inlineIndex(`version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
`);

describe('validateResourceReference — T011 (US2/AC1-AC4, FR-005/006, SC-003)', () => {
  it('existing resource → { valid: true, parsed: {domain, name, property} }', () => {
    const result = validateResourceReference('${resources.functions.legacy_authorizer.id}', INDEX);
    expect(result).toEqual({
      valid: true,
      parsed: { domain: 'functions', name: 'legacy_authorizer', property: 'id' },
    });
  });

  it('unknown name → RESOURCE_REF_NOT_DECLARED with domain + name + reference', () => {
    const result = validateResourceReference('${resources.functions.nonexistent.id}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error).toBeInstanceOf(ResourceRefError);
      expect(result.error.code).toBe('RESOURCE_REF_NOT_DECLARED');
      expect(result.error.context).toMatchObject({
        domain: 'functions',
        name: 'nonexistent',
        reference: '${resources.functions.nonexistent.id}',
      });
    }
  });

  it('unknown domain → RESOURCE_REF_DOMAIN_UNKNOWN with reference', () => {
    const result = validateResourceReference('${resources.databases.events.id}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error.code).toBe('RESOURCE_REF_DOMAIN_UNKNOWN');
      expect(result.error.context).toMatchObject({
        domain: 'databases',
        reference: '${resources.databases.events.id}',
      });
    }
  });

  it('invalid property for the domain → RESOURCE_REF_PROPERTY_INVALID with reference', () => {
    const result = validateResourceReference('${resources.queues.events.name}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error.code).toBe('RESOURCE_REF_PROPERTY_INVALID');
      expect(result.error.context).toMatchObject({
        domain: 'queues',
        name: 'events',
        property: 'name',
        reference: '${resources.queues.events.name}',
      });
    }
  });

  it('malformed resources-namespace string (2 segments) → RESOURCE_REF_SYNTAX_INVALID with input + reason', () => {
    const result = validateResourceReference('${resources.functions.legacy_id}', INDEX);
    expect(result.valid).toBe(false);
    if (!result.valid && 'error' in result) {
      expect(result.error.code).toBe('RESOURCE_REF_SYNTAX_INVALID');
      expect(result.error.context.input).toBe('functions.legacy_id');
      expect(result.error.context.reason).toBeDefined();
    }
  });

  it('no-reference result is never valid and never reaches the index', () => {
    const result = validateResourceReference('${var.foo}', INDEX);
    expect(result).toEqual({ valid: false, notAReference: true });
  });
});

describe('validateResourceReference — foreign interpolation namespaces (T012, FR-014/019, Edge cases)', () => {
  it('APIGW variables, Terraform exprs, build ENV are NOT 009 references', () => {
    for (const foreign of ['${var.foo}', '${yandex_function.x.id}', '{{$ENV}}', '$${yandex_function.x.id}']) {
      const result = validateResourceReference(foreign, INDEX);
      expect(result.valid, foreign).toBe(false);
      if (!result.valid) {
        expect('notAReference' in result, foreign).toBe(true);
      }
    }
  });

  it('a prefix-less canonical ref is not a template reference (Edge cases §Точки неоднозначности №3)', () => {
    const result = validateResourceReference('functions.legacy_authorizer.id', INDEX);
    expect(result).toEqual({ valid: false, notAReference: true });
  });
});

describe('resolveReferences — targeted ENV resolution (T021/T022, US4/AC1..AC4/AC6, FR-009/010/011/019, SC-005)', () => {
  const INDEX = inlineIndex(`version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
buckets:
  frontend: {}
`);

  const docBase = {
    components: {
      securitySchemes: {
        internal: {
          'x-yc-apigateway-authorizer': {
            type: 'function',
            function_id: '${resources.functions.legacy_authorizer.id}',
          },
        },
      },
      paths: {},
    }
  };

  it('reference-bearing field with env entry + env set → actual value (no ${...} remains)', () => {
    const env = inlineEnv(
      `version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
`,
      INDEX,
    );
    process.env.LEGACY_AUTHORIZER_ID = 'd4e123actual';
    try {
      const result = resolveReferences(docBase, env, REFERENCE_BEARER_FIELDS, INDEX);
      const components = result.components as Record<string, unknown>;
      const fid = (components.securitySchemes as Record<string, unknown>)['internal'] as Record<string, unknown>;
      const authorizer = fid['x-yc-apigateway-authorizer'] as Record<string, unknown>;
      expect(authorizer.function_id).toBe('d4e123actual');
    } finally {
      delete process.env.LEGACY_AUTHORIZER_ID;
    }
  });

  it('reference-bearing field with env entry but env unset → RESOURCE_REF_ENV_NOT_SET with var + reference', () => {
    const env = inlineEnv(
      `version: 1
functions:
  legacy_authorizer:
    id:
      env: UNSET_VAR
`,
      INDEX,
    );
    delete process.env.UNSET_VAR;
    expect(() =>
      resolveReferences(docBase, env, REFERENCE_BEARER_FIELDS, INDEX),
    ).toThrow(
      expect.objectContaining({
        name: 'ResourceRefError',
        code: 'RESOURCE_REF_ENV_NOT_SET',
        context: expect.objectContaining({
          envVar: 'UNSET_VAR',
          reference: '${resources.functions.legacy_authorizer.id}',
        }),
      }),
    );
  });

  it('reference-bearing field WITHOUT env entry → template preserved (not an error)', () => {
    const env = inlineEnv('version: 1\n', INDEX);
    const result = resolveReferences(docBase, env, REFERENCE_BEARER_FIELDS, INDEX);
    const components = result.components as Record<string, unknown>;
    const fid = (components.securitySchemes as Record<string, unknown>)['internal'] as Record<string, unknown>;
    const authorizer = fid['x-yc-apigateway-authorizer'] as Record<string, unknown>;
    expect(authorizer.function_id).toBe('${resources.functions.legacy_authorizer.id}');
  });

  it('absent env.yaml → template preserved', () => {
    const env = inlineEnv('version: 1\n', INDEX);
    const result = resolveReferences(docBase, env, REFERENCE_BEARER_FIELDS, INDEX);
    const components = result.components as Record<string, unknown>;
    const fid = (components.securitySchemes as Record<string, unknown>)['internal'] as Record<string, unknown>;
    const authorizer = fid['x-yc-apigateway-authorizer'] as Record<string, unknown>;
    expect(authorizer.function_id).toBe('${resources.functions.legacy_authorizer.id}');
  });

  it('bare function_id form (008-era) also resolves when env entry exists', () => {
    const docWithBare = {
      components: {
        securitySchemes: {
          internal: {
            'x-yc-apigateway-authorizer': {
              type: 'function',
              function_id: 'functions.legacy_authorizer',
            },
          },
        },
      },
      paths: {},
    };
    const env = inlineEnv(
      `version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
`,
      INDEX,
    );
    process.env.LEGACY_AUTHORIZER_ID = 'd4e123bare';
    try {
      const result = resolveReferences(docWithBare, env, REFERENCE_BEARER_FIELDS, INDEX);
      const components = result.components as Record<string, unknown>;
      const fid = (components.securitySchemes as Record<string, unknown>)['internal'] as Record<string, unknown>;
      const authorizer = fid['x-yc-apigateway-authorizer'] as Record<string, unknown>;
      expect(authorizer.function_id).toBe('d4e123bare');
    } finally {
      delete process.env.LEGACY_AUTHORIZER_ID;
    }
  });

  it('foreign interpolation in reference-bearing field → untouched verbatim', () => {
    const docWithForeign = {
      components: {
        securitySchemes: {
          internal: {
            'x-yc-apigateway-authorizer': {
              type: 'function',
              function_id: '${var.foo}',
            },
          },
        },
      },
      paths: {},
    };
    const env = inlineEnv('version: 1\n', INDEX);
    const result = resolveReferences(docWithForeign, env, REFERENCE_BEARER_FIELDS, INDEX);
    const components = result.components as Record<string, unknown>;
    const fid = (components.securitySchemes as Record<string, unknown>)['internal'] as Record<string, unknown>;
    const authorizer = fid['x-yc-apigateway-authorizer'] as Record<string, unknown>;
    expect(authorizer.function_id).toBe('${var.foo}');
  });

  it('deterministic: same inputs twice → byte-identical output', () => {
    const env = inlineEnv(
      `version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
`,
      INDEX,
    );
    process.env.LEGACY_AUTHORIZER_ID = 'd4e123det';
    try {
      const r1 = resolveReferences(docBase, env, REFERENCE_BEARER_FIELDS, INDEX);
      const r2 = resolveReferences(docBase, env, REFERENCE_BEARER_FIELDS, INDEX);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    } finally {
      delete process.env.LEGACY_AUTHORIZER_ID;
    }
  });
});

describe('resolveReferences — targeted resolution only (T030, FR-014/019, Edge cases)', () => {
  const INDEX = inlineIndex(`version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
`);

  it('foreign interpolations in NON-reference-bearing fields pass verbatim', () => {
    const docWithForeign = {
      info: { title: 'API', description: 'Uses ${var.foo} and ${resources.queues.events.qurl}' },
      paths: {},
    };
    const env = inlineEnv('version: 1\n', INDEX);
    const result = resolveReferences(docWithForeign, env, REFERENCE_BEARER_FIELDS, INDEX);
    expect(result.info).toEqual({ title: 'API', description: 'Uses ${var.foo} and ${resources.queues.events.qurl}' });
  });

  it('Terraform ${...} and build {{$ENV}} in reference-bearing field are NOT 009 references', () => {
    const docWithTerraform = {
      components: {
        securitySchemes: {
          internal: {
            'x-yc-apigateway-authorizer': {
              type: 'function',
              function_id: '$${yandex_function.legacy.id}',
            },
          },
        },
      },
      paths: {},
    };
    const env = inlineEnv('version: 1\n', INDEX);
    const result = resolveReferences(docWithTerraform, env, REFERENCE_BEARER_FIELDS, INDEX);
    const components = result.components as Record<string, unknown>;
    const fid = (components.securitySchemes as Record<string, unknown>)['internal'] as Record<string, unknown>;
    const authorizer = fid['x-yc-apigateway-authorizer'] as Record<string, unknown>;
    expect(authorizer.function_id).toBe('$${yandex_function.legacy.id}');
  });
});