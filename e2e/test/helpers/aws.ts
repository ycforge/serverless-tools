import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

function credentials(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error('missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for YMQ/S3 access');
  }
  return { accessKeyId, secretAccessKey };
}

export const YMQ_ENDPOINT =
  process.env.E2E_YMQ_ENDPOINT ?? 'https://message-queue.api.cloud.yandex.net';
export const STORAGE_ENDPOINT =
  process.env.E2E_STORAGE_ENDPOINT ?? 'https://storage.yandexcloud.net';

export function sqsClient(): SQSClient {
  return new SQSClient({ region: 'ru-central1', endpoint: YMQ_ENDPOINT, credentials: credentials() });
}

export function s3Client(): S3Client {
  return new S3Client({ region: 'ru-central1', endpoint: STORAGE_ENDPOINT, credentials: credentials() });
}

export async function listQueues(): Promise<string[]> {
  const client = sqsClient();
  const result = await client.send(new ListQueuesCommand({}));
  return result.QueueUrls ?? [];
}

export async function getQueueUrl(name: string): Promise<string> {
  const client = sqsClient();
  const result = await client.send(new GetQueueUrlCommand({ QueueName: name }));
  if (result.QueueUrl === undefined) {
    throw new Error(`queue '${name}' has no URL`);
  }
  return result.QueueUrl;
}

export async function sendMessage(name: string, body: unknown): Promise<void> {
  const client = sqsClient();
  const queueUrl = await getQueueUrl(name);
  await client.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(body) }),
  );
}

export async function purgeQueue(name: string): Promise<void> {
  const client = sqsClient();
  const queueUrl = await getQueueUrl(name);
  await client.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
}

export interface ReceivedMessage {
  readonly id: string;
  readonly body: string;
}

export async function receiveMessages(
  name: string,
  options: { max?: number; waitSeconds?: number; timeoutMs?: number } = {},
): Promise<ReceivedMessage[]> {
  const client = sqsClient();
  const queueUrl = await getQueueUrl(name);
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const collected: ReceivedMessage[] = [];
  while (Date.now() < deadline && collected.length < (options.max ?? 1)) {
    const result = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Math.min(10, (options.max ?? 1) - collected.length),
        WaitTimeSeconds: options.waitSeconds ?? 5,
        VisibilityTimeout: 5,
      }),
    );
    for (const message of result.Messages ?? []) {
      collected.push({ id: message.MessageId ?? '', body: message.Body ?? '' });
      if (message.ReceiptHandle !== undefined) {
        await client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
        );
      }
    }
  }
  return collected;
}

export async function getObjectText(bucket: string, key: string): Promise<string> {
  const client = s3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = result.Body as { transformToString: () => Promise<string> };
  return stream.transformToString();
}

export async function listObjectKeys(bucket: string, prefix?: string): Promise<string[]> {
  const client = s3Client();
  const result = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, ...(prefix !== undefined ? { Prefix: prefix } : {}) }),
  );
  return (result.Contents ?? []).map((object) => object.Key ?? '').filter((key) => key !== '');
}
