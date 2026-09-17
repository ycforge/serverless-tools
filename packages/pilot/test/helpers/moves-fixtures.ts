// spec 017 — shared test fixtures (T003).
import type { MoveEndpoint, MoveEntry, MovesYaml } from '../../src/contracts/index.js';
import type { TempProject } from './temp-project.js';

export function endpoint(idl: string, idt: string): MoveEndpoint {
  return { idl, idt };
}

export function entry(from: MoveEndpoint, to: MoveEndpoint): MoveEntry {
  return { from, to };
}

export function currentResources(
  ...values: readonly [idl: string, idt: string][]
): readonly MoveEndpoint[] {
  return values.map(([idl, idt]) => endpoint(idl, idt));
}

export function canonicalCurrentResources(): readonly MoveEndpoint[] {
  return currentResources(
    ['functions.user_service', 'yandex_function.user_service'],
    ['functions.analytics', 'yandex_function.analytics'],
    ['gateways.openapi', 'yandex_api_gateway.openapi'],
    ['containers.frontend', 'yandex_container.frontend'],
  );
}

export function movesYaml(movesBlock: string): string {
  return `version: 1\nmoves:\n${movesBlock}`;
}

export function canonicalMovesYaml(): string {
  return movesYaml(
    '  - from:\n' +
      '      idl: functions.users\n' +
      '      idt: yandex_function.users\n' +
      '    to:\n' +
      '      idl: functions.users\n' +
      '      idt: yandex_function.user_api\n',
  );
}

export function movesFrom(entries: readonly MoveEntry[]): MovesYaml {
  return { version: 1, moves: entries };
}

export function writeMovedYaml(project: TempProject, yamlText: string): void {
  project.write('.ycsf/moved.yaml', yamlText);
}