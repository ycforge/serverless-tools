import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export async function sha256Hex(filePath: string, baseDir: string = process.cwd()): Promise<string> {
  const resolved = isAbsolute(filePath) ? filePath : resolve(baseDir, filePath);
  const bytes = await readFile(resolved);
  return createHash('sha256').update(bytes).digest('hex');
}
