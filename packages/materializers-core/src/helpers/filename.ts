/**
 * TF address filename sanitization (FR-025, research D-RE-8). Bucket object
 * names must match the TF address grammar `[a-zA-Z0-9_]` (allowlist); the
 * original filename is preserved in the `key` attribute of the generated
 * resource, so sanitization only affects the Terraform address, never content.
 */

/**
 * Sanitize a filename into a TF-address-safe form: `[^\w]` → `_`, underscore
 * dedup, leading/trailing underscore trim. Empty result (or leading digit)
 * falls back to an address-preserving form.
 */
export function sanitizeFilename(filename: string): string {
  let out = filename.replace(/[^\w]/g, '_');
  out = out.replace(/_+/g, '_');
  out = out.replace(/^_+|_+$/g, '');
  if (out === '') return 'file';
  if (/^[0-9]/.test(out)) return `_${out}`;
  return out;
}

/** Matches the Terraform identifier grammar `[a-zA-Z_][a-zA-Z0-9_]*`. */
export function isTfAddress(value: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
}

/**
 * YC service resource-name pattern (functions/containers/gateways):
 * `[a-z][-a-z0-9]{1,61}[a-z0-9]` — no underscores. The TF-address `app id`
 * (underscores allowed) is mapped to a deployable YC name by `_` → `-`; the
 * stable identity stays the app id (`artifact.name`), only the provider-facing
 * `name` attribute is sanitized.
 */
export function toYcResourceName(appId: string): string {
  return appId.replace(/_/g, '-');
}
export const YC_RESOURCE_NAME_RE = /^[a-z][-a-z0-9]{1,61}[a-z0-9]$/;