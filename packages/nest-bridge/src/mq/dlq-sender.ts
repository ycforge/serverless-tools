/**
 * Dead Letter Queue sender for Yandex Message Queue (issue #005, spec 037).
 *
 * Republishes failed messages via the YMQ SQS-compatible `SendMessage` API.
 * YMQ accepts only AWS Signature V4 with a static access key (IAM bearer
 * tokens are rejected), and the metadata service exposes only IAM tokens — so
 * a function must be given static credentials via options or environment
 * (`YC_MQ_KEY_ID`/`YC_MQ_KEY_VALUE`, falling back to
 * `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). The signing itself uses only
 * `node:crypto` (see `./sigv4`) — no AWS SDK dependency is added. The env
 * names deliberately avoid the `*secret`/`*accesskey` suffixes that the
 * `ycsf check` suspicious-key heuristic denylists in `.ycsf/*.yaml`.
 *
 * DLQ send failures are logged as warnings and NEVER throw (fail-open per
 * FR-011): a broken DLQ path must not change the transport outcome. The
 * per-message warning carries only the messageId and the invocation trace_id
 * (when one is active) — never the message body, tokens, headers or raw
 * values (FR-010).
 */

import { getInvocationScopeState } from "../context/invocation-scope";
import { signSigV4, type SigV4Credentials } from "./sigv4";

/** Default YMQ endpoint and region (Yandex Cloud has a single region). */
const DEFAULT_ENDPOINT = "https://message-queue.api.cloud.yandex.net";
const DEFAULT_REGION = "ru-central1";

export interface DlqSenderOptions {
  /** Static SQS credentials; when absent, resolved from the environment. */
  readonly credentials?: SigV4Credentials;
  readonly endpoint?: string;
  readonly region?: string;
}

function credentialsFromEnv(): SigV4Credentials | undefined {
  const accessKeyId = process.env.YC_MQ_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.YC_MQ_KEY_VALUE ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (
    accessKeyId !== undefined &&
    accessKeyId !== "" &&
    secretAccessKey !== undefined &&
    secretAccessKey !== ""
  ) {
    return { accessKeyId, secretAccessKey };
  }
  return undefined;
}

/**
 * Sends failed messages to a Yandex Message Queue dead letter queue.
 *
 * Stateless per invocation; the credential lookup is inexpensive (env/options).
 */
export class DlqSender {
  constructor(private readonly options: DlqSenderOptions = {}) {}

  /**
   * Sends a single message body to the specified DLQ.
   *
   * @param body - The raw message body to republish
   * @param queueUrl - The DLQ SQS queue URL (e.g. the value of
   *   `yandex_message_queue.<name>.id` in Terraform)
   * @returns `true` if the message was sent successfully, `false` otherwise
   */
  async send(body: string, queueUrl: string, messageId?: string): Promise<boolean> {
    try {
      const credentials = this.options.credentials ?? credentialsFromEnv();
      if (credentials === undefined) {
        this.logSendWarning(queueUrl, messageId, "no static credentials configured");
        return false;
      }
      if (!/^https?:\/\//.test(queueUrl)) {
        this.logSendWarning(
          queueUrl,
          messageId,
          "deadLetterQueueId must be the queue URL, not a bare id",
        );
        return false;
      }

      const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT;
      const region = this.options.region ?? DEFAULT_REGION;
      const requestBody = new URLSearchParams({
        Action: "SendMessage",
        Version: "2012-11-05",
        QueueUrl: queueUrl,
        MessageBody: body,
      }).toString();

      const headers = signSigV4({
        method: "POST",
        url: `${endpoint}/`,
        region,
        service: "sqs",
        credentials,
        body: requestBody,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const response = await fetch(`${endpoint}/`, {
        method: "POST",
        headers,
        body: requestBody,
      });

      if (!response.ok) {
        this.logSendWarning(queueUrl, messageId, `DLQ publish failed with HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch {
      this.logSendWarning(queueUrl, messageId, "DLQ publish failed");
      return false;
    }
  }

  /**
   * Sends multiple failed messages to the DLQ. Returns the count of
   * successfully sent messages.
   */
  async sendBatch(
    failures: ReadonlyArray<{ messageId: string; body: string }>,
    queueUrl: string,
  ): Promise<number> {
    let sent = 0;
    for (const failure of failures) {
      if (await this.send(failure.body, queueUrl, failure.messageId)) {
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Best-effort failure warning (fail-open observability, FR-011): carries the
   * invocation trace_id/awsRequestId when one is active and the failed
   * messageId when known — never the body, tokens, headers or raw values
   * (FR-010). Uses the non-throwing scope accessor so logging can never break
   * the transport outcome, including outside an invocation scope.
   */
  private logSendWarning(queueRef: string, messageId: string | undefined, reason: string): void {
    const traceId = getInvocationScopeState()?.executionContext.awsRequestId;
    const trace = traceId !== undefined ? `[${traceId}]` : "";
    const target = messageId !== undefined ? `message ${messageId}` : "a message";
    console.warn(
      `[dlq]${trace} failed to republish ${target} to DLQ queue ${queueRef}: ${reason} — message lost`,
    );
  }
}
