import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { run, runOrThrow } from './exec.js';
import { requireHarnessEnv, type HarnessEnv } from './env.js';
import { E2E_ROOT, PILOT_CLI, TMP_ROOT, type E2eState } from './state.js';
import {
  createJwtMaterial,
  jwksDocument,
  openIdConfigurationDocument,
  type JwtMaterial,
} from './jwt.js';
import { terraformOutputs, outputValue } from './cloud.js';

const COPY_EXCLUDE =
  /(^|\/)(node_modules|\.terraform|\.tmp|\.git|artifacts|cache|generated)(\/|$)|\.tfstate(\.|$)|\.ycsf\.tf\.json$/;

function shouldCopy(source: string): boolean {
  return !COPY_EXCLUDE.test(source);
}

function requireBuiltCli(): void {
  if (!existsSync(PILOT_CLI)) {
    throw new Error(
      `pilot CLI not built at ${PILOT_CLI}. Run 'pnpm build' at the repository root before the e2e suite.`,
    );
  }
}

function replaceInTree(root: string, replacements: ReadonlyArray<readonly [string, string]>): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      replaceInTree(path, replacements);
      continue;
    }
    if (!/\.ya?ml$/.test(entry.name)) {
      continue;
    }
    let content = readFileSync(path, 'utf8');
    let changed = false;
    for (const [search, value] of replacements) {
      if (content.includes(search)) {
        content = content.replaceAll(search, value);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(path, content, 'utf8');
    }
  }
}

interface Workspace {
  readonly tempRoot: string;
  readonly projectDir: string;
  readonly setupDir: string;
  readonly dockerConfigDir: string;
  readonly jwt: JwtMaterial;
  readonly issuer: string;
}

function prepareWorkspace(harness: HarnessEnv, jwt: JwtMaterial): Workspace {
  mkdirSync(TMP_ROOT, { recursive: true });
  const tempRoot = join(TMP_ROOT, `run-${harness.runId}`);
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  const projectDir = join(tempRoot, 'project');
  const setupDir = join(tempRoot, 'setup');
  cpSync(join(E2E_ROOT, 'project'), projectDir, { recursive: true, filter: shouldCopy });
  cpSync(join(E2E_ROOT, 'setup'), setupDir, { recursive: true, filter: shouldCopy });

  const issuer = `https://e2e-jwt-${harness.runId}.storage.yandexcloud.net`;
  const fixtures = join(setupDir, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, 'jwks.json'), jwksDocument(jwt), 'utf8');
  writeFileSync(join(fixtures, 'openid-configuration.json'), openIdConfigurationDocument(issuer), 'utf8');

  replaceInTree(projectDir, [['__SERVICE_ACCOUNT_ID__', harness.serviceAccountId]]);
  writeFileSync(
    join(projectDir, 'apps', 'e2e_openapi', 'auth.yaml'),
    `version: 1
defaultScheme: public
schemes:
  public:
    type: none
  user:
    type: jwt
    issuer: ${issuer}
    audience: e2e-api
    jwksUri: ${issuer}/.well-known/jwks.json
  internal:
    type: function
    function: functions.e2e_authorizer
    serviceAccount: ${harness.serviceAccountId}
`,
    'utf8',
  );

  return { tempRoot, projectDir, setupDir, dockerConfigDir: join(tempRoot, 'docker'), jwt, issuer };
}

export interface DeployResult {
  readonly state: E2eState;
  readonly buildEnv: NodeJS.ProcessEnv;
  readonly teardown: () => Promise<void>;
}

