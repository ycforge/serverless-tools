// spec 021 ycsf-cli — readline confirmation prompt for destroy (D-RE-5).
import * as readline from 'node:readline';
import { DestroyRequiresYesError } from './errors.js';

export async function confirmDestroy(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new DestroyRequiresYesError();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('Are you sure you want to destroy infrastructure? (y/N): ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
