import type { OpenApiDocument } from '../errors.js';

export type AuthScheme =
  | { type: 'none' }
  | { type: 'jwt'; jwksUri: string; issuer: string; audience: string | readonly string[] }
  | { type: 'function'; function: FunctionReference };

export interface FunctionReference {
  ref: string;
  name: string;
}

export interface AuthYamlDocument {
  version: 1;
  defaultScheme: string;
  schemes: Readonly<Record<string, AuthScheme>>;
}

export interface AuthValidationRequest {
  appRoot: string;
  openApi: OpenApiDocument;
  functions?: readonly string[];
}

export interface AuthValidationResult {
  authYaml: AuthYamlDocument;
}