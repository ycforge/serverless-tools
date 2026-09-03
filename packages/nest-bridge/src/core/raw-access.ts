/**
 * Mixin contract guaranteeing lossless access to the raw Yandex payload a
 * normalized model was derived from.
 *
 * Normalization must be transformation, never mutation: unknown or additive
 * runtime fields stay reachable through `raw` even when the normalized model
 * does not describe them yet (AGENTS.md sections 7.3 and 36).
 */
export interface HasRaw<TRaw> {
  /**
   * The untouched raw Yandex event/context this model was built from.
   * Treat as read-only; mutating it corrupts diagnostics and replay tooling
   * (issue #11).
   */
  readonly raw: TRaw;
}
