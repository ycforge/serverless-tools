import { createTempProject, removeTempProject, type TempProject } from '../../helpers/temp-project.js';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
const BUILDER_E2E = fileURLToPath(new URL('../fixtures/builder-e2e.mjs', import.meta.url));
const MATERIALIZER_NEST = fileURLToPath(new URL('../../materialize/fixtures/materializer-nest.mjs', import.meta.url));

export const MOCK_TERRAFORM_DIR = FIXTURES_DIR;

/** env with the hermetic mock terraform first in PATH (spec 021). */
export function envWithMockTerraform(env: Record<string, string> = process.env as Record<string, string>): Record<string, string> {
  return { ...env, PATH: `${MOCK_TERRAFORM_DIR}:${env.PATH}` };
}

export const APPS_YAML = `version: 1
apps:
  user_service: { source_path: src/user_service, builder: nestjs-function }
  analytics: { source_path: src/analytics, builder: nestjs-function }
`;

export function createBuildableProject(): TempProject {
  const project = createTempProject({
    '.ycsf/apps.yaml': APPS_YAML,
    'src/user_service/index.js': 'export const handler = () => "user_service";',
    'src/analytics/index.js': 'export const handler = () => "analytics";',
    'infra/main.tf': '# managed by ycsf\n',
  });
  project.write(
    '.ycsf/builders.yaml',
    `version: 1
builders:
  nestjs-function: "${BUILDER_E2E}"
materializers:
  nest: "${MATERIALIZER_NEST}"
`,
  );
  return project;
}

export { removeTempProject };
export type { TempProject };