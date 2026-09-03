import { httpApiGatewayV2Transport } from "../http/adapter";
import { createMessageQueueTransport } from "../mq/adapter";
import type { CreateYandexHandlerOptions } from "./handler-options";
import type { TransportAdapter } from "./transport";

/**
 * Builds the ordered built-in transport registry, consulted once per
 * invocation by `detectTransport` (docs/ARCHITECTURE.md section 4).
 *
 * This array is the single registration point for transports; application
 * code never adds to it. Order is detection-priority order and must stay
 * deterministic: the HTTP / API Gateway v2 adapter comes first, the Message
 * Queue trigger adapter second (issue #7). The two discriminators are
 * disjoint — `version === "2.0"` + canonical path fields vs a non-empty,
 * envelope-shaped `messages` array — so each event shape is claimed by exactly
 * one transport regardless of position.
 *
 * Only the Message Queue transport currently accepts configuration (queue
 * body deserialization, issue #9); HTTP behavior is fixed by the platform.
 */
export function createBuiltinTransports(
  options?: CreateYandexHandlerOptions,
): readonly TransportAdapter[] {
  return [httpApiGatewayV2Transport, createMessageQueueTransport(options?.queue)];
}

/** Default registry without any configuration; kept for direct consumers of the runtime seam. */
export const BUILTIN_TRANSPORTS: readonly TransportAdapter[] = createBuiltinTransports();
