// spec 016 outputs — buildOutputs: two-phase validate-first collect-all
// all-or-nothing + deterministic assembly. Pure transform (no fs; FR-018).
//
// Phase 1 — validate: user outputs in file order (reserved prefix, IDL
// resolver, duplicate names) + auto outputs in declaration order (`ycsf_`
// prefix, duplicates vs user+auto). Every problem is collected; ANY error →
// `{kind:'invalid', errors: ALL}` and NOTHING is serialized.
// Phase 2 — assembly (only when validation is clean): resolved user values
// (RAW `tfType.name.property`) + auto values (RAW tf expressions) are merged
// into one Record; `${...}` wrapping happens HERE, at the single assembly
// point (FR-011); keys are sorted by `serializeJson` (FR-012/FR-019).
import {
  OUT_DUPLICATE_NAME,
  OUT_INVALID,
  OUT_INVALID_AUTO_PREFIX,
  OUT_RESERVED_PREFIX,
} from '../contracts/index.js';
import type {
  BuildOutputsInput,
  BuildOutputsResult,
  OutputValue,
  OutputsDiagnostic,
} from '../contracts/index.js';
import { createIdlIndex } from '../extensions/idl.js';
import { serializeJson } from '../materialize/serialize.js';
import { out } from './errors.js';
import { resolveIdlReference } from './resolver.js';

const OUTPUTS_FILENAME = '99-ycsf-outputs.tf.json';
const RESERVED_AUTO_PREFIX = 'ycsf_';
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function buildOutputs(input: BuildOutputsInput): BuildOutputsResult {
  const errors: OutputsDiagnostic[] = [];
  const userOutputs = new Map<string, OutputValue>();

  // Phase 1a — user outputs, in file order. Duplicate-name detection is
  // defensive: YAML (uniqueKeys), JS objects and Maps all forbid duplicate
  // keys, so OUT_DUPLICATE_NAME is unreachable through the real API — kept
  // as a fail-fast guard for corrupt in-memory inputs (Constitution V).
  const index = createIdlIndex(input.resources);
  const seenUserNames = new Set<string>();
  for (const [name, entry] of Object.entries(input.outputsYaml.outputs)) {
    if (!NAME_RE.test(name)) {
      errors.push(
        out({ code: OUT_INVALID, message: `invalid output name '${name}' (must match [a-z][a-z0-9_]*) (OUT_INVALID)`, name }),
      );
      continue;
    }
    if (name.startsWith(RESERVED_AUTO_PREFIX)) {
      errors.push(
        out({ code: OUT_RESERVED_PREFIX, message: `output name '${name}' uses reserved prefix '${RESERVED_AUTO_PREFIX}' (OUT_RESERVED_PREFIX)`, name }),
      );
      continue;
    }
    if (seenUserNames.has(name)) {
      errors.push(
        out({ code: OUT_DUPLICATE_NAME, message: `output name '${name}' declared more than once (OUT_DUPLICATE_NAME)`, name }),
      );
      continue;
    }
    seenUserNames.add(name);

    const resolved = resolveIdlReference(entry.value, index, name);
    if (resolved.kind === 'error') {
      errors.push(resolved.error);
      continue;
    }
    // Store the RESOLVED raw Terraform address (wrapping is assembly's job).
    userOutputs.set(name, {
      value: resolved.id,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
    });
  }

  // Phase 1b — auto outputs, in declaration order. Values are raw Terraform
  // expressions (OutputBuilder.declare), NOT IDL references — no resolution.
  const autoOutputs = new Map<string, OutputValue>();
  const seenAutoNames = new Set<string>();
  for (const [name, entry] of input.materializerOutputs) {
    if (!name.startsWith(RESERVED_AUTO_PREFIX)) {
      errors.push(
        out({ code: OUT_INVALID_AUTO_PREFIX, message: `auto-generated output '${name}' does not start with '${RESERVED_AUTO_PREFIX}' (OUT_INVALID_AUTO_PREFIX)`, name }),
      );
      continue;
    }
    if (seenUserNames.has(name) || seenAutoNames.has(name)) {
      errors.push(
        out({ code: OUT_DUPLICATE_NAME, message: `output name '${name}' collides in the merged output file (OUT_DUPLICATE_NAME)`, name }),
      );
      continue;
    }
    seenAutoNames.add(name);
    autoOutputs.set(name, entry);
  }

  if (errors.length > 0) return { kind: 'invalid', errors };

  // Phase 2 — assembly: user first, then auto; both wrapped in ${...} here.
  const merged = new Map<string, OutputValue>();
  for (const [name, entry] of userOutputs) merged.set(name, entry);
  for (const [name, entry] of autoOutputs) merged.set(name, entry);

  if (merged.size === 0) {
    return { kind: 'ok', file: { filename: OUTPUTS_FILENAME, content: '{"output":{}}' } };
  }

  const output: Record<string, { value: string; description?: string }> = {};
  for (const [name, entry] of merged) {
    const wrapped = `\${${entry.value}}`;
    output[name] =
      entry.description !== undefined
        ? { value: wrapped, description: entry.description }
        : { value: wrapped };
  }

  return {
    kind: 'ok',
    file: { filename: OUTPUTS_FILENAME, content: serializeJson({ output }) },
  };
}