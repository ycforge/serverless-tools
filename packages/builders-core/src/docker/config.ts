/**
 * App-level build_config parsing for builder `docker` (spec 011,
 * contracts/builders-core.json #/definitions/dockerBuildConfig).
 * `image.repository` is required in the default and `remote` modes (FR-004);
 * tag defaults to `latest`, dockerfile to `Dockerfile`. Credentials are never
 * part of the config (FR-012).
 *
 * spec 028 dev-modes (D-3 validation matrix):
 *  - `mode: 'registry-ref'` → `image.ref` required and strict immutability
 *    (`/^[^@]+@sha256:[0-9a-f]{64}$/` + no `<repo>:<tag>@` form); repository /
 *    tag / dockerfile are mutually exclusive with registry-ref.
 *  - `mode: 'remote'` → `image.host` required, repository required.
 *  - mode absent → local-daemon build+push (spec 027 behavior preserved).
 * Violations throw `BLC_INVALID_CONFIG`.
 */

import { requireString } from '../config.js';
import { BLC_INVALID_CONFIG, builderError } from '../diagnostics.js';

export interface ParsedDockerConfig {
  /** Present in default/remote modes; absent for registry-ref (ref embeds it). */
  readonly repository?: string;
  readonly tag?: string;
  readonly dockerfile?: string;
  readonly noPush: boolean;
  readonly mode: 'registry-ref' | 'remote' | undefined;
  /** registry-ref only: the immutable digest ref, emitted verbatim. */
  readonly ref?: string;
  /** remote only: the DOCKER_HOST endpoint. */
  readonly host?: string;
}

/** Strict immutable digest form <repository>@sha256:<hex64>. */
export const DOCKER_REF_PATTERN = /^[^@]+@sha256:[0-9a-f]{64}$/;
/** Mutable-tag leak inside the ref: `<repo>:<tag>@sha256:…`. */
const MUTABLE_TAG_IN_REF = /:[^/@]*@/;

function invalid(field: string): never {
  throw builderError(
    BLC_INVALID_CONFIG,
    `build_config: ${field} has invalid value (${BLC_INVALID_CONFIG})`,
    { field },
  );
}

export function parseDockerConfig(raw: unknown): ParsedDockerConfig {
  const record =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const image = record.image;
  if (image === null || typeof image !== 'object' || Array.isArray(image)) {
    invalid('image');
  }
  const imageRecord = image as Record<string, unknown>;

  const rawNoPush = imageRecord.no_push;
  const noPush = rawNoPush === undefined ? false : rawNoPush;
  if (typeof noPush !== 'boolean') invalid('image.no_push');

  const rawMode = imageRecord.mode;
  let mode: 'registry-ref' | 'remote' | undefined;
  if (rawMode !== undefined) {
    if (rawMode !== 'registry-ref' && rawMode !== 'remote') invalid('image.mode');
    mode = rawMode;
  }

  if (mode === 'registry-ref') {
    const ref = imageRecord.ref;
    if (typeof ref !== 'string' || !DOCKER_REF_PATTERN.test(ref) || MUTABLE_TAG_IN_REF.test(ref)) {
      invalid('image.ref');
    }
    // Mutual exclusion (D-3): repository/tag/dockerfile together with
    // registry-ref would imply a build we must not run.
    if (imageRecord.repository !== undefined || imageRecord.tag !== undefined || record.dockerfile !== undefined) {
      invalid('image.ref');
    }
    return { noPush, mode, ref: ref as string };
  }

  let host: string | undefined;
  if (mode === 'remote') {
    const rawHost = imageRecord.host;
    if (!requireString(rawHost)) invalid('image.host');
    host = rawHost as string;
  }

  const repository = imageRecord.repository;
  if (!requireString(repository)) invalid('repository');

  const tag = imageRecord.tag === undefined ? 'latest' : imageRecord.tag;
  if (!requireString(tag) || /\s/.test(tag) || tag.startsWith('-')) invalid('tag');

  const dockerfile = record.dockerfile === undefined ? 'Dockerfile' : record.dockerfile;
  if (!requireString(dockerfile)) invalid('dockerfile');

  return {
    repository: repository as string,
    tag: tag as string,
    dockerfile: dockerfile as string,
    noPush,
    mode,
    ...(host !== undefined ? { host } : {}),
  };
}