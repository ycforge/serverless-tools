export interface CompileOptions {
  projectDir: string;
  output?: string;
  app?: string;
  envOnly?: boolean;
  json?: boolean;
}

export interface CheckOptions {
  projectDir: string;
  app?: string;
  envOnly?: boolean;
  json?: boolean;
}

export interface CheckResult {
  check: CheckName;
  passed: boolean;
  details?: string;
  errors?: CheckError[];
}

export type CheckName =
  | 'openapi-sources-exist'
  | 'auth-schemes-valid'
  | 'no-path-operationid-conflicts'
  | 'resource-refs-resolvable'
  | 'overrides-targets-exist';

export interface CheckError {
  code: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  apps?: string[];
  routes?: RouteRef[];
}

export interface RouteRef {
  path: string;
  method: string;
  operationId?: string;
}

export interface CheckSummary {
  projectDir: string;
  timestamp: string;
  results: CheckResult[];
  summary: CheckSummaryCounts;
  exitCode: 0 | 1 | 2;
}

export interface CheckSummaryCounts {
  passed: number;
  failed: number;
  total: number;
}

export interface GatewayApp {
  id: string;
  name: string;
  builder: 'yandex-api-gateway';
  path: string;
  openapiEntry: string;
  authPath: string;
  overridesPath: string;
}

export interface Provenance {
  sourceApp: string;
  sourceFile: string;
}