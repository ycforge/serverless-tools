import { describe, expect, it } from 'vitest';

import type { AuthYamlDocument } from '../auth/types.js';
import type { GatewayDocument } from './types.js';
import { applyAuth } from './auth-apply.js';

const AUTH_YAML: AuthYamlDocument = {
  version: 1,
  defaultScheme: 'user',
  schemes: {
    public: { type: 'none' },
    user: {
      type: 'jwt',
      jwksUri: 'https://auth.example.com/jwks.json',
      issuer: 'https://auth.example.com',
      audience: ['my-api'],
    },
    internal: {
      type: 'function',
      function: { ref: 'functions.internal_authorizer', name: 'internal_authorizer' },
    },
    frontend: { type: 'none' },
  },
};

function baseDoc(paths: Record<string, unknown>): GatewayDocument {
  return {
    openapi: '3.0.0',
    info: { title: 'gateway', version: '1.0.0' },
    paths,
  };
}

function securitySchemes(doc: GatewayDocument): Record<string, unknown> {
  const components = doc.components as Record<string, Record<string, unknown>> | undefined;
  return (components?.['securitySchemes'] ?? {}) as Record<string, unknown>;
}

describe('applyAuth — defaultScheme root security (US4/AC1/AC2, FR-011)', () => {
  it('non-none defaultScheme → root security: [{ <defaultScheme>: [] }] (US4/AC1)', () => {
    const doc = baseDoc({});
    applyAuth(doc, AUTH_YAML);
    expect(doc.security).toEqual([{ user: [] }]);
  });

  it('bare operations inherit root security; explicit op security is preserved (US4/AC1)', () => {
    const doc = baseDoc({
      '/a': { get: { operationId: 'getA', responses: { 200: { description: 'ok' } } } },
      '/b': {
        get: {
          operationId: 'getB',
          security: [{ internal: [] }],
          responses: { 200: { description: 'ok' } },
        },
      },
    });
    applyAuth(doc, AUTH_YAML);
    expect(doc.security).toEqual([{ user: [] }]);
    const opB = (doc.paths['/b'] as Record<string, { security?: unknown }> | undefined)?.['get'];
    expect(opB?.security).toEqual([{ internal: [] }]);
  });

  it('op with security: [] is preserved as explicitly-no-auth (US4/AC1)', () => {
    const doc = baseDoc({
      '/a': {
        get: { operationId: 'getA', security: [], responses: { 200: { description: 'ok' } } },
      },
    });
    applyAuth(doc, AUTH_YAML);
    const opA = (doc.paths['/a'] as Record<string, { security?: unknown }> | undefined)?.['get'];
    expect(opA?.security).toEqual([]);
  });

  it('defaultScheme type none → NO root security emitted (US4/AC2)', () => {
    const noneAuth: AuthYamlDocument = {
      version: 1,
      defaultScheme: 'public',
      schemes: {
        public: { type: 'none' },
        user: {
          type: 'jwt',
          jwksUri: 'https://auth.example.com/jwks.json',
          issuer: 'https://auth.example.com',
          audience: ['my-api'],
        },
      },
    };
    const doc = baseDoc({});
    applyAuth(doc, noneAuth);
    expect(doc.security).toBeUndefined();
  });
});

describe('applyAuth — securitySchemes emission (US4/AC3/AC4, FR-012/013)', () => {
  it('emits jwt scheme in exact Variant A openIdConnect form (US4/AC3)', () => {
    const doc = baseDoc({});
    applyAuth(doc, AUTH_YAML);
    const schemes = securitySchemes(doc);
    expect(schemes['user']).toEqual({
      type: 'openIdConnect',
      openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
      'x-yc-apigateway-authorizer': {
        type: 'jwt',
        jwksUri: 'https://auth.example.com/jwks.json',
        issuers: ['https://auth.example.com'],
        audiences: ['my-api'],
        identitySource: { in: 'header', name: 'Authorization', prefix: 'Bearer ' },
      },
    });
  });

  it('emits function scheme as http/bearer with logical function_id (US4/AC3)', () => {
    const doc = baseDoc({});
    applyAuth(doc, AUTH_YAML);
    const schemes = securitySchemes(doc);
    expect(schemes['internal']).toEqual({
      type: 'http',
      scheme: 'bearer',
      'x-yc-apigateway-authorizer': {
        type: 'function',
        function_id: 'functions.internal_authorizer',
      },
    });
    expect(JSON.stringify(schemes)).not.toMatch(/\$\{resources/);
  });

  it('none schemes → no securitySchemes entry, no authorizer (US4/AC4)', () => {
    const doc = baseDoc({});
    applyAuth(doc, AUTH_YAML);
    const schemes = securitySchemes(doc);
    expect(schemes['public']).toBeUndefined();
    expect(schemes['frontend']).toBeUndefined();
  });

  it('emits schemes in auth.yaml map order (FR-012)', () => {
    const doc = baseDoc({});
    applyAuth(doc, AUTH_YAML);
    const schemes = securitySchemes(doc);
    expect(Object.keys(schemes)).toEqual(['user', 'internal']);
  });

  it('jwt audiences scalar wraps into array (Variant A)', () => {
    const scalarAuth: AuthYamlDocument = {
      version: 1,
      defaultScheme: 'user',
      schemes: {
        user: {
          type: 'jwt',
          jwksUri: 'https://auth.example.com/jwks.json',
          issuer: 'https://auth.example.com',
          audience: 'single-aud',
        },
      },
    };
    const doc = baseDoc({});
    applyAuth(doc, scalarAuth);
    const schemes = securitySchemes(doc);
    expect((schemes['user'] as Record<string, unknown>)['x-yc-apigateway-authorizer']).toMatchObject({
      audiences: ['single-aud'],
    });
  });
});

describe('applyAuth — none-reference invariant and emission collision (US4, FR-006/011/012, V)', () => {
  it('op security referencing a none-type scheme → COMPOSE_SECURITY_REF_NONE_SCHEME (rule 9)', () => {
    const doc = baseDoc({
      '/a': {
        get: {
          operationId: 'getA',
          security: [{ frontend: [] }],
          responses: { 200: { description: 'ok' } },
        },
      },
    });
    expect(() => applyAuth(doc, AUTH_YAML)).toThrowError(
      expect.objectContaining({
        name: 'ComposeError',
        code: 'COMPOSE_SECURITY_REF_NONE_SCHEME',
        route: 'GET /a',
        schemeName: 'frontend',
      }),
    );
  });

  it('existing securitySchemes name colliding with an auth scheme to emit → COMPOSE_COMPONENT_COLLISION (FR-006)', () => {
    const doc = baseDoc({});
    doc.components = {
      securitySchemes: {
        user: { type: 'apiKey', name: 'X-Key', in: 'header' },
      },
    };
    expect(() => applyAuth(doc, AUTH_YAML)).toThrowError(
      expect.objectContaining({
        name: 'ComposeError',
        code: 'COMPOSE_COMPONENT_COLLISION',
        componentName: 'user',
        schemeName: 'user',
      }),
    );
  });
});
