import { describe, expect, it } from 'vitest';

import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import { isTfAddress, sanitizeFilename } from '../../src/helpers/filename.js';

const TF_ADDRESS = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const SANITIZE_CASES: readonly [string, string][] = [
  ['index.html', 'index_html'],
  ['style.css', 'style_css'],
  ['app.js', 'app_js'],
  ['my--file.name', 'my_file_name'],
  ['-leading', 'leading'],
];

describe('OutputBuilder collector (DQ-8, FR-005)', () => {
  it('declare is first-wins; duplicates are collected, never merged', () => {
    const builder = createOutputBuilder();
    builder.declare('user_service_function_id', { value: 'yandex_function.user_service.id' });
    builder.declare('user_service_function_id', { value: 'yandex_function.user_service.other' });
    expect(builder.declared.get('user_service_function_id')).toEqual({
      value: 'yandex_function.user_service.id',
    });
    expect(builder.duplicateNames).toEqual(['user_service_function_id']);
  });

  it('description is optional and preserved when provided (exactOptionalPropertyTypes)', () => {
    const builder = createOutputBuilder();
    builder.declare('no_desc', { value: 'a.id' });
    builder.declare('with_desc', { value: 'b.id', description: 'Function ID of user_service' });
    expect(builder.declared.get('no_desc')).toEqual({ value: 'a.id' });
    expect(builder.declared.get('with_desc')).toEqual({
      value: 'b.id',
      description: 'Function ID of user_service',
    });
    expect(Object.prototype.hasOwnProperty.call(builder.declared.get('no_desc'), 'description')).toBe(false);
  });

  it('declared outputs keep declaration order', () => {
    const builder = createOutputBuilder();
    builder.declare('a', { value: '1' });
    builder.declare('b', { value: '2' });
    expect([...builder.declared.keys()]).toEqual(['a', 'b']);
  });
});

describe('filename sanitization (FR-025, research D-RE-8)', () => {
  it.each(SANITIZE_CASES)('sanitizeFilename(%j) → %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('sanitized names satisfy the TF address grammar', () => {
    for (const [input] of SANITIZE_CASES) {
      expect(TF_ADDRESS.test(sanitizeFilename(input))).toBe(true);
    }
  });

  it('isTfAddress validates the TF address grammar', () => {
    expect(isTfAddress('yandex_function_user_service')).toBe(true);
    expect(isTfAddress('_leading_ok')).toBe(true);
    expect(isTfAddress('1starts_with_digit')).toBe(false);
    expect(isTfAddress('has-dash')).toBe(false);
    expect(isTfAddress('has.dot')).toBe(false);
    expect(isTfAddress('')).toBe(false);
  });
});