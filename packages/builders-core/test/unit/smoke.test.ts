import { describe, expect, it } from 'vitest';

import { BUILDERS_CORE_VERSION } from '../../src/index.js';

describe('builders-core package scaffold (T006)', () => {
  it('exports a version placeholder from the root', () => {
    expect(BUILDERS_CORE_VERSION).toBe('0.1.0');
  });
});