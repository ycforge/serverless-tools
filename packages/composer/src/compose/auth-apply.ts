import type { AuthYamlDocument, AuthScheme } from '../auth/types.js';
import { ResourceRefError } from '../resource/errors.js';
import { emptyResourceIndex } from '../resource/resource-index.js';
import { makeTemplate } from '../resource/refs/template.js';
import type { ResourceIndex } from '../resource/types.js';
import { ComposeError } from './compose-errors.js';
import type { GatewayDocument } from './types.js';
import { isRecord } from './merge.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function securitySchemesOf(document: GatewayDocument): Record<string, Record<string, unknown>> {
  let components = document['components'];
  if (!isRecord(components)) {
    components = {};
    document['components'] = components;
  }
  let securitySchemes = components['securitySchemes'];
  if (!isRecord(securitySchemes)) {
    securitySchemes = {};
    components['securitySchemes'] = securitySchemes;
  }
  return securitySchemes as Record<string, Record<string, unknown>>;
}

function jwtSchemeRecord(scheme: Extract<AuthScheme, { type: 'jwt' }>): Record<string, unknown> {
  const audiences = Array.isArray(scheme.audience) ? scheme.audience : [scheme.audience];
  return {
    type: 'openIdConnect',
    openIdConnectUrl: `${scheme.issuer}/.well-known/openid-configuration`,
    'x-yc-apigateway-authorizer': {
      type: 'jwt',
      jwksUri: scheme.jwksUri,
      issuers: [scheme.issuer],
      audiences,
      identitySource: { in: 'header', name: 'Authorization', prefix: 'Bearer ' },
    },
  };
}

function functionSchemeRecord(
  scheme: Extract<AuthScheme, { type: 'function' }>,
  resourceIndex: ResourceIndex,
): Record<string, unknown> {
  const name = scheme.function.name;
  const reference = makeTemplate({ domain: 'functions', name, property: 'id' });
  if (!resourceIndex.validateProperty('functions', name, 'id')) {
    throw new ResourceRefError('RESOURCE_REF_NOT_DECLARED', {
      domain: 'functions',
      name,
      reference,
    });
  }
  return {
    type: 'http',
    scheme: 'bearer',
    'x-yc-apigateway-authorizer': {
      type: 'function',
      function_id: reference,
    },
  };
}

function assertNoNoneRefs(document: GatewayDocument, authYaml: AuthYamlDocument): void {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      if (!isRecord(operation)) {
        continue;
      }
      const security = operation['security'];
      if (!Array.isArray(security)) {
        continue;
      }
      for (const requirement of security) {
        if (!isRecord(requirement)) {
          continue;
        }
        for (const schemeName of Object.keys(requirement)) {
          const scheme = authYaml.schemes[schemeName];
          if (scheme !== undefined && scheme.type === 'none') {
            throw new ComposeError('COMPOSE_SECURITY_REF_NONE_SCHEME', {
              route: `${method.toUpperCase()} ${path}`,
              schemeName,
            });
          }
        }
      }
    }
  }
}

export function applyAuth(
  document: GatewayDocument,
  authYaml: AuthYamlDocument,
  resourceIndex: ResourceIndex = emptyResourceIndex(),
): void {
  assertNoNoneRefs(document, authYaml);

  if (authYaml.defaultScheme !== undefined) {
    const defaultScheme = authYaml.schemes[authYaml.defaultScheme];
    if (defaultScheme !== undefined && defaultScheme.type !== 'none') {
      document.security = [{ [authYaml.defaultScheme]: [] }];
    }
  }

  if (Object.keys(authYaml.schemes).length === 0) {
    return;
  }

  const securitySchemes = securitySchemesOf(document);
  for (const [schemeName, scheme] of Object.entries(authYaml.schemes)) {
    if (scheme.type === 'none') {
      continue;
    }
    if (schemeName in securitySchemes) {
      throw new ComposeError('COMPOSE_COMPONENT_COLLISION', {
        componentName: schemeName,
        schemeName,
      });
    }
    if (scheme.type === 'jwt') {
      securitySchemes[schemeName] = jwtSchemeRecord(scheme);
    } else {
      securitySchemes[schemeName] = functionSchemeRecord(scheme, resourceIndex);
    }
  }
}