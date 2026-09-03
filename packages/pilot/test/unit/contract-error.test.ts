import { describe, expect, it } from 'vitest';

import { ContractError, Diagnostics } from '../../src/contracts/index.js';

describe('ContractError', () => {
  it('is an Error subclass with a stable name', () => {
    const error = new ContractError(Diagnostics.InvalidResourceReference, 'invalid ref');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ContractError);
    expect(error.name).toBe('ContractError');
  });

  it('carries typed code and message (Diagnostic shape)', () => {
    const error = new ContractError(Diagnostics.InvalidResourceReference, 'invalid ref: "foo"');
    expect(error.code).toBe(Diagnostics.InvalidResourceReference);
    expect(error.code).toBe('INVALID_RESOURCE_REFERENCE');
    expect(error.message).toBe('invalid ref: "foo"');
  });
});
