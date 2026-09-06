import { describe, expect, it } from 'vitest';

import { MTL_OUTPUT_NAME_COLLISION } from '../../src/contracts/index.js';
import { createOutputBuilder } from '../../src/materialize/context.js';
import { outputCollisionDiagnostics, serializeOutputs, type OutputValue } from '../../src/materialize/serialize.js';
import { GOLDEN_OUTPUTS_TF_JSON } from '../helpers/materialize-fixtures.js';

// T014: context.spec.ts — OutputBuilder + outputs serialization (FR-012, FR-013).

describe('context.ts / serializeOutputs', () => {
  it('T014: serializeOutputs golden quickstart Sc12 — value wrapped in ${...}, keys sorted (FR-012)', () => {
    const declared = new Map<string, OutputValue>([
      ['url', { value: 'function_url(user_service)', description: 'URL' }],
    ]);
    const content = serializeOutputs(declared);
    expect(content).toBe(GOLDEN_OUTPUTS_TF_JSON);
  });

  it('T014: OutputBuilder first-wins declare; duplicate name recorded and serialized as MTL_OUTPUT_NAME_COLLISION (FR-013, Sc13)', () => {
    const builder = createOutputBuilder();
    builder.declare('url', { value: 'function_url(user_service)', description: 'URL' });
    // Second declare from another artifact with the same name.
    builder.declare('url', { value: 'function_url(analytics)', description: 'DUP' });

    expect([...builder.declared.keys()]).toEqual(['url']);
    expect(builder.declared.get('url')?.value).toBe('function_url(user_service)');
    expect(builder.duplicateNames).toEqual(['url']);
    expect(serializeOutputs(builder.declared)).toBe(GOLDEN_OUTPUTS_TF_JSON);

    const diagnostics = outputCollisionDiagnostics(builder.duplicateNames);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: MTL_OUTPUT_NAME_COLLISION, outputName: 'url' });
  });
});