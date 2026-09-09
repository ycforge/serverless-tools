import { describe, expect, it } from 'vitest';

import { MATERIALIZERS_CORE_VERSION } from '../../src/index.js';

describe('materializers-core package scaffold (T006)', () => {
  it('exports a version placeholder from the root', () => {
    expect(MATERIALIZERS_CORE_VERSION).toBe('0.1.0');
  });
});