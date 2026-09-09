import type { ResourceReference } from '../types.js';

export function replaceResourceRefs(spec: string, references: readonly ResourceReference[]): string {
  let result = spec;
  for (const ref of references) {
    const [typeSegment, ...nameParts] = ref.logical.split('.');
    const nameSegment = nameParts.join('.');
    const search = `\${resources.${typeSegment}.${nameSegment}.id}`;
    const replacement = `\${${ref.terraformType}.${nameSegment}.id}`;
    result = result.replaceAll(search, replacement);
  }
  return result;
}
