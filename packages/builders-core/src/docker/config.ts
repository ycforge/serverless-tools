/**
 * App-level build_config parsing for builder `docker` (spec 011,
 * contracts/builders-core.json #/definitions/dockerBuildConfig).
 * `image.repository` is required (FR-004); tag defaults to `latest`,
 * dockerfile to `Dockerfile`. Credentials are never part of the config
 * (FR-012). Violations throw `BLC_INVALID_CONFIG`.
 */

import { requireString } from '../config.js';
import { BLC_INVALID_CONFIG, builderError } from '../diagnostics.js';

export interface ParsedDockerConfig {
  readonly repository: string;
  readonly tag: string;
  readonly dockerfile: string;
}

function invalid(field: string): never {
  throw builderError(
    BLC_INVALID_CONFIG,
    `build_config: ${field} has invalid value (${BLC_INVALID_CONFIG})`,
    { field },
  );
}

export function parseDockerConfig(raw: unknown): ParsedDockerConfig {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const image = record.image;
  if (image === null || typeof image !== 'object' || Array.isArray(image)) {
    invalid('image');
  }
  const imageRecord = image as Record<string, unknown>;

  const repository = imageRecord.repository;
  if (!requireString(repository)) invalid('repository');

  const tag = imageRecord.tag === undefined ? 'latest' : imageRecord.tag;
  if (!requireString(tag) || /\s/.test(tag)) invalid('tag');

  const dockerfile = record.dockerfile === undefined ? 'Dockerfile' : record.dockerfile;
  if (!requireString(dockerfile)) invalid('dockerfile');

  return { repository, tag, dockerfile };
}