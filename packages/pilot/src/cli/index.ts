// spec 021 ycsf-cli — entry point: commander program + error handler (D-RE-9, D-RE-13).
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAction } from './build.js';
import { materializeAction } from './materialize.js';
import { checkAction } from './check.js';
import { planAction } from './plan.js';
import { applyAction } from './apply.js';
import { destroyAction } from './destroy.js';
import {
  CLIError,
  CLI_UNKNOWN_COMMAND,
  CLI_UNEXPECTED_ERROR,
  ExitCode,
} from './errors.js';
import type { CLIResult, CLIDiagnostic } from './result.js';

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('ycsf')
  .description('Yandex Cloud serverless-tools build/deployment orchestrator (Project C)')
  .version(packageVersion())
  .option('-p, --project-dir <path>', 'Project directory (default: current directory)', process.cwd())
  .option('--json', 'Output machine-readable JSON')
  .option('--no-color', 'Disable ANSI colors in human-readable output')
  .configureHelp({ showGlobalOptions: true })
  // commander writes "error: ..." to stderr before throwing CommanderError;
  // we suppress that raw write and emit our own diagnostics in fail() (FR-001).
  .configureOutput({ writeErr: () => {} });

// commander 12 calls actions as fn(options, command) with `this` bound to the
// Command. Our action helpers accept a Command (mirroring composer's
// `function (this: Command)` pattern), so bind `this` and forward it.
const bindAction = (fn: (cmd: Command) => Promise<void>) =>
  function (this: Command): Promise<void> {
    return fn(this);
  };

program
  .command('build')
  .description('Build all apps using their configured builders')
  .option('--target <app>', 'Build only this app (by app ID from apps.yaml)')
  .action(bindAction(buildAction));

program
  .command('materialize')
  .description('Run materializers to generate Terraform .tf.json files')
  .option('--target <app>', 'Materialize only this app (by app ID from apps.yaml)')
  .action(bindAction(materializeAction));

program
  .command('check')
  .description('Validate project-level contracts without Terraform')
  .option('--validate-tf', 'Run terraform validate as a final step')
  .action(bindAction(checkAction));

program
  .command('plan')
  .description('Run full pipeline: build, materialize, then terraform plan')
  .action(bindAction(planAction));

program
  .command('apply')
  .description('Run full pipeline: build, materialize, terraform plan, then terraform apply')
  .action(bindAction(applyAction));

program
  .command('destroy')
  .description('Destroy infrastructure via terraform destroy, optionally clean up generated files')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--cleanup', 'Delete generated .tf.json files from infra/ after destroy')
  .action(bindAction(destroyAction));

// exitOverride() lets us catch commander's thrown CommanderError (unknown
// command / unknown option / --help / --version) and map them to our exit
// codes instead of commander calling process.exit directly (FR-001, FR-003).
// In commander 12 the override does NOT propagate to subcommands, so apply
// it to every registered command.
program.exitOverride();
for (const sub of program.commands) sub.exitOverride();

// Wire --no-color to the NO_COLOR standard (D-RE-13): the negatable option
// `--no-color` surfaces as `opts.color === false` (commander attribute name
// strips the `no-` prefix). preAction runs right before every action so the
// env var is set before any progress/error output is emitted (FR-006).
program.hook('preAction', (thisCommand: Command): void => {
  const opts = thisCommand.optsWithGlobals() as { color?: boolean };
  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }
});

async function fail(error: unknown, commandName: string, json: boolean): Promise<void> {
  const diagnostics: CLIDiagnostic[] = [];
  let exitCode: 0 | 1 | 2 = ExitCode.Error;

  const emit = (result: CLIResult): void => {
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  };

  if (error instanceof CLIError) {
    exitCode = error.exitCode;
    diagnostics.push({ code: error.code, message: error.message });
    emit({ command: commandName, exitCode, diagnostics });
    if (!json) process.stderr.write(`Error: ${error.message}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    exitCode = ExitCode.Error;
    diagnostics.push({ code: CLI_UNEXPECTED_ERROR, message });
    emit({ command: commandName, exitCode, diagnostics });
    if (!json) process.stderr.write(`Unexpected error: ${message}\n`);
  }
  process.exitCode = exitCode;
}

/** Run the CLI. Commands may be parsed through a list of raw args. */
export async function main(argv: string[] = process.argv): Promise<number> {
  const commandName = detectCommand(argv);
  // json is derived from the parsed argv (not the global process.argv) so
  // in-process invocation stays consistent with the real binary (FR-005).
  const json = argv.includes('--json');
  try {
    await program.parseAsync(argv);

    return typeof process.exitCode === 'number' ? process.exitCode : ExitCode.Success;
  } catch (error) {
    // commander throws CommanderError for --help / --version / unknown command
    // when exitOverride() is active. help/version are normal exits (0).
    const code = (error as { code?: string })?.code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version') {
      return ExitCode.Success;
    }
    // Bare `ycsf` (no args, no subcommand): commander 12 routes to
    // `help({ error: true })` → throws 'commander.help' with placeholder
    // `(outputHelp)` and writes the real help to the (suppressed) error
    // stream. Surface the full help on stdout and exit 0 (T157).
    if (code === 'commander.help') {
      process.stdout.write(program.helpInformation());
      return ExitCode.Success;
    }
    // Any other commander input error (unknown command, unknown option, missing
    // argument) is a user-input error → exit 2 (FR-001), reported as CLI_* code.
    if (typeof code === 'string' && code.startsWith('commander.')) {
      const message = error instanceof Error ? error.message : String(error);
      // Strip commander's own "error: " prefix (we prefix ourselves).
      const cleanMsg = message.replace(/^error:\s*/, '');
      const diagnostics: CLIDiagnostic[] = [{ code: CLI_UNKNOWN_COMMAND, message: cleanMsg }];
      const result: CLIResult = {
        command: commandName,
        exitCode: 2,
        diagnostics,
      };
      if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else process.stderr.write(`Error: ${cleanMsg}\n`);
      process.exitCode = ExitCode.InputError;
      return 2;
    }
    await fail(error, commandName, json);
    return typeof process.exitCode === 'number' ? process.exitCode : ExitCode.Error;
  }
}

/** Determine the invoked subcommand from argv (used for CLIResult.command).
 *  Unknown command or a bare invocation (no subcommand parsed) → '' (T151/T164).
 *  Flag values that happen to equal a command name (e.g. `-p check`) are NOT
 *  mistaken for the command — value-taking flags (--project-dir/-p, --target)
 *  and their value token are skipped, as are nullary flags (--json/--no-color
 *  etc.). Only a real positional subcommand token counts. */
function detectCommand(argv: readonly string[]): string {
  const commands = ['build', 'materialize', 'check', 'plan', 'apply', 'destroy'];
  const valueFlags = new Set(['-p', '--project-dir', '--target']);
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === undefined) continue;
    // `--flag=value` form: flag + value embedded in one token.
    if (token.startsWith('--') && token.includes('=')) {
      continue;
    }
    // A value-taking flag consumes the next token as its argument.
    if (valueFlags.has(token)) {
      i += 1;
      continue;
    }
    // A nullary flag (e.g. --json).
    if (token.startsWith('-')) {
      continue;
    }
    // First positional token: a valid subcommand counts; anything else is an
    // unknown command → no subcommand parsed (command "").
    return commands.includes(token) ? token : '';
  }
  return '';
}

const mainUrl = pathToFileURL(process.argv[1] ?? '').href;
if (import.meta.url === mainUrl) {
  void main();
}