import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { compileComposition, type CompileResult } from '../compile-core.js';
import { loadAppsYaml, filterGatewayApps, selectGatewayApp } from './load-config.js';
import { ResourceRefError } from '../resource/errors.js';
import type { CompileOptions } from './types.js';
import { CLIError, CompileError, IOError } from './errors.js';

process.env.SERVERLESS_TOOLS_OPENAPI_BUILD = '1';

export async function compileCommand(options: CompileOptions): Promise<CompileResult> {
  const projectRoot = resolve(options.projectDir);

  const appsConfig = await loadAppsYaml(join(projectRoot, '.ycsf', 'apps.yaml'));
  const gatewayApps = filterGatewayApps(appsConfig);
  const selectedApp = selectGatewayApp(gatewayApps, options.app);
  const appPath = resolve(projectRoot, selectedApp.path);

  const source = {
    appId: selectedApp.id,
    appName: selectedApp.name,
    appDir: appPath,
    openapiEntry: undefined,
    envOnly: options.envOnly,
  };

  try {
    const result = await compileComposition(source, projectRoot);
    const output = JSON.stringify(result.document, null, 2);

    if (options.output !== undefined) {
      const outputPath = resolve(options.output);
      await writeFile(outputPath, output, 'utf8');
    } else {
      process.stdout.write(output + '\n');
    }

    return result;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ResourceRefError) {
      throw new CompileError(message, 'UNRESOLVED_RESOURCE_REF', 1);
    }
    throw new IOError(`Compile failed: ${message}`, 'COMPILE_ERROR');
  }
}