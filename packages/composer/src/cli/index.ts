import { Command } from 'commander';
import { resolve } from 'node:path';

import { compileCommand } from './compile.js';
import { checkCommand } from './check.js';
import type { CompileOptions, CheckOptions } from './types.js';
import { CLIError } from './errors.js';

const program = new Command();

program
  .name('ycsf-api')
  .description('Yandex Cloud Serverless Functions API Gateway CLI - compile and check OpenAPI compositions')
  .version('0.1.0')
  .option('-p, --project-dir <path>', 'Project directory (default: current directory)', process.cwd())
  .option('-a, --app <appId>', 'Select specific gateway app (required when multiple gateway apps exist)');

async function fail(error: unknown, coerceToCheckContract = false): Promise<void> {
  if (error instanceof CLIError) {
    console.error(`Error: ${error.message}`);
    const exitCode = coerceToCheckContract && error.exitCode === 3 ? 2 : error.exitCode;
    process.exitCode = exitCode;
    return;
  }
  console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

program
  .command('compile')
  .description('Compile unified OpenAPI spec from gateway app')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--env-only', 'ENV-only mode: skip OpenAPI file reads, use placeholders')
  .option('--json', 'Output JSON (for machine parsing, not OpenAPI)')
  .action(async function (this: Command) {
    const opts = this.optsWithGlobals();
    try {
      const compileOptions: CompileOptions = {
        projectDir: resolve(opts.projectDir),
        output: opts.output ? resolve(opts.output) : undefined,
        app: opts.app,
        envOnly: opts.envOnly,
        json: opts.json,
      };

      await compileCommand(compileOptions);
    } catch (error) {
      await fail(error);
    }
  });

program
  .command('check')
  .description('Validate API composition contracts without Terraform')
  .option('--env-only', 'ENV-only mode: skip OpenAPI file existence check')
  .option('--json', 'Output machine-readable JSON')
  .action(async function (this: Command) {
    const opts = this.optsWithGlobals();
    try {
      const checkOptions: CheckOptions = {
        projectDir: resolve(opts.projectDir),
        app: opts.app,
        envOnly: opts.envOnly,
        json: opts.json,
      };

      const summary = await checkCommand(checkOptions);

      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        for (const result of summary.results) {
          const icon = result.passed ? '✓' : '✗';
          console.log(`${icon} ${result.check}${result.details ? `: ${result.details}` : ''}`);
          if (!result.passed && result.errors) {
            for (const err of result.errors) {
              console.log(`    ${err.code}: ${err.message}`);
              if (err.source) console.log(`    Source: ${err.source}`);
              if (err.routes && err.routes.length > 0) {
                for (const route of err.routes) {
                  console.log(`    Route: ${route.method} ${route.path}${route.operationId ? ` (${route.operationId})` : ''}`);
                }
              }
            }
          }
        }
        console.log('');
        if (summary.summary.failed === 0) {
          console.log(`All ${summary.summary.total} checks passed.`);
        } else {
          console.log(`${summary.summary.failed} check(s) failed.`);
        }
      }

      process.exitCode = summary.exitCode;
    } catch (error) {
      await fail(error, true);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});