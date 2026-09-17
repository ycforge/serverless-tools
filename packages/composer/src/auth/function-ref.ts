import type { AuthScheme, FunctionReference } from './types.js';
import type { AuthYamlDocument } from './types.js';
import type { ParsedAuthYamlDocument } from './auth-yaml.js';
import { AuthConfigError } from './auth-errors.js';

const FUNCTION_REF_PATTERN = /^functions\.([a-z][a-z0-9_]*)$/;

export function parseFunctionReference(ref: string): FunctionReference {
  const match = FUNCTION_REF_PATTERN.exec(ref);
  const name = match?.[1];
  if (name === undefined) {
    throw new AuthConfigError('AUTH_FUNCTION_INVALID_REF', { ref });
  }
  return { ref, name };
}

export function resolveFunctionReference(
  ref: string,
  functions: readonly string[],
): FunctionReference {
  const parsed = parseFunctionReference(ref);
  if (!functions.includes(parsed.name)) {
    throw new AuthConfigError('AUTH_FUNCTION_UNRESOLVED', { ref });
  }
  return parsed;
}

export function validateFunctionReferences(
  authYaml: ParsedAuthYamlDocument,
  functions?: readonly string[],
): AuthYamlDocument {
  const functionSchemes = Object.entries(authYaml.schemes).filter(
    (entry): entry is [string, { type: 'function'; function: string }] => entry[1].type === 'function',
  );
  if (functionSchemes.length === 0) {
    return authYaml as AuthYamlDocument;
  }

  const parsedByScheme: Record<string, FunctionReference> = {};
  for (const [schemeName, scheme] of functionSchemes) {
    parsedByScheme[schemeName] = parseFunctionReference(scheme.function);
  }

  if (functions === undefined) {
    throw new AuthConfigError('AUTH_FUNCTION_SET_REQUIRED', {
      schemeName: functionSchemes[0]?.[0],
    });
  }

  for (const parsed of Object.values(parsedByScheme)) {
    resolveFunctionReference(parsed.ref, functions);
  }

  const schemes: Record<string, AuthScheme> = {};
  for (const [schemeName, scheme] of Object.entries(authYaml.schemes)) {
    if (scheme.type === 'function') {
      const parsed = parsedByScheme[schemeName];
      if (parsed !== undefined) {
        schemes[schemeName] = { type: 'function', function: parsed };
      }
    } else {
      schemes[schemeName] = scheme;
    }
  }
  return {
    version: authYaml.version,
    defaultScheme: authYaml.defaultScheme,
    schemes,
  };
}