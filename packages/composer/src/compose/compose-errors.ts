export const COMPOSE_ERROR_CODES = [
  'COMPOSE_NO_PARTICIPANTS',
  'COMPOSE_OPENAPI_VERSION_MISMATCH',
  'COMPOSE_PATH_COLLISION',
  'COMPOSE_OPERATIONID_COLLISION',
  'COMPOSE_COMPONENT_COLLISION',
  'COMPOSE_SECURITY_REF_NONE_SCHEME',
  'COMPOSE_INFO_MISSING',
  'OVERRIDE_FILE_UNREADABLE',
  'OVERRIDE_FILE_INVALID_YAML',
  'OVERRIDE_VERSION_UNSUPPORTED',
  'OVERRIDE_RULES_NOT_LIST',
  'OVERRIDE_RULES_EMPTY',
  'OVERRIDE_UNKNOWN_OP',
  'OVERRIDE_INVALID_TARGET',
  'OVERRIDE_VALUE_REQUIRED',
  'OVERRIDE_VALUE_FORBIDDEN',
  'OVERRIDE_METHOD_INVALID',
  'OVERRIDE_TARGET_MISSING',
  'OVERRIDE_TARGET_ALREADY_EXISTS',
  'OVERRIDE_OUT_OF_SCOPE',
] as const;

export type ComposeErrorCode = (typeof COMPOSE_ERROR_CODES)[number];

export interface ComposeErrorContext {
  app?: string;
  path?: string;
  method?: string;
  operationId?: string;
  componentName?: string;
  target?: string;
  op?: string;
  ruleIndex?: number;
  filePath?: string;
  schemeName?: string;
  route?: string;
  versions?: readonly string[];
  apps?: readonly string[];
  paths?: readonly string[];
  kind?: string;
  targetPath?: string;
  targetKind?: string;
  owner?: string;
  cause?: unknown;
}

const COMPOSE_ERROR_MESSAGE_BY_CODE: Record<
  ComposeErrorCode,
  (c: ComposeErrorContext) => string
> = {
  COMPOSE_NO_PARTICIPANTS: () => 'composition requires at least one participant app',
  COMPOSE_OPENAPI_VERSION_MISMATCH: (c) =>
    `participants declare conflicting OpenAPI versions (apps: ${
      (c.apps ?? []).join(', ') || '<unknown>'
    }, versions: ${(c.versions ?? []).join(', ') || '<unknown>'})`,
  COMPOSE_PATH_COLLISION: (c) =>
    `path ${c.path ?? '<unknown>'} is declared by more than one app (${
      (c.apps ?? []).join(', ') || '<unknown>'
    })`,
  COMPOSE_OPERATIONID_COLLISION: (c) =>
    `operationId ${c.operationId ?? '<unknown>'} is declared by more than one operation (${
      (c.paths ?? []).join(', ') || '<unknown>'
    })`,
  COMPOSE_COMPONENT_COLLISION: (c) =>
    `component ${c.componentName ?? '<unknown>'} is declared by more than one app (${
      (c.apps ?? []).join(', ') || '<unknown>'
    })`,
  COMPOSE_SECURITY_REF_NONE_SCHEME: (c) =>
    `operation ${c.route ?? '<unknown>'} references none-type scheme ${
      c.schemeName ?? '<unknown>'
    } which cannot be emitted`,
  COMPOSE_INFO_MISSING: () =>
    'gateway document is missing info; provide an info override in <compositionRoot>/overrides.yaml',
  OVERRIDE_FILE_UNREADABLE: (c) => `override file is unreadable: ${c.filePath ?? '<unknown>'}`,
  OVERRIDE_FILE_INVALID_YAML: (c) =>
    `override file is not a valid YAML map: ${c.filePath ?? '<unknown>'}`,
  OVERRIDE_VERSION_UNSUPPORTED: (c) =>
    `override file version must be 1: ${c.filePath ?? '<unknown>'}`,
  OVERRIDE_RULES_NOT_LIST: (c) =>
    `override file rules must be a non-empty list: ${c.filePath ?? '<unknown>'}`,
  OVERRIDE_RULES_EMPTY: (c) => `override file rules is empty: ${c.filePath ?? '<unknown>'}`,
  OVERRIDE_UNKNOWN_OP: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} uses unknown op ${c.op ?? '<unknown>'}`,
  OVERRIDE_INVALID_TARGET: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} addresses invalid target ${
      c.kind ?? '<unknown>'
    }`,
  OVERRIDE_VALUE_REQUIRED: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} (op: ${c.op ?? '<unknown>'}) requires a value`,
  OVERRIDE_VALUE_FORBIDDEN: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} (remove) must not carry a value`,
  OVERRIDE_METHOD_INVALID: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} uses invalid method ${c.method ?? '<unknown>'} (path: ${
      c.path ?? '<unknown>'
    })`,
  OVERRIDE_TARGET_MISSING: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} targets missing ${c.target ?? '<unknown>'} (path: ${
      c.path ?? '<unknown>'
    })`,
  OVERRIDE_TARGET_ALREADY_EXISTS: (c) =>
    `override rule #${c.ruleIndex ?? '<unknown>'} targets existing ${
      c.target ?? '<unknown>'
    } (path: ${c.path ?? '<unknown>'})`,
  OVERRIDE_OUT_OF_SCOPE: (c) =>
    `local override of app ${c.app ?? '<unknown>'} targets out-of-scope ${
      c.targetKind ?? '<unknown>'
    } (path: ${c.targetPath ?? '<unknown>'}${c.owner !== undefined ? `, owner: ${c.owner}` : ''})`,
};

export class ComposeError extends Error {
  readonly code: ComposeErrorCode;
  readonly app?: string;
  readonly path?: string;
  readonly method?: string;
  readonly operationId?: string;
  readonly componentName?: string;
  readonly target?: string;
  readonly op?: string;
  readonly ruleIndex?: number;
  readonly filePath?: string;
  readonly schemeName?: string;
  readonly route?: string;
  readonly versions?: readonly string[];
  readonly apps?: readonly string[];
  readonly paths?: readonly string[];
  readonly kind?: string;
  readonly targetPath?: string;
  readonly targetKind?: string;
  readonly owner?: string;
  override readonly cause?: unknown;

  constructor(code: ComposeErrorCode, context: ComposeErrorContext = {}) {
    super(COMPOSE_ERROR_MESSAGE_BY_CODE[code](context));
    this.name = 'ComposeError';
    this.code = code;
    this.app = context.app;
    this.path = context.path;
    this.method = context.method;
    this.operationId = context.operationId;
    this.componentName = context.componentName;
    this.target = context.target;
    this.op = context.op;
    this.ruleIndex = context.ruleIndex;
    this.filePath = context.filePath;
    this.schemeName = context.schemeName;
    this.route = context.route;
    this.versions = context.versions;
    this.apps = context.apps;
    this.paths = context.paths;
    this.kind = context.kind;
    this.targetPath = context.targetPath;
    this.targetKind = context.targetKind;
    this.owner = context.owner;
    this.cause = context.cause;
  }
}