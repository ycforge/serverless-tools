/**
 * Dead Letter Queue sender for Yandex Message Queue (issue #005).
 *
 * Republishes failed messages to a user-specified DLQ via the Yandex MQ HTTP
 * API. Uses native `fetch` (Node 18+) — no new npm dependencies. IAM token
 * is lazily fetched from the metadata service with TTL caching.
 *
 * DLQ send failures are logged as warnings and NEVER throw (fail-open per
 * FR-011): a broken DLQ path must not change the transport outcome. The
 * per-message warning carries only the messageId and the invocation trace_id
 * (when one is active) — never the message body, tokens, headers or raw
 * values (FR-010).
 */

import { getInvocationScopeState } from "../context/invocation-scope";

/**
 * Internal request shape for Yandex MQ HTTP API message publish.
 */
export interface DlqSendRequest {
  /** Base64-encoded message body */
  readonly messageBody: string;
  /** Optional queue ID (included in request body for API compatibility) */
  readonly queueId?: string;
  /** Optional delay before message becomes visible (default: 0) */
  readonly delaySeconds?: number;
}

/** Metadata service endpoint for IAM token retrieval (Yandex Cloud). */
const IAM_TOKEN_METADATA_URL =
  "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token";

/** Yandex MQ HTTP API base URL. */
const YANDEX_MQ_API_BASE = "https://message-queue.api.cloud.yandex.net/queues";

/** Refresh margin: re-fetch token 5 minutes before expiry. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

/**
 * Sends failed messages to a Yandex Message Queue dead letter queue.
 *
 * Stateless per invocation — the token cache is module-level so warm
 * processes reuse IAM tokens across invocations.
 */
export class DlqSender {
  private cachedToken: CachedToken | undefined;

  /**
   * Sends a single message body to the specified DLQ queue.
   *
   * @param body - The raw message body to republish
   * @param queueId - The dead letter queue ID from PartialFailureOptions
   * @returns `true` if the message was sent successfully, `false` otherwise
   */
  async send(body: string, queueId: string, messageId?: string): Promise<boolean> {
    try {
      const token = await this.getToken();
      const messageBody = Buffer.from(body).toString("base64");

      const url = `${YANDEX_MQ_API_BASE}/${encodeURIComponent(queueId)}/messages`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageBody } satisfies DlqSendRequest),
      });

      if (!response.ok) {
        this.logSendWarning(queueId, messageId, `DLQ publish failed with HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch {
      this.logSendWarning(queueId, messageId, "DLQ publish failed");
      return false;
    }
  }

  /**
   * Sends multiple failed messages to the DLQ. Returns the count of
   * successfully sent messages.
   */
  async sendBatch(
    failures: ReadonlyArray<{ messageId: string; body: string }>,
    queueId: string,
  ): Promise<number> {
    let sent = 0;
    for (const failure of failures) {
      if (await this.send(failure.body, queueId, failure.messageId)) {
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
  private logSendWarning(queueId: string, messageId: string | undefined, reason: string): void {
    const traceId = getInvocationScopeState()?.executionContext.awsRequestId;
    const trace = traceId !== undefined ? `[${traceId}]` : "";
    const target = messageId !== undefined ? `message ${messageId}` : "a message";
    console.warn(
      `[dlq]${trace} failed to republish ${target} to DLQ queue ${queueId}: ${reason} — message lost`,
    );
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - now > TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken.token;
    }

    const response = await fetch(IAM_TOKEN_METADATA_URL, {
      headers: { "Metadata-Flavor": "Google" },
    });

    if (!response.ok) {
      throw new Error(`IAM token fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    const expiresAt = now + data.expires_in * 1000;

    this.cachedToken = { token: data.access_token, expiresAt };
    return data.access_token;
  }
}
