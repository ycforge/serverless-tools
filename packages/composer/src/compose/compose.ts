import { basename, resolve } from 'node:path';

import { extractOpenApi } from '../extract.js';
import type { OpenApiDocument } from '../errors.js';
import { validateAuthConfig, validateAuthReferences } from '../auth/auth-config.js';
import { ComposeError } from './compose-errors.js';
import { mergeDocuments } from './merge.js';
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
): Promise<void> {
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
  await validateCompositionAuth(request.compositionRoot, participants, request.functions);

  const merged = mergeDocuments(participants);

  const document: GatewayDocument = {
    openapi: merged.openapi,
    paths: merged.paths,
  };
  if (Object.keys(merged.components).length > 0) {
    document.components = merged.components;
  }

  const provenance: ReadonlyMap<string, RouteOwner> = merged.ownership.ownerByPath;
  return { document, provenance };
}