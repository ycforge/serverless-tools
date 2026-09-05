import { basename, resolve } from 'node:path';

import { extractOpenApi } from '../extract.js';
import type { OpenApiDocument } from '../errors.js';
import { validateAuthConfig, validateAuthReferences } from '../auth/auth-config.js';
import type { AuthValidationResult } from '../auth/types.js';
import { ComposeError } from './compose-errors.js';
import type { ComposeRequest, ComposeResult, MergeParticipant } from './types.js';

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
): Promise<AuthValidationResult> {
  const first = participants[0];
  if (first === undefined) {
    throw new ComposeError('COMPOSE_NO_PARTICIPANTS', {});
  }
  const validated = await validateAuthConfig({
    appRoot: compositionRoot,
    openApi: first.doc,
    functions,
  });
  for (let index = 1; index < participants.length; index += 1) {
    const participant = participants[index];
    if (participant !== undefined) {
      validateAuthReferences(participant.doc, validated.authYaml);
    }
  }
  return validated;
}

export async function compose(request: ComposeRequest): Promise<ComposeResult> {
  if (request.apps.length === 0) {
    throw new ComposeError('COMPOSE_NO_PARTICIPANTS', {});
  }

  const participants = await extractParticipants(request.apps);
  await validateCompositionAuth(request.compositionRoot, participants, request.functions);

  throw new ComposeError('COMPOSE_NO_PARTICIPANTS', {
    app: 'compilation pipeline stages (VERSION/MERGE/AUTH-APPLY/OVERRIDES/FINALIZE) not wired yet',
  });
}