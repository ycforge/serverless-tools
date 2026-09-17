import { randomBytes } from 'node:crypto';

export interface HarnessEnv {
  readonly runId: string;
  readonly folderId: string;
  readonly cloudId: string | undefined;
  readonly serviceAccountId: string;
  readonly ycProfile: string;
  readonly awsRegion: string;
  readonly awsEndpoint: string;
  readonly terraform: NodeJS.ProcessEnv;
  readonly child: NodeJS.ProcessEnv;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `missing required environment variable ${name} (spec 037 requires credentials from the user's env)`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Builds the harness environment. When `YCSF_E2E=1` this fails fast if any
 * required credential is missing; callers gate on `YCSF_E2E` first.
 */
export function requireHarnessEnv(): HarnessEnv {
  const folderId = required('YC_FOLDER_ID');
  const serviceAccountId = required('YC_SERVICE_ACCOUNT_ID');

  const hasToken = optional('YC_TOKEN') !== undefined;
  const hasKeyFile = optional('YC_SERVICE_ACCOUNT_KEY_FILE') !== undefined;
  if (!hasToken && !hasKeyFile) {
    throw new Error(
      'missing YC credentials: set YC_TOKEN or YC_SERVICE_ACCOUNT_KEY_FILE (spec 037)',
    );
  }

  const awsAccessKeyId = required('AWS_ACCESS_KEY_ID');
  const awsSecretAccessKey = required('AWS_SECRET_ACCESS_KEY');

  const runId = optional('E2E_RUN_ID') ?? randomBytes(4).toString('hex');
  const ycProfile = optional('YC_PROFILE') ?? 'ycforge-sa';
  const cloudId = optional('YC_CLOUD_ID');

  const terraform: NodeJS.ProcessEnv = {
    ...process.env,
    YC_FOLDER_ID: folderId,
    ...(cloudId !== undefined ? { YC_CLOUD_ID: cloudId } : {}),
    // Yandex Message Queue is managed over the S3-compatible API: the provider
    // needs the SA static access key, not just IAM authentication.
    YC_ACCESS_KEY: awsAccessKeyId,
    YC_SECRET_KEY: awsSecretAccessKey,
    TF_VAR_service_account_id: serviceAccountId,
    TF_VAR_run_id: runId,
    TF_VAR_message_queue_access_key: awsAccessKeyId,
    TF_VAR_message_queue_secret_key: awsSecretAccessKey,
  };

  const child: NodeJS.ProcessEnv = {
    ...process.env,
    YC_PROFILE: ycProfile,
    E2E_RUN_ID: runId,
    E2E_SERVICE_ACCOUNT_ID: serviceAccountId,
  };

  return {
    runId,
    folderId,
    cloudId,
    serviceAccountId,
    ycProfile,
    awsRegion: optional('AWS_REGION') ?? 'ru-central1',
    awsEndpoint: optional('E2E_YMQ_ENDPOINT') ?? 'https://message-queue.api.cloud.yandex.net',
    terraform,
    child,
  };
}
