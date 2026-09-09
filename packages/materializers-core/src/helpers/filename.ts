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