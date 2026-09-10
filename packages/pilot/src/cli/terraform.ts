// spec 021 ycsf-cli — terraform spawn wrapper (D-RE-2, D-RE-3, D-RE-4).
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { RuntimeError, CLI_TERRAFORM_NOT_FOUND, CLI_TERRAFORM_FAILED } from './errors.js';

export function findTerraform(): string {
  const probe =
    process.platform === 'win32'
      ? spawnSync('where', ['terraform'], { encoding: 'utf8', shell: true })
      : spawnSync('which', ['terraform'], { encoding: 'utf8' });
  if (probe.status === 0) {
    const path = probe.stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (path.length > 0) return path;
  }
  throw new RuntimeError(
    'terraform binary not found in PATH (CLI_TERRAFORM_NOT_FOUND)',
    CLI_TERRAFORM_NOT_FOUND,
  );
}

export interface TerraformResult {
  readonly exitCode: number;
  readonly stdout: string;
}

const TF_ARGS: Record<string, readonly string[]> = {
  init: ['-no-color'],
  plan: ['-no-color'],
  apply: ['-auto-approve', '-no-color'],
  destroy: ['-auto-approve', '-no-color'],
  'destroy-no-auto': ['-no-color'],
};

export async function spawnTerraform(
  command: 'init' | 'plan' | 'apply' | 'destroy',
  rootDir: string,
  opts?: { autoApprove?: boolean },
): Promise<TerraformResult> {
  const terraformBin = findTerraform();
  const infraDir = join(rootDir, 'infra');

  let args: readonly string[];
  if (command === 'destroy') {
    args = opts?.autoApprove === true ? (TF_ARGS.destroy ?? []) : (TF_ARGS['destroy-no-auto'] ?? []);
  } else if (command === 'apply') {
    args = TF_ARGS.apply ?? [];
  } else {
    args = TF_ARGS[command] ?? [];
  }

  return new Promise<TerraformResult>((resolve, reject) => {
    const child = spawn(terraformBin, [command, ...args], {
      cwd: infraDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let interrupted = false;
    let backstop: NodeJS.Timeout | undefined;

    child.stdout?.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      process.stderr.write(s);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    // D-RE-4: on SIGINT → SIGTERM the child, force SIGKILL after 2s, then
    // exit 130. Any interrupt path (graceful child close before the backstop
    // OR the SIGKILL backstop) MUST end in exit 130, never a CLI_TERRAFORM_FAILED
    // exit 1 (spec Edge case SIGINT, T153).
    const onSigint = (): void => {
      if (interrupted) return;
      interrupted = true;
      child.kill('SIGTERM');
      backstop = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
        process.exit(130);
      }, 2000);
      backstop.unref();
    };

    process.on('SIGINT', onSigint);

    child.on('error', (err: NodeJS.ErrnoException) => {
      process.removeListener('SIGINT', onSigint);
      if (err.code === 'ENOENT') {
        reject(
          new RuntimeError(
            'terraform binary not found in PATH (CLI_TERRAFORM_NOT_FOUND)',
            CLI_TERRAFORM_NOT_FOUND,
          ),
        );
      } else {
        reject(
          new RuntimeError(
            `terraform ${command} failed: ${err.message} (CLI_TERRAFORM_FAILED)`,
            CLI_TERRAFORM_FAILED,
          ),
        );
      }
    });

    child.on('close', (code: number | null) => {
      process.removeListener('SIGINT', onSigint);
      if (interrupted) {
        if (backstop) clearTimeout(backstop);
        process.exit(130);
        return;
      }
      if (code === 0) {
        resolve({ exitCode: 0, stdout });
      } else {
        reject(
          new RuntimeError(
            `terraform ${command} exited with code ${code} (CLI_TERRAFORM_FAILED)`,
            CLI_TERRAFORM_FAILED,
          ),
        );
      }
    });
  });
}
