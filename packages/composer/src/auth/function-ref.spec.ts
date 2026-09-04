import { describe, expect, it } from 'vitest';
import type { ParsedAuthYamlDocument } from './auth-yaml.js';
import {
  parseFunctionReference,
  resolveFunctionReference,
  validateFunctionReferences,
} from './function-ref.js';

const PARSED_WITH_FUNCTION: ParsedAuthYamlDocument = {
  version: 1,
  defaultScheme: 'internal',
  schemes: {
    internal: { type: 'function', function: 'functions.internal_authorizer' },
  },
};

describe('parseFunctionReference', () => {
  it('parses the two-segment functions.<name> grammar (AC1, FR-012)', () => {
    expect(parseFunctionReference('functions.internal_authorizer')).toEqual({
      ref: 'functions.internal_authorizer',
      name: 'internal_authorizer',
    });
  });

  it.each([
    'internal_authorizer',
    'functions.',
    'functions.Internal_authorizer',
    'functions.internal-authorizer',
    'functions.0start',
    'functions.nope.extra',
  ])('rejects malformed reference %j with AUTH_FUNCTION_INVALID_REF', (ref) => {
    expect(() => parseFunctionReference(ref)).toThrowError(
      expect.objectContaining({ code: 'AUTH_FUNCTION_INVALID_REF', ref }),
    );
  });
});

describe('resolveFunctionReference', () => {
  it('resolves a reference whose name is in the composition functions set', () => {
    expect(resolveFunctionReference('functions.internal_authorizer', ['internal_authorizer'])).toEqual(
      { ref: 'functions.internal_authorizer', name: 'internal_authorizer' },
    );
  });

  it('rejects a reference outside the set with AUTH_FUNCTION_UNRESOLVED (AC2, FR-012)', () => {
    expect(() =>
      resolveFunctionReference('functions.nope', ['internal_authorizer']),
    ).toThrowError(
      expect.objectContaining({ code: 'AUTH_FUNCTION_UNRESOLVED', ref: 'functions.nope' }),
    );
  });
});

describe('validateFunctionReferences', () => {
  it('resolves a valid reference set and fills the FunctionReference name', () => {
    const doc = validateFunctionReferences(PARSED_WITH_FUNCTION, ['internal_authorizer']);
    expect(doc).toEqual({
      version: 1,
      defaultScheme: 'internal',
      schemes: {
        internal: {
          type: 'function',
          function: { ref: 'functions.internal_authorizer', name: 'internal_authorizer' },
        },
      },
    });
  });

  it('takes only the caller-provided set — no function introspection (FR-012 SHALL NOT)', () => {
    const doc = validateFunctionReferences(PARSED_WITH_FUNCTION, ['internal_authorizer']);
    const internal = doc.schemes.internal as { type: 'function'; function: { ref: string; name: string } };
    expect(Object.keys(internal.function)).toEqual(['ref', 'name']);
  });

  it('requires the functions set when a function scheme is present (FR-012, V)', () => {
    expect(() => validateFunctionReferences(PARSED_WITH_FUNCTION, undefined)).toThrowError(
      expect.objectContaining({ code: 'AUTH_FUNCTION_SET_REQUIRED', schemeName: 'internal' }),
    );
  });

  it('returns the document untouched when it has no function schemes', () => {
    const parsed: ParsedAuthYamlDocument = {
      version: 1,
      defaultScheme: 'user',
      schemes: { user: { type: 'none' } },
    };
    expect(validateFunctionReferences(parsed, undefined)).toEqual(parsed);
  });

  it('checks grammar before the functions set requirement', () => {
    const parsed: ParsedAuthYamlDocument = {
      version: 1,
      defaultScheme: 'internal',
      schemes: { internal: { type: 'function', function: 'nope' } },
    };
    expect(() => validateFunctionReferences(parsed, undefined)).toThrowError(
      expect.objectContaining({ code: 'AUTH_FUNCTION_INVALID_REF', ref: 'nope' }),
    );
  });
});