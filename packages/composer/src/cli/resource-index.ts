import { loadResourceIndex } from '../resource/resource-index.js';
import { loadEnvMapping } from '../resource/env-mapping.js';
import type { ResourceIndex, EnvMapping } from '../resource/types.js';
import { IOError, CLIError } from './errors.js';

export async function buildResourceIndex(
  projectRoot: string,
): Promise<{ index: ResourceIndex; envMapping: EnvMapping }> {
  try {
    const index = await loadResourceIndex(projectRoot);
    const envMapping = await loadEnvMapping(projectRoot, index);
    return { index, envMapping };
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    throw new IOError(
      `Failed to build resource index: ${error instanceof Error ? error.message : String(error)}`,
      'RESOURCE_INDEX_BUILD_ERROR',
    );
  }
}