/**
 * Diagnostic code family JDT_* (FR-029). Published in spec contract
 * `specs/023-local-dev-server/contracts/local-dev-server.json` under
 * `#/definitions/jdtDiagnosticCode/enum`. JDT_IAM_UNAVAILABLE is a warning,
 * never a rejection (fail-open, D-10). Sources import the constants below —
 * string-literal comparisons are forbidden (constitution V).
 */
export const JDT_MQ_UNSUPPORTED = 'JDT_MQ_UNSUPPORTED';
export const JDT_NO_TRANSPORT = 'JDT_NO_TRANSPORT';
export const JDT_PORT_IN_USE = 'JDT_PORT_IN_USE';
export const JDT_INVALID_PORT = 'JDT_INVALID_PORT';
export const JDT_ENTRY_RESOLVE_FAILED = 'JDT_ENTRY_RESOLVE_FAILED';
export const JDT_ENTRY_MODULE_NOT_FOUND = 'JDT_ENTRY_MODULE_NOT_FOUND';
export const JDT_ENTRY_MODULE_AMBIGUOUS = 'JDT_ENTRY_MODULE_AMBIGUOUS';
export const JDT_IAM_UNAVAILABLE = 'JDT_IAM_UNAVAILABLE';

export const JDT_CODES = [
  JDT_MQ_UNSUPPORTED,
  JDT_NO_TRANSPORT,
  JDT_PORT_IN_USE,
  JDT_INVALID_PORT,
  JDT_ENTRY_RESOLVE_FAILED,
  JDT_ENTRY_MODULE_NOT_FOUND,
  JDT_ENTRY_MODULE_AMBIGUOUS,
  JDT_IAM_UNAVAILABLE,
] as const;

export type JdtDiagnosticCode = (typeof JDT_CODES)[number];

export class LocalDevServerError extends Error {
  override readonly cause?: unknown;
  readonly code: JdtDiagnosticCode;

  constructor(code: JdtDiagnosticCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'LocalDevServerError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Replaces every non-empty secret value in `text` with `[REDACTED]`.
 * Longer secrets are processed first so a shorter substring never mangles a
 * longer one into a partial fingerprint. `undefined`/empty entries are
 * ignored so callers can pass optional header values untouched.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | undefined>,
): string {
  const present = secrets
    .filter((secret): secret is string => typeof secret === 'string' && secret.length > 0)
    .sort((a, b) => b.length - a.length);
  if (present.length === 0) {
    return text;
  }
  let result = text;
  for (const secret of present) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}