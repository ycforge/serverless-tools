/**
 * Template syntax `${resources.<domain>.<name>.<property>}` (FR-007/019, §19).
 * The grammar mirrors resource-reference segments `[a-z][a-z0-9_]*`.
 */

export const TEMPLATE_PREFIX = '${resources.';

export const TEMPLATE_SUFFIX = '}';

/**
 * Matches the WHOLE string being a logical template reference. Capture groups:
 * 1 = domain, 2 = name, 3 = property. Malformed/foreign interpolations do not
 * match (FR-014).
 */
export const TEMPLATE_RE = /^\$\{resources\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\}$/;

/**
 * Bare 008-era authorizer form `functions.<name>` — accepted as an input form
 * during the 008→009 transition by the ENV resolution stage (research R6).
 */
export const BARE_FUNCTION_ID_RE = /^functions\.([a-z][a-z0-9_]*)$/;

export interface TemplateParts {
  readonly domain: string;
  readonly name: string;
  readonly property: string;
}

/**
 * Builds the artifact-facing `${resources.<domain>.<name>.<property>}` string.
 */
export function makeTemplate(parts: TemplateParts): string {
  return `${TEMPLATE_PREFIX}${parts.domain}.${parts.name}.${parts.property}${TEMPLATE_SUFFIX}`;
}