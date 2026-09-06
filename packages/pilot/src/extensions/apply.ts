// spec 015 extensions — applyExtensions: IDL resolution + deep merge of
// `.ycsf/extensions.yaml` rules over a list of Terraform resources.
// Pure transform (US-5/SC-003: determines its result from memory alone,
// never reads or writes files); all-or-nothing — any diagnostic negates the
// whole transform and leaves inputs untouched.
import { EXT_DUPLICATE_TARGET, EXT_INVALID, EXT_UNRESOLVED_TARGET } from '../contracts/index.js';
import type { ApplyExtensionsResult, ExtensionRule, ExtensionsDiagnostic, TerraformResource } from '../contracts/index.js';
import { deepMerge, isPlainObject } from './deep-merge.js';
import { ext } from './errors.js';
import { createIdlIndex } from './idl.js';

type ExtensionsInput = {
  readonly version: 1;
  readonly extensions: readonly ExtensionRule[];
};

/** Friendly list of {diagnostics, all-or-nothing}. */
function applyRules(
  resources: readonly TerraformResource[],
  extensions: readonly ExtensionRule[],
): ApplyExtensionsResult {
  const errors: ExtensionsDiagnostic[] = [];

  // 1. IDL index + defensive check (A5: emitted FIRST, then duplicates,
  // then unresolved in file order — collect-all, never an early return).
  const index = createIdlIndex(resources);
  for (const idl of index.duplicateIdls) {
    errors.push(
      ext({
        code: EXT_INVALID,
        message: `duplicate IDL ${idl} in generated model (EXT_INVALID)`,
        target: idl,
      }),
    );
  }

  // 2. Duplicate targets — by appearance, fail the whole transform.
  const seenTargets = new Set<string>();
  for (const rule of extensions) {
    if (seenTargets.has(rule.target)) {
      errors.push(
        ext({
          code: EXT_DUPLICATE_TARGET,
          message: `duplicate extension target '${rule.target}' (EXT_DUPLICATE_TARGET)`,
          target: rule.target,
        }),
      );
    } else {
      seenTargets.add(rule.target);
    }
  }

  // 3. Unresolved targets + config-defensive checks, in file order.
  for (const rule of extensions) {
    const targetResource = index.byIdl.get(rule.target);
    if (targetResource === undefined) {
      errors.push(
        ext({
          code: EXT_UNRESOLVED_TARGET,
          message: `unresolved extension target '${rule.target}' (EXT_UNRESOLVED_TARGET); available IDLs: ${index.availableIdls.join(', ')}`,
          target: rule.target,
          availableIdls: index.availableIdls,
        }),
      );
      continue;
    }
    if (!isPlainObject(targetResource.configuration)) {
      errors.push(
        ext({
          code: EXT_INVALID,
          message: `resource '${rule.target}' has a non-object configuration (EXT_INVALID)`,
          target: rule.target,
        }),
      );
      continue;
    }
    if (!isPlainObject(rule.patch)) {
      errors.push(
        ext({
          code: EXT_INVALID,
          message: `patch of rule '${rule.target}' must be a mapping (EXT_INVALID)`,
          target: rule.target,
        }),
      );
    }
  }

  if (errors.length > 0) return { kind: 'invalid', errors };

  // 4. Apply all-or-nothing: patched resources in rule file order, then
  // untouched resources in input order (by reference).
  const result: TerraformResource[] = [];
  const touched = new Set<TerraformResource>();
  for (const rule of extensions) {
    const targetResource = index.byIdl.get(rule.target)!;
    touched.add(targetResource);
    result.push({
      ...targetResource,
      configuration: deepMerge(targetResource.configuration, rule.patch),
    } as TerraformResource);
  }
  for (const resource of resources) {
    if (!touched.has(resource)) result.push(resource);
  }

  return { kind: 'ok', resources: result };
}

/**
 * Apply `.ycsf/extensions.yaml` rules over `resources` (data-model.md §25).
 *
 * `resources` and `extensions` are never mutated. The `extensions` argument
 * must be a `version: 1` ExtensionsYaml — otherwise the call is rejected
 * (defensive, Constitution V; plain JS callers pass parse/loadExtensions
 * output).
 */
export function applyExtensions(
  resources: readonly TerraformResource[],
  extensions: ExtensionsInput,
): ApplyExtensionsResult {
  if (!Array.isArray(extensions?.extensions)) {
    throw new Error('applyExtensions: extensions must be a parsed .ycsf/extensions.yaml document (version: 1) (EXT_INVALID)');
  }
  if (extensions.version !== 1) {
    throw new Error(`applyExtensions: unsupported extensions version '${
      String((extensions as { version?: unknown }).version)
    }' (supported: 1) (EXT_VERSION)`);
  }

  return applyRules(resources, extensions.extensions);
}