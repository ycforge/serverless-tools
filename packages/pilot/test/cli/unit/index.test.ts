import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../../src/cli/check.js', () => ({
  checkAction: vi.fn(),
  checkCommand: 'check',
}));

import { main } from '../../../src/cli/index.js';
import { checkAction } from '../../../src/cli/check.js';
import { CLI_UNKNOWN_COMMAND, CLI_UNEXPECTED_ERROR, ExitCode } from '../../../src/cli/errors.js';

const mockCheckAction = vi.mocked(checkAction);

function lastCheckCommand(): Command {
  const cmd = mockCheckAction.mock.calls.at(-1)?.[0] as Command | undefined;
  if (!cmd) throw new Error('checkAction was never dispatched');
  return cmd;
}

describe('ycsf CLI entry point (T015)', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    delete process.env.NO_COLOR;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  it('unknown command → exit 2, CLI_UNKNOWN_COMMAND diagnostic (--json)', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main(['node', 'ycsf', '--json', 'frobnicate']);
    expect(code).toBe(ExitCode.InputError);
    expect(process.exitCode).toBe(ExitCode.InputError);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.exitCode).toBe(2);
    expect(json.command).toBe('');
    expect(json.diagnostics[0]?.code).toBe(CLI_UNKNOWN_COMMAND);
    expect(typeof json.diagnostics[0]?.message).toBe('string');
    spy.mockRestore();
  });

  // NOTE: must be the FIRST project-dir parse in the file — the commander
  // singleton retains the last-parsed option value in-process (known re-parse
  // behavior), so the cwd default only holds when no value was set yet.
  it('omitted --project-dir defaults to the current directory', async () => {
    const code = await main(['node', 'ycsf', 'check']);
    expect(code).toBe(ExitCode.Success);
    expect(lastCheckCommand().optsWithGlobals().projectDir).toBe(process.cwd());
  });

  it('--project-dir value is resolved and forwarded to the subcommand action', async () => {
    const code = await main(['node', 'ycsf', 'check', '--project-dir', '/abs/project/root']);
    expect(code).toBe(ExitCode.Success);
    expect(lastCheckCommand().optsWithGlobals().projectDir).toBe('/abs/project/root');
  });

  it('--json flag is exposed on the subcommand options', async () => {
    const code = await main(['node', 'ycsf', 'check', '--json']);
    expect(code).toBe(ExitCode.Success);
    expect(lastCheckCommand().optsWithGlobals().json).toBe(true);
  });

  it('unhandled action error → exit 1, CLI_UNEXPECTED_ERROR diagnostic (FR-003)', async () => {
    const parseSpy = vi
      .spyOn(Command.prototype, 'parseAsync')
      .mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await main(['node', 'ycsf', '--json', 'build']);
    expect(code).toBe(ExitCode.Error);
    expect(process.exitCode).toBe(ExitCode.Error);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.exitCode).toBe(1);
    expect(json.diagnostics[0]?.code).toBe(CLI_UNEXPECTED_ERROR);
    parseSpy.mockRestore();
    spy.mockRestore();
  });

  it('--no-color sets NO_COLOR environment variable (FR-006)', async () => {
    await main(['node', 'ycsf', '--no-color', 'check', '--project-dir', '/abs/project/root']);
    expect(process.env.NO_COLOR).toBe('1');
  });
});