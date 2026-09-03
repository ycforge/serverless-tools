import { extendInvocationScope } from "../context/invocation-scope";
import type { TransportAdapter, TransportId, TransportInvocation } from "../core/transport";
import type { YandexFunctionHttpResponse } from "./response";
import { normalizeHttpRequest } from "./normalize-request";
import type { RawHttpApiGatewayV2Event } from "./raw-event";
import { validateHttpApiGatewayV2Event } from "./validate-raw-event";
import { YandexHttpAdapter } from "./yandex-http-adapter";

/**
 * Yandex API Gateway v2 HTTP transport (issue #5, dispatch since #6).
 *
 * Detection discriminator (**observed**, docs/ARCHITECTURE.md section 4):
 * payload format `"2.0"` plus the canonical `rawPath`/`rawQueryString`
 * fields. `supports()` stays cheap, deterministic, side-effect-free and
 * never throws — deeper structural validation happens once inside `invoke`
 * and reports violations as `INVALID_INVOCATION_EVENT`.
 *
 * The adapter object itself is stateless: everything invocation-specific
 * arrives on the {@link TransportInvocation} and nothing survives the call,
 * so the single module-level instance is safe across warm and concurrent
 * invocations (AGENTS.md sections 10–11).
 */
export const httpApiGatewayV2Transport: TransportAdapter<
  RawHttpApiGatewayV2Event,
  YandexFunctionHttpResponse
> = {
  id: "http" satisfies TransportId,

  supports(rawEvent): rawEvent is RawHttpApiGatewayV2Event {
    if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
      return false;
    }
    const candidate = rawEvent as Record<string, unknown>;
    return (
      candidate["version"] === "2.0" &&
      typeof candidate["rawPath"] === "string" &&
      typeof candidate["rawQueryString"] === "string"
    );
  },

  async invoke(
    invocation: TransportInvocation<RawHttpApiGatewayV2Event>,
  ): Promise<YandexFunctionHttpResponse> {
    const rawEvent = validateHttpApiGatewayV2Event(invocation.rawEvent);
    const normalizedRequest = normalizeHttpRequest(rawEvent);

    // Publish the normalized request into this invocation's scope before any
    // user code runs: NestJS code reached through the warm container can then
    // read conventional-HTTP semantics plus the execution context injected by
    // the core (@YandexContext()), isolated per invocation (AGENTS.md section
    // 11).
    return extendInvocationScope({ httpRequest: normalizedRequest }, async () => {
      const application = invocation.container.getApplication();
      const httpAdapter = application.getHttpAdapter();
      if (!(httpAdapter instanceof YandexHttpAdapter)) {
        // Impossible by construction — the core bootstraps every runtime over
        // this adapter — but a self-diagnosing guard beats a blind cast.
        throw new Error("the runtime application was not built over the connector HTTP adapter");
      }
      return httpAdapter.dispatch(normalizedRequest);
    });
  },
};
