import type { ResourceReference } from '../types.js';

/**
 * A ready-to-render Terraform template for the API Gateway OpenAPI companion.
 *
 * `configuration.spec = templatefile("<path>", { ...variableMap })` — the spec
 * YAML contains `${terraformType_name_property}` placeholders that Terraform
 * substitutes at APPLY time with the real resource attribute values
 * (`yandex_function.user_service.id`, etc.). This is the only mechanism that
 * lets a `file()`-served OpenAPI document reference attributes of sibling
 * resources (a literal `${yandex_function.user_service.id}` in a YAML string is
 * NOT interpolated by Terraform — spec content is read as raw text).
 *
 * @see packages/materializers-core/src/yandex-api-gateway/index.ts
 */
export interface GatewayTemplate {
  /** Companion YAML with `${terraformType_name_property}` template placeholders. */
  content: string;
  /** Placeholder → HCL attribute address, e.g. `yandex_function_user_service_id` → `yandex_function.user_service.id`. */
  variableMap: Record<string, string>;
}

/** `<terraformType>_<name>_<property>` — a valid HCL identifier holding the resource attribute. */
function globVarName(ref: ResourceReference, name: string, property: string): string {
  return `${ref.terraformType}_${name}_${property}`;
}

export function buildGatewayTemplate(
  spec: string,
  references: readonly ResourceReference[],
): GatewayTemplate {
  let content = spec;
  const variableMap: Record<string, string> = {};
  for (const ref of references) {
    const [domain, ...nameParts] = ref.logical.split('.');
    const name = nameParts.join('.');
    const property = ref.property ?? 'id';
    const search = `\${resources.${domain}.${name}.${property}}`;
    if (content.includes(search)) {
      const varName = globVarName(ref, name, property);
      const address = `${ref.terraformType}.${name}.${property}`;
      content = content.replaceAll(search, `\${${varName}}`);
      variableMap[varName] = address;
    }
  }
  return { content, variableMap };
}

// Backwards-compatible alias used by earlier specs/tests that only need the
// templated content string (no variable map).
export function replaceResourceRefs(
  spec: string,
  references: readonly ResourceReference[],
): string {
  return buildGatewayTemplate(spec, references).content;
}