export async function deployE2e(): Promise<DeployResult> {
  requireBuiltCli();
  const harness = requireHarnessEnv();
  const jwt = await createJwtMaterial();
  const workspace = prepareWorkspace(harness, jwt);

  const buildEnv: NodeJS.ProcessEnv = {
    ...harness.terraform,
    YC_PROFILE: harness.ycProfile,
    E2E_RUN_ID: harness.runId,
    E2E_SERVICE_ACCOUNT_ID: harness.serviceAccountId,
    E2E_VITE_BIN: resolve(E2E_ROOT, 'node_modules', '.bin', 'vite'),
    VITE_NULL_RESOLVED: 'null-mode-value',
    DOCKER_CONFIG: workspace.dockerConfigDir,
    DOCKER_BUILDKIT: '1',
    DOCKER_DEFAULT_PLATFORM: 'linux/amd64',
  };

  const teardown = async (): Promise<void> => {
    if (process.env.E2E_KEEP === '1') {
      console.warn(`[e2e] E2E_KEEP=1 — leaving resources in place under ${workspace.tempRoot}`);
      return;
    }
    await run('node', [PILOT_CLI, '-p', workspace.projectDir, 'destroy', '-y'], {
      cwd: E2E_ROOT,
      env: buildEnv,
    });
    await run('terraform', ['destroy', '-auto-approve', '-input=false'], {
      cwd: workspace.setupDir,
      env: harness.terraform,
    });
    rmSync(workspace.tempRoot, { recursive: true, force: true });
  };

  try {
    await runOrThrow('terraform', ['init', '-input=false', '-no-color'], {
      cwd: workspace.setupDir,
      env: harness.terraform,
    });
    await runOrThrow('terraform', ['apply', '-auto-approve', '-input=false', '-no-color'], {
      cwd: workspace.setupDir,
      env: harness.terraform,
    });
    const setupOutputs = await terraformOutputs(workspace.setupDir, harness.terraform);
    const staticBucket = outputValue(setupOutputs, 'static_bucket');
    const jwtBucket = outputValue(setupOutputs, 'jwt_bucket');
    const issuer = outputValue(setupOutputs, 'jwt_issuer');
    const kmsKeyId = process.env.E2E_KMS_KEY_ID ?? outputValue(setupOutputs, 'kms_key_id');
    buildEnv.E2E_STATIC_BUCKET = staticBucket;

    await dockerLogin(harness, workspace.dockerConfigDir);
    await runPipeline(workspace.projectDir, buildEnv);

    const outputs = await terraformOutputs(join(workspace.projectDir, 'infra'), harness.terraform);
    const state: E2eState = {
      skipped: false,
      runId: harness.runId,
      tempRoot: workspace.tempRoot,
      projectDir: workspace.projectDir,
      setupDir: workspace.setupDir,
      staticBucket,
      jwtBucket,
      jwtIssuer: issuer,
      kmsKeyId,
      gatewayDomain: outputValue(outputs, 'e2e_gateway_domain'),
      containerUrl: outputValue(outputs, 'e2e_container_url'),
      workerEventsName: outputValue(outputs, 'e2e_worker_events_name'),
      workerDlqEventsName: outputValue(outputs, 'e2e_worker_dlq_events_name'),
      workerAppDlqName: outputValue(outputs, 'e2e_worker_app_dlq_name'),
      workerFunctionId: outputValue(outputs, 'e2e_worker_function_id'),
      workerDlqFunctionId: outputValue(outputs, 'e2e_worker_dlq_function_id'),
      apiFunctionId: outputValue(outputs, 'e2e_api_function_id'),
      authorizerFunctionId: outputValue(outputs, 'e2e_authorizer_function_id'),
      renameFunctionId: outputValue(outputs, 'e2e_rename_me_function_id'),
      outputs,
      privateKeyPem: jwt.privateKeyPem,
      jwk: jwt.jwk,
      startedAt: new Date().toISOString(),
    };

    return { state, buildEnv, teardown };
  } catch (error) {
    await teardown().catch(() => undefined);
    throw error;
  }
}

function copyGeneratedSnapshots(projectDir: string): void {
  const infraDir = join(projectDir, 'infra');
  const ycsfDir = join(projectDir, '.ycsf');
  for (const file of readdirSync(infraDir)) {
    if (file.endsWith('.ycsf.tf.json') || file === '99-ycsf-outputs.tf.json') {
      copyFileSync(join(infraDir, file), join(ycsfDir, file));
    }
  }
}

async function runPipeline(projectDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const infraDir = join(projectDir, 'infra');
  // source_path in apps.yaml is resolved from the process CWD by builders
  // (spec 030 open follow-up), so the CLI must run anchored at the project root.
  const pilot = (args: readonly string[]) =>
    runOrThrow('node', [PILOT_CLI, '-p', projectDir, ...args], { cwd: projectDir, env });

  await pilot(['build']);
  await pilot(['materialize']);
  // spec 029 (open follow-up): `ycsf check` still reads generated resources from
  // `.ycsf/*.ycsf.tf.json`, while materialize writes them to `infra/`. Mirror the
  // reference-project workaround so extensions/outputs targets resolve.
  copyGeneratedSnapshots(projectDir);
  await pilot(['check']);

  await runOrThrow('terraform', ['init', '-input=false', '-no-color'], { cwd: infraDir, env });
  await runOrThrow('terraform', ['validate', '-no-color'], { cwd: infraDir, env });
  await runOrThrow(
    'terraform',
    ['apply', '-auto-approve', '-input=false', '-no-color'],
    { cwd: infraDir, env },
  );
}

async function dockerLogin(harness: HarnessEnv, dockerConfigDir: string): Promise<void> {
  mkdirSync(dockerConfigDir, { recursive: true });
  // DOCKER_CONFIG relocates the whole config dir, including cli-plugins — link
  // the user's plugins back so `docker build` with BuildKit can find buildx.
  const pluginsSource = join(homedir(), '.docker', 'cli-plugins');
  const pluginsTarget = join(dockerConfigDir, 'cli-plugins');
  if (existsSync(pluginsSource) && !existsSync(pluginsTarget)) {
    symlinkSync(pluginsSource, pluginsTarget, 'dir');
  }
  const token = await runOrThrow('yc', ['iam', 'create-token'], {
    env: { ...harness.child, YC_PROFILE: harness.ycProfile },
  });
  await runOrThrow(
    'docker',
    ['login', 'cr.yandex', '--username', 'iam', '--password', token.stdout.trim()],
    { env: { ...process.env, YC_PROFILE: harness.ycProfile, DOCKER_CONFIG: dockerConfigDir } },
  );
}
