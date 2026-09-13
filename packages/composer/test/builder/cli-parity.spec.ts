import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BuildContext } from '@ycforge/pilot/contracts';

import { compileCommand } from '../../src/cli/compile.js';
import builder from '../../src/builder/index.js';

const PARITY_ROOT = fileURLToPath(new URL('../fixtures/parity-legacy', import.meta.url));
const BUILDER_ROOT = fileURLToPath(new URL('../fixtures/builder-openapi', import.meta.url));
const APP_DIR = join(BUILDER_ROOT, 'apps', 'openapi');

async function makeBuilderContext(outputDir: string): Promise<BuildContext> {
  return {
    projectRoot: BUILDER_ROOT,
    sourcePath: APP_DIR,
    buildConfig: { build_config: { openapi_entry: './openapi.json' }, build_env: {} },
    buildEnv: {},
    outputDir,
  };
}

describe('CLI-parity: compileCommand vs builder.build byte-identical composition (T052/SC-005)', () => {
  it('(a) same app-dir + same openapi_entry → bit-identical JSON document (008 key sorting included)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ycsf-cli-parity-'));
    try {
      const cliOutput = join(root, 'cli.json');
      const cliResult = await compileCommand({ projectDir: PARITY_ROOT, app: 'openapi', output: cliOutput });
      const cliFileBytes = await readFile(cliOutput, 'utf8');

      const builderOutputDir = join(root, '.ycsf', 'artifacts', 'openapi');
      const { value } = await builder.build(await makeBuilderContext(builderOutputDir));
      const builderFileBytes = await readFile(value.specPath as string, 'utf8');

      expect(cliFileBytes).toBe(builderFileBytes);
      expect(cliResult.document).toEqual(JSON.parse(builderFileBytes));

      expect(JSON.parse(builderFileBytes)).toMatchObject({
        info: { title: 'builder-openapi' },
        paths: {
          '/v1/hello': expect.any(Object),
          '/v2/health': expect.any(Object),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('(b) two builder runs on the same context → byte-equal artifacts (determinism D-7)', async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), 'ycsf-builder-run-'));
    const secondRoot = await mkdtemp(join(tmpdir(), 'ycsf-builder-run-'));
    try {
      const first = await builder.build(await makeBuilderContext(join(firstRoot, '.ycsf', 'artifacts', 'openapi')));
      const second = await builder.build(await makeBuilderContext(join(secondRoot, '.ycsf', 'artifacts', 'openapi')));
      const firstBytes = await readFile(first.value.specPath as string, 'utf8');
      const secondBytes = await readFile(second.value.specPath as string, 'utf8');
      expect(firstBytes).toBe(secondBytes);
    } finally {
      await rm(firstRoot, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
    }
  });
});