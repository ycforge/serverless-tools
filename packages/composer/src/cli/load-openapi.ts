import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseDocument, isMap, isAlias, type YAMLParseError } from 'yaml';

import { extractOpenApi } from '../extract.js';
import { isOpenApiDocument } from '../artifacts.js';
import type { OpenApiDocument } from '../errors.js';
import type { GatewayApp } from './types.js';
import { InputError, IOError, CLIError } from './errors.js';

export interface BuildConfig {
  openapi_entry?: string;
}

export async function loadBuildConfig(appPath: string): Promise<BuildConfig> {
  const buildConfigPath = join(appPath, 'build_config.yaml');
  try {
    const text = await readFile(buildConfigPath, 'utf8');
    const doc = parseDocument(text, { uniqueKeys: true });
    const firstError = doc.errors[0] as YAMLParseError | undefined;
    if (firstError) {
      throw new IOError(`Failed to parse build_config.yaml: ${firstError.message}`, 'BUILD_CONFIG_PARSE_ERROR');
    }
    if (!isMap(doc.contents) || isAlias(doc.contents)) {
      throw new IOError('build_config.yaml: document is not a mapping', 'BUILD_CONFIG_INVALID_FORMAT');
    }
    const config = doc.toJS() as BuildConfig;
    if (config.openapi_entry !== undefined && typeof config.openapi_entry !== 'string') {
      throw new InputError(
        'build_config.yaml: "openapi_entry" must be a string',
        'BUILD_CONFIG_MISSING_ENTRY',
      );
    }
    return config;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new IOError(`build_config.yaml not found: ${buildConfigPath}`, 'BUILD_CONFIG_NOT_FOUND');
    }
    throw new IOError(`Failed to read build_config.yaml: ${error instanceof Error ? error.message : String(error)}`, 'BUILD_CONFIG_READ_ERROR');
  }
}

async function loadOpenApiArtifactFile(
  appRoot: string,
  openapiEntry: string,
): Promise<OpenApiDocument | null> {
  const extension = openapiEntry.split('.').pop()?.toLowerCase();
  if (extension !== 'json' && extension !== 'yaml' && extension !== 'yml') {
    return null;
  }
  const filePath = resolve(appRoot, openapiEntry);
  try {
    const text = await readFile(filePath, 'utf8');
    const parsed = extension === 'json' ? JSON.parse(text) : parseDocument(text).toJS();
    if (!isOpenApiDocument(parsed)) {
      throw new IOError(
        `openapi_entry ${openapiEntry} is not an OpenAPI document`,
        'OPENAPI_ENTRY_INVALID',
      );
    }
    return parsed as OpenApiDocument;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new IOError(
      `Failed to read openapi_entry ${openapiEntry}: ${error instanceof Error ? error.message : String(error)}`,
      'OPENAPI_ENTRY_READ_ERROR',
    );
  }
}

export async function loadOpenApiSource(
  app: GatewayApp,
  projectRoot: string,
  envOnly: boolean,
): Promise<OpenApiDocument> {
  const appPath = resolve(projectRoot, app.path);

  if (envOnly) {
    return {
      openapi: '3.1.0',
      info: { title: app.name, version: '0.0.0' },
      paths: {},
    } as OpenApiDocument;
  }

  const buildConfig = await loadBuildConfig(appPath);
  const openapiEntry = buildConfig.openapi_entry;

  if (openapiEntry !== undefined) {
    const artifactDoc = await loadOpenApiArtifactFile(appPath, openapiEntry);
    if (artifactDoc !== null) {
      app.openapiEntry = openapiEntry;
      return artifactDoc;
    }
    try {
      const doc = await extractOpenApi({ appRoot: appPath, openapiEntry });
      app.openapiEntry = openapiEntry;
      return doc;
    } catch (error) {
      if (error instanceof CLIError) {
        throw error;
      }
      throw new IOError(
        `Failed to load OpenAPI from ${resolve(appPath, openapiEntry)}: ${error instanceof Error ? error.message : String(error)}`,
        'OPENAPI_LOAD_ERROR',
      );
    }
  }

  const doc = await extractOpenApi({ appRoot: appPath });
  return doc;
}