export { compose, appIdOf } from './compose.js';
export { ComposeError, COMPOSE_ERROR_CODES } from './compose-errors.js';
export type { ComposeErrorCode, ComposeErrorContext } from './compose-errors.js';
export { mergeDocuments, sortRecordKeys, type MergeResult } from './merge.js';
export { PathOwnership, walkJsonKeys, type OperationIdRef } from './provenance.js';
export { loadOverrideFile, parseOverrideFile } from './overrides/override-yaml.js';
export { applyOverrides } from './overrides/apply.js';
export type {
  OverrideFile,
  OverrideRule,
  OverrideRuleOp,
  OverrideTarget,
  OverrideTargetKind,
} from './overrides/override-types.js';
export type {
  ComposeApp,
  ComposeRequest,
  ComposeResult,
  GatewayDocument,
  MergeParticipant,
  RouteOwner,
} from './types.js';