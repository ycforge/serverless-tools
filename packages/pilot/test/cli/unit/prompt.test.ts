import { describe, it, expect, afterEach } from 'vitest';
import { confirmDestroy } from '../../../src/cli/prompt.js';
import { DestroyRequiresYesError } from '../../../src/cli/errors.js';

describe('confirmDestroy prompt (T032)', () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true, configurable: true });
  });

  it('non-TTY stdin → throws DestroyRequiresYesError', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    await expect(confirmDestroy()).rejects.toThrow(DestroyRequiresYesError);
  });
});
