/**
 * OutputBuilder implementation + live collection (output-builder, DQ-8) —
 * structural mirror of `packages/pilot/src/materialize/context.ts`.
 *
 * `declare` is first-wins: a duplicate name is recorded in `duplicateNames`
 * (→ `MTL_OUTPUT_NAME_COLLISION` at serialize step on the C side, Constitution
 * V — a collision is an error, never a silent merge). `value` is the raw
 * Terraform expression WITHOUT `${...}`; wrapping is C's serialization duty.
 */

import type { OutputBuilder } from '../types.js';

export interface OutputValue {
  readonly value: string;
  readonly description?: string;
}

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