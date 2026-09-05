import type { OpenApiDocument } from '../errors.js';

export interface ComposeApp {
  appRoot: string;
}

export interface ComposeRequest {
  compositionRoot: string;
  apps: readonly ComposeApp[];
  functions?: readonly string[];
}

export type RouteOwner = string;

export interface ComposeResult {
  document: GatewayDocument;
  provenance: ReadonlyMap<string, RouteOwner>;
}

export interface GatewayDocument {
  openapi: string;
  info: Record<string, unknown>;
  security?: Array<Record<string, readonly unknown[]>>;
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MergeParticipant {
  appId: string;
  doc: OpenApiDocument;
}