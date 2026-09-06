import {
  PML_DEPENDS_CYCLE,
  PML_DEPENDS_SELF,
  PML_DEPENDS_UNKNOWN,
  type App,
  type DependsOnGraph,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';

import { diag } from './errors.js';

/**
 * DependsOnGraph construction + validation (US-2, FR-005..007, research
 * decision 3): iterative DFS white/gray/black over `depends_on`. Cycles
 * (with the involved chain), self-references and dangling references are all
 * collected in ONE pass (collect-all, SC-002).
 */
export type DependsOnResult =
  | { kind: 'ok'; graph: DependsOnGraph }
  | { kind: 'invalid'; graph: DependsOnGraph; errors: readonly ProjectModelDiagnostic[] };

const APPS_FILE = '.ycsf/apps.yaml';

type Color = 'white' | 'gray' | 'black';

interface Frame {
  node: string;
  deps: readonly string[];
  idx: number;
}

export function buildDependsOnGraph(apps: readonly App[]): DependsOnResult {
  const appIds = new Set(apps.map((app) => app.app_id));
  const adjacency = new Map<string, string[]>();
  const errors: ProjectModelDiagnostic[] = [];

  for (const app of apps) {
    const deps: string[] = [];
    adjacency.set(app.app_id, deps);
    for (const target of app.depends_on) {
      if (target === app.app_id) {
        errors.push(
          diag({
            code: PML_DEPENDS_SELF,
            message: `self-reference in depends_on for app '${app.app_id}'`,
            file: APPS_FILE,
            app: app.app_id,
            field: 'depends_on',
          }),
        );
        continue;
      }
      if (!appIds.has(target)) {
        errors.push(
          diag({
            code: PML_DEPENDS_UNKNOWN,
            message: `depends_on references unknown app '${target}'`,
            file: APPS_FILE,
            app: app.app_id,
            field: 'depends_on',
          }),
        );
        continue;
      }
      deps.push(target);
    }
  }

  const colors = new Map<string, Color>();
  const path: string[] = [];
  const post: string[] = [];
  const seenCycles = new Set<string>();

  for (const app of apps) {
    if (colors.get(app.app_id) !== undefined) continue;

    colors.set(app.app_id, 'gray');
    path.push(app.app_id);
    const stack: Frame[] = [
      { node: app.app_id, deps: adjacency.get(app.app_id) ?? [], idx: 0 },
    ];

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;
      const target = top.deps[top.idx];

      if (target === undefined) {
        post.push(top.node);
        colors.set(top.node, 'black');
        stack.pop();
        path.pop();
        continue;
      }

      top.idx += 1;
      const color = colors.get(target);
      if (color === 'black') continue;
      if (color === 'gray') {
        const start = path.indexOf(target);
        const chain = path.slice(start).concat(target);
        const cycleKey = [...new Set(chain)].sort().join('\u0000');
        if (!seenCycles.has(cycleKey)) {
          seenCycles.add(cycleKey);
          errors.push(
            diag({
              code: PML_DEPENDS_CYCLE,
              message: `depends_on cycle detected: ${chain.join(' → ')}`,
              file: APPS_FILE,
              app: top.node,
              field: 'depends_on',
            }),
          );
        }
        continue;
      }

      colors.set(target, 'gray');
      path.push(target);
      stack.push({ node: target, deps: adjacency.get(target) ?? [], idx: 0 });
    }
  }

  const hasErrors = errors.length > 0;
  const graph: DependsOnGraph = {
    adjacency,
    topologicalOrder: hasErrors ? [] : post,
  };
  return hasErrors ? { kind: 'invalid', graph, errors } : { kind: 'ok', graph };
}