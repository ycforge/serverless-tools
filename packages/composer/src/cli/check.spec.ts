import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkCommand } from './check.js';

const FIXTURE = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${name}/`, import.meta.url));
const CONTRACT_PATH = fileURLToPath(
  new URL('../../../../specs/010-ycsf-api-cli/contracts/check-output.json', import.meta.url),
);

interface Schema {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
  additionalProperties?: boolean;
}

function validateAgainstSchema(value: unknown, schema: Schema, path: string, errors: string[]): void {
  const type = schema.type;

  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in record) {
        validateAgainstSchema(record[key], child, `${path}.${key}`, errors);
      }
    }
    return;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected an array`);
      return;
    }
    for (let i = 0; i < value.length; i += 1) {
      validateAgainstSchema(value[i], schema.items ?? {}, `${path}[${i}]`, errors);
    }
    return;
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path}: expected a string`);
    }
  } else if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      errors.push(`${path}: expected an integer`);
    }
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${path}: expected a boolean`);
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }
}

function toJsonRecord(summary: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(summary));
}

describe('check --json — contract conformance (T036)', () => {
  it('produces output structurally matching contracts/check-output.json for a passing project', async () => {
    const contract = JSON.parse(
      await readFile(CONTRACT_PATH, 'utf8'),
    ) as { $schema?: string };

    expect(contract.$schema).toBe('http://json-schema.org/draft-07/schema#');

    const summary = await checkCommand({ projectDir: FIXTURE('cli-pass') });
    const record = toJsonRecord(summary);

    const errors: string[] = [];
    validateAgainstSchema(record, contract as unknown as Schema, 'check-output', errors);
    expect(errors).toEqual([]);

    expect(record['summary']).toEqual({ passed: 5, failed: 0, total: 5 });
    expect(record['exitCode']).toBe(0);

    const results = record['results'] as Array<{ check: string; passed: boolean }>;
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.passed).toBe(true);
    }
    expect(results.map((r) => r.check).sort()).toEqual([
      'auth-schemes-valid',
      'no-path-operationid-conflicts',
      'openapi-sources-exist',
      'overrides-targets-exist',
      'resource-refs-resolvable',
    ]);
  });

  it('shapes a failing project as contract-compliant JSON with exitCode 1', async () => {
    const contract = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'));
    const summary = await checkCommand({ projectDir: FIXTURE('cli-bad-ref') });
    const record = toJsonRecord(summary);

    const errors: string[] = [];
    validateAgainstSchema(record, contract as unknown as Schema, 'check-output', errors);
    expect(errors).toEqual([]);

    expect(record['exitCode']).toBe(1);
    const summaryCounts = record['summary'] as { passed: number; failed: number; total: number };
    expect(summaryCounts.failed).toBeGreaterThan(0);

    const results = record['results'] as Array<{ check: string; passed: boolean }>;
    expect(results.filter((r) => r.passed)).toHaveLength(summaryCounts.passed);
    expect(results.filter((r) => !r.passed)).toHaveLength(summaryCounts.failed);
  });

  it('reports an ISO 8601 date-time timestamp', async () => {
    const summary = await checkCommand({ projectDir: FIXTURE('cli-pass') });
    expect(summary.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });
});