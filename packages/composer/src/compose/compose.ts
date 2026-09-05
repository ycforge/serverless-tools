import { basename, resolve } from 'node:path';

import { extractOpenApi } from '../extract.js';
import type { OpenApiDocument } from '../errors.js';
import type { AuthYamlDocument } from '../auth/types.js';
import { validateAuthConfig, validateAuthReferences } from '../auth/auth-config.js';
import { applyAuth } from './auth-apply.js';
import { ComposeError } from './compose-errors.js';
import { mergeDocuments, sortRecordKeys } from './merge.js';
import { applyOverrides } from './overrides/apply.js';
import { loadOverrideFile } from './overrides/override-yaml.js';
import type {
  ComposeRequest,
  ComposeResult,
  GatewayDocument,
  MergeParticipant,
  RouteOwner,
} from './types.js';

export function appIdOf(appRoot: string): string {
  return basename(resolve(appRoot));
}

async function extractParticipants(apps: readonly { appRoot: string }[]): Promise<MergeParticipant[]> {
  const participants: MergeParticipant[] = [];
  for (const app of apps) {
    const doc: OpenApiDocument = await extractOpenApi({ appRoot: app.appRoot });
    participants.push({ appId: appIdOf(app.appRoot), doc });
  }
  return participants;
}

async function validateCompositionAuth(
  compositionRoot: string,
  participants: readonly MergeParticipant[],
  functions?: readonly string[],
): Promise<AuthYamlDocument> {
  const first = participants[0];
  if (first === undefined) {
    throw new ComposeError('COMPOSE_NO_PARTICIPANTS', {});
  }
  const validated = await validateAuthConfig({
    appRoot: compositionRoot,
    openApi: first.doc,
    functions,
  });
  const authYaml = validated.authYaml;
  for (let index = 1; index < participants.length; index += 1) {
    const participant = participants[index];
    if (participant !== undefined) {
      validateAuthReferences(participant.doc, authYaml);
    }
  }
  return authYaml;
}

export async function compose(request: ComposeRequest): Promise<ComposeResult> {
  if (request.apps.length === 0) {
    throw new ComposeError('COMPOSE_NO_PARTICIPANTS', {});
  }

  const seenAppIds = new Set<string>();
  for (const app of request.apps) {
    const appId = appIdOf(app.appRoot);
    if (seenAppIds.has(appId)) {
      throw new ComposeError('COMPOSE_NO_PARTICIPANTS', { app: app.appRoot });
    }
    seenAppIds.add(appId);
  }

  const participants = await extractParticipants(request.apps);
  const authYaml = await validateCompositionAuth(
    request.compositionRoot,
    participants,
    request.functions,
  );

  const merged = mergeDocuments(participants);

  const document: GatewayDocument = {
    openapi: merged.openapi,
    paths: merged.paths,
  };
  if (Object.keys(merged.components).length > 0) {
    document.components = merged.components;
  }

  applyAuth(document, authYaml);

  const globalOverrides = await loadOverrideFile(request.compositionRoot);
  const localOverrideRoots: string[] = request.apps.map((app) => app.appRoot);
  const localOverrides = [];
  for (const appRoot of localOverrideRoots) {
    localOverrides.push({
      appId: appIdOf(appRoot),
      file: await loadOverrideFile(appRoot),
    });
  }

  applyOverrides(document, merged.ownership, globalOverrides, localOverrides);

  document.paths = sortRecordKeys(document.paths);

  if (!isRecord(document.info)) {
    throw new ComposeError('COMPOSE_INFO_MISSING', {});
  }

  const provenance: ReadonlyMap<string, RouteOwner> = merged.ownership.ownerByPath;
  return { document, provenance };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}