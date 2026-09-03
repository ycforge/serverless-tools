import type { QueueBodyDeserializer } from "../mq/message";
import type { ConnectorBootstrapOptions } from "../auth/connector-bootstrap-options";

/**
 * Message Queue transport configuration (issue #9).
 *
 * Kept deliberately minimal: the only extension point is the body
 * deserialization strategy. Retry/acknowledgement policy, selectors and other
 * queue behaviors belong to their own issues and are intentionally absent.
 */
export interface QueueTransportOptions {
  /**
   * Replaces the default strict-JSON policy for EVERY delivery handled by
   * this runtime. The strategy receives the exact raw body plus the
   * normalized message; its return value becomes `QueueMessage.payload` and
   * its failures propagate verbatim into the consuming handler round.
   */
  readonly deserializeBody?: QueueBodyDeserializer;
}

/**
 * Options accepted by {@link createYandexHandler}.
 *
 * All sections are optional; omitting `queue` selects the documented default
 * behavior (strict-JSON bodies). HTTP transport behavior is not configurable
 * through this type — the API Gateway v2 contract is fixed by the platform.
 */
export interface CreateYandexHandlerOptions extends ConnectorBootstrapOptions {
  readonly queue?: QueueTransportOptions;
}
