/**
 * Diagnostics for contract boundary failures (FR-016).
 *
 * Contract rejections (parser, predicates) throw {@link ContractError} with a
 * typed {@link Diagnostic.code}; silent degradation is not allowed
 * (Constitution V). Consumers compare codes via the {@link Diagnostics}
 * constants, never against string literals. Adding new codes is non-breaking.
 */
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
}

/**
 * Stable machine-readable codes for contract boundary failures.
 * Extend with new codes as new validated contracts appear (non-breaking).
 */
export const Diagnostics = {
  /** ResourceReference.ref does not match the canonical `domain.name.property` grammar. */
  InvalidResourceReference: 'INVALID_RESOURCE_REFERENCE',
} as const;

/**
 * Error thrown by contracts on any boundary rejection.
 * `name` is always `'ContractError'`; `code` carries the typed reason.
 */
export class ContractError extends Error implements Diagnostic {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}
