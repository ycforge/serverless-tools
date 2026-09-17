import { extendInvocationScope } from "../context/invocation-scope";
import type { TransportAdapter, TransportId, TransportInvocation } from "../core/transport";
import type { YandexFunctionHttpResponse } from "./response";
import type { NormalizedHttpRequest } from "./normalized-request";
import { normalizeHttpRequest } from "./normalize-request";
import type { RawHttpApiGatewayV2Event } from "./raw-event";
import { validateHttpApiGatewayV2Event } from "./validate-raw-event";
import type { YcApiGatewayEvent } from "./yc-apigw-raw-event";
import { adaptYcApiGatewayEventToV2 } from "./yc-apigw-event-adapter";
import { validateYcApiGatewayEvent } from "./validate-yc-apigw-event";
import { YandexHttpAdapter } from "./yandex-http-adapter";

/**
 * Raw frame types claimed by the HTTP transport: the API Gateway v2/ALB
 * event (`version:"2.0"` + `rawPath`/`rawQueryString`, issue #5) and the API
 * Gateway `cloud_functions` v1 event (`httpMethod`/`path`, no `version`,
 * spec 036).
 */
export type HttpTransportEvent = RawHttpApiGatewayV2Event | YcApiGatewayEvent;

/**
 * Yandex HTTP transport claiming both plain-HTTP invocation frames
 * (docs/ARCHITECTURE.md section 4; spec 036).
 *
 * Detection discriminators (**observed**): the v2/ALB frame carries payload
 * format `"2.0"` plus the canonical `rawPath`/`rawQueryString` fields; the
 * API Gateway `cloud_functions` frame carries `httpMethod`/`path` and NO
 * `version`. The two branches are disjoint — absence of `version` is part of
 * the v1 claim, so a hybrid event that has `version` plus `httpMethod` is
 * never double-claimed. `supports()` stays cheap, deterministic,
 * side-effect-free and never throws — deeper structural validation happens
 * once inside `invoke` and reports violations as `INVALID_INVOCATION_EVENT`.
 *
 * Both branches normalize through the SAME `normalizeHttpRequest` pipeline;
 * the v1 branch first adapts its event to the canonical v2 shape and marks
 * the normalized request with the honest `httpVersion: "1.0"` (spec 036).
 *
 * The adapter object itself is stateless: everything invocation-specific
 * arrives on the {@link TransportInvocation} and nothing survives the call,
 * so the single module-level instance is safe across warm and concurrent
 * invocations (AGENTS.md sections 10–11).
 */
export const httpApiGatewayV2Transport: TransportAdapter<
  HttpTransportEvent,
  YandexFunctionHttpResponse
> = {
  id: "http" satisfies TransportId,

  supports(rawEvent): rawEvent is HttpTransportEvent {
    if (typeof rawEvent !== "object" || rawEvent === null || Array.isArray(rawEvent)) {
      return false;
    }
    const candidate = rawEvent as Record<string, unknown>;
    if (
      candidate["version"] === "2.0" &&
      typeof candidate["rawPath"] === "string" &&
      typeof candidate["rawQueryString"] === "string"
    ) {
      return true;
    }
    return (
      typeof candidate["httpMethod"] === "string" &&
      typeof candidate["path"] === "string" &&
      !("version" in candidate)
    );
  },

  async invoke(
    invocation: TransportInvocation<HttpTransportEvent>,
  ): Promise<YandexFunctionHttpResponse> {
    if (isApiGatewayV2Event(invocation.rawEvent)) {
      const rawEvent = validateHttpApiGatewayV2Event(invocation.rawEvent);
      const normalizedRequest = normalizeHttpRequest(rawEvent);
      return dispatch(invocation, normalizedRequest);
    }

    const rawEvent = validateYcApiGatewayEvent(invocation.rawEvent);
    const canonicalEvent = adaptYcApiGatewayEventToV2(rawEvent);
    const normalizedRequest = normalizeHttpRequest(canonicalEvent, {
      httpVersion: "1.0",
      raw: rawEvent,
    });
    return dispatch(invocation, normalizedRequest);
  },
};

/** Discriminates the claimed frame cheaply inside `invoke`. */
function isApiGatewayV2Event(event: HttpTransportEvent): event is RawHttpApiGatewayV2Event {
  return (event as Record<string, unknown>)["version"] === "2.0";
}

/** Shared runtime dispatch for both HTTP frame formats. */
function dispatch(
  invocation: TransportInvocation<HttpTransportEvent>,
  normalizedRequest: NormalizedHttpRequest,
): Promise<YandexFunctionHttpResponse> {
  // Publish the normalized request into this invocation's scope before any
  // user code runs: NestJS code reached through the warm container can then
  // read conventional-HTTP semantics plus the execution context injected by
  // the core (@YandexContext()), isolated per invocation (AGENTS.md section
  // 11).
  return extendInvocationScope(
    { httpRequest: normalizedRequest },
    async (): Promise<YandexFunctionHttpResponse> => {
      const application = invocation.container.getApplication();
      const httpAdapter = application.getHttpAdapter();
      if (!(httpAdapter instanceof YandexHttpAdapter)) {
        // Impossible by construction — the core bootstraps every runtime over
        // this adapter — but a self-diagnosing guard beats a blind cast.
        throw new Error("the runtime application was not built over the connector HTTP adapter");
      }
      return httpAdapter.dispatch(normalizedRequest);
    },
  );
}