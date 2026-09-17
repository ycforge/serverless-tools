export const AUTH_CONFIG_ERROR_CODES = [
  'AUTH_FILE_MISSING',
  'AUTH_FILE_INVALID_YAML',
  'AUTH_DUPLICATE_KEY',
  'AUTH_DUPLICATE_SCHEME',
  'AUTH_INVALID_SCHEME_NAME',
  'AUTH_VERSION_UNSUPPORTED',
  'AUTH_DEFAULT_MISSING',
  'AUTH_DEFAULT_UNRESOLVED',
  'AUTH_SCHEMES_EMPTY',
  'AUTH_SCHEMES_NOT_MAP',
  'AUTH_UNKNOWN_SCHEME_TYPE',
  'AUTH_MISSING_FIELD',
  'AUTH_FUNCTION_INVALID_REF',
  'AUTH_FUNCTION_UNRESOLVED',
  'AUTH_FUNCTION_SET_REQUIRED',
  'AUTH_SECURITY_UNDECLARED',
  'AUTH_SECURITY_PUBLIC_VIOLATION',
] as const;

export type AuthConfigErrorCode = (typeof AUTH_CONFIG_ERROR_CODES)[number];

export interface AuthConfigErrorContext {
  path?: string;
  schemeName?: string;
  field?: string;
  type?: string;
  ref?: string;
  route?: string;
  keyPath?: string;
  cause?: unknown;
}

const AUTH_ERROR_MESSAGE_BY_CODE: Record<AuthConfigErrorCode, (c: AuthConfigErrorContext) => string> = {
  AUTH_FILE_MISSING: (c) => `auth config file is missing or unreadable: ${c.path ?? '<unknown>'}`,
  AUTH_FILE_INVALID_YAML: (c) => `auth config file is not a valid YAML map: ${c.path ?? '<unknown>'}`,
  AUTH_DUPLICATE_KEY: (c) => `duplicate key in auth config: ${c.keyPath ?? '<unknown>'}`,
  AUTH_DUPLICATE_SCHEME: (c) => `duplicate scheme name in auth config: ${c.schemeName ?? '<unknown>'}`,
  AUTH_INVALID_SCHEME_NAME: (c) =>
    `auth config scheme name must be a non-empty string (schemeName: '${c.schemeName ?? ''}')`,
  AUTH_VERSION_UNSUPPORTED: (c) => `auth config version must be 1 (field: ${c.field ?? 'version'})`,
  AUTH_DEFAULT_MISSING: (c) => `auth config is missing required field: ${c.field ?? 'defaultScheme'}`,
  AUTH_DEFAULT_UNRESOLVED: (c) =>
    `auth config defaultScheme is not declared in schemes: ${c.schemeName ?? '<unknown>'}`,
  AUTH_SCHEMES_EMPTY: (c) => `auth config schemes map is empty (field: ${c.field ?? 'schemes'})`,
  AUTH_SCHEMES_NOT_MAP: (c) => `auth config schemes is not a mapping (field: ${c.field ?? 'schemes'})`,
  AUTH_UNKNOWN_SCHEME_TYPE: (c) => {
    const base = `auth config scheme ${c.schemeName ?? '<unknown>'}`;
    return c.type !== undefined ? `${base} has unknown type ${c.type}` : `${base} has unknown type`;
  },
  AUTH_MISSING_FIELD: (c) =>
    `auth config scheme ${c.schemeName ?? '<unknown>'} is missing required field: ${
      c.field ?? '<unknown>'
    }`,
  AUTH_FUNCTION_INVALID_REF: (c) =>
    `auth config function reference ${c.ref ?? '<unknown>'} does not match "functions.<name>"`,
  AUTH_FUNCTION_UNRESOLVED: (c) =>
    `auth config function reference ${c.ref ?? '<unknown>'} is not declared in the composition functions set`,
  AUTH_FUNCTION_SET_REQUIRED: (c) =>
    `auth config scheme ${c.schemeName ?? '<unknown>'} requires the composition functions set`,
  AUTH_SECURITY_UNDECLARED: (c) =>
    `auth config security entry references undeclared scheme ${c.schemeName ?? '<unknown>'} at ${
      c.route ?? '<unknown>'
    }`,
  AUTH_SECURITY_PUBLIC_VIOLATION: (c) =>
    `auth config security entry uses reserved scheme "public" at ${c.route ?? '<unknown>'}`,
};

export class AuthConfigError extends Error {
  readonly code: AuthConfigErrorCode;
  readonly path?: string;
  readonly schemeName?: string;
  readonly field?: string;
  readonly type?: string;
  readonly ref?: string;
  readonly route?: string;
  readonly keyPath?: string;
  override readonly cause?: unknown;

  constructor(code: AuthConfigErrorCode, context: AuthConfigErrorContext = {}) {
    super(AUTH_ERROR_MESSAGE_BY_CODE[code](context));
    this.name = 'AuthConfigError';
    this.code = code;
    this.path = context.path;
    this.schemeName = context.schemeName;
    this.field = context.field;
    this.type = context.type;
    this.ref = context.ref;
    this.route = context.route;
    this.keyPath = context.keyPath;
    this.cause = context.cause;
  }
}