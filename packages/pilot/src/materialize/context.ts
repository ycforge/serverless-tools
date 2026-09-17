import type { MaterializationContext, OutputBuilder } from '../contracts/index.js';
import type { OutputValue } from './serialize.js';

/**
 * OutputBuilder implementation + live collection (data-model OutputCollection).
 *
 * `declare` is first-wins: a duplicate name is recorded in `duplicateNames`
 * (→ `MTL_OUTPUT_NAME_COLLISION` at serialize step, Constitution V — a
 * collision is an error, never a silent merge). `value` is the raw Terraform
 * expression WITHOUT `${...}`; wrapping is C's serialization duty (spec 002).
 */
export interface OutputCollection {
  /** First-wins declared outputs, in declaration order. */
  readonly declared: ReadonlyMap<string, OutputValue>;
  /** Names declared more than once across all materializer calls. */
  readonly duplicateNames: readonly string[];
}

export interface OutputBuilderWithCollection extends OutputBuilder, OutputCollection {
  readonly declared: ReadonlyMap<string, OutputValue>;
  readonly duplicateNames: readonly string[];
}

export function createOutputBuilder(): OutputBuilderWithCollection {
  const declared = new Map<string, OutputValue>();
  const duplicateNames: string[] = [];

  const builder: OutputBuilderWithCollection = {
    get declared() {
      return declared;
    },
    get duplicateNames() {
      return duplicateNames;
    },
    declare(name, output) {
      if (declared.has(name)) {
        if (!duplicateNames.includes(name)) duplicateNames.push(name);
        return;
      }
      declared.set(name, {
        value: output.value,
        ...(output.description !== undefined ? { description: output.description } : {}),
      });
    },
  };
  return builder;
}

/**
 * One dispatch call = one shared OutputBuilder (per data-model: "context per
 * dispatch call"), handed to every `materialize` invocation as `{ output }`.
 *
 * `projectRoot` (spec 028, T024) lets materializers write companion artifacts
 * into `<root>/infra/...` instead of the process cwd — the pipeline hands the
 * project root down through dispatch options. Absent for thin/dispatch-less
 * callers (e.g. `select`-level materialization) ⇒ legacy cwd-relative behavior.
 */
export function createContext(
  builder: OutputBuilderWithCollection,
  projectRoot?: string,
): MaterializationContext {
  return {
    output: builder,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
  };
}