// spec 021 ycsf-cli — CLIResult & CLIDiagnostic types (data-model §2.1–2.2).

/** CLI-level diagnostic (for errors before/during library dispatch). */
export interface CLIDiagnostic {
  /** Diagnostic code: CLI_* or library codes (PML_*, EXT_*, BRG_*, MTL_*, YCK_*). */
  readonly code: string;
  /** Human-readable description. */
  readonly message: string;
  /** Additional context fields (command-specific). */
  readonly details?: Record<string, unknown>;
}

/** Unified structured output for all commands (--json flag, D-RE-7). */
export interface CLIResult {
  /** Command name: 'build' | 'materialize' | 'check' | 'plan' | 'apply' | 'destroy'. */
  readonly command: string;
  /** Exit code: 0 = success, 1 = error, 2 = input/config error. */
  readonly exitCode: 0 | 1 | 2;
  /** Diagnostics from library + CLI errors. Empty array = clean. */
  readonly diagnostics: readonly CLIDiagnostic[];
  /** Command-specific summary. */
  readonly summary?: Record<string, unknown>;
}
