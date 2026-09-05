export type OverrideRuleOp = 'replace' | 'add' | 'remove';

export type OverrideTargetKind = 'info' | 'path' | 'operation' | 'operationId' | 'component';

export interface OverrideTarget {
  kind: OverrideTargetKind;
  path?: string;
  method?: string;
  operationId?: string;
  name?: string;
}

export interface OverrideRule {
  op: OverrideRuleOp;
  target: OverrideTarget;
  value?: unknown;
  ruleIndex: number;
}

export interface OverrideFile {
  version: 1;
  rules: readonly OverrideRule[];
  sourcePath: string;
}