// spec 020 ycsf-check — load generated Terraform resources from .ycsf/*.ycsf.tf.json files.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GeneratedResource {
  readonly kind: 'resource';
  readonly type: string;
  readonly name: string;
  readonly configuration: Record<string, unknown>;
}

/** Matches generated .ycsf.tf.json filenames. */
const FILENAME_RE = /^.+\.ycsf\.tf\.json$/;

export function loadGeneratedModel(rootDir: string, generatedDir?: string): readonly GeneratedResource[] {
  const dir = generatedDir ?? join(rootDir, '.ycsf');

  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const generated: GeneratedResource[] = [];

  for (const file of files) {
    if (!FILENAME_RE.test(file)) continue;

    let content: Record<string, unknown>;
    try {
      content = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }

    const resourceBlock = content.resource;
    if (typeof resourceBlock !== 'object' || resourceBlock === null) continue;

    for (const [tfType, resources] of Object.entries(resourceBlock)) {
      if (typeof resources !== 'object' || resources === null) continue;

      for (const [name, configuration] of Object.entries(resources as Record<string, unknown>)) {
        if (typeof configuration !== 'object' || configuration === null) continue;
        generated.push({
          kind: 'resource',
          type: tfType,
          name,
          configuration: configuration as Record<string, unknown>,
        });
      }
    }
  }

  return generated;
}
