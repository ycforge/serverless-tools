/**
 * Per-invocation response facade (issue #6): the minimal conventional
 * surface NestJS pipelines and `@Res()` consumers rely on — status, headers,
 * body — accumulated in memory and serialized into the Yandex wire envelope
 * once dispatch finishes (`serialize-response.ts`).
 *
 * Header storage keeps insertion order and multiplicity per lowercased name:
 * single values serialize into the flat `headers` map of the wire envelope,
 * repeated appends (typically multiple `Set-Cookie` lines) go through the
 * verified `multiValueHeaders` response field instead of being lossily
 * joined (see `response.ts` for the observed gateway behavior).
 */

export interface HeaderEntry {
  readonly name: string;
  readonly values: readonly string[];
}

/**
 * Connector-internal surface consumed by the response serializer; everything
 * above these two members mirrors conventional platform semantics.
 */
interface ResponseSerializationAccess {
  /** All stored headers in insertion order, including repeated values. */
  readonly headerEntries: readonly HeaderEntry[];
  /** Final payload handed to reply/send/json/end, or undefined when empty. */
  readonly bodyPayload: string | Buffer | undefined;
}

/**
 * Facade handed to middleware, route handlers and exception layers.
 *
 * The serialization-access members are implementation seams of this adapter
 * (typed deliberately instead of hidden behind casts); user code receives the
 * same object but only ever needs the conventional members.
 */
export type YandexHttpResponseFacade = ResponseSerializationAccess & {
  statusCode: number;
  readonly headersSent: boolean;

  /** Sets the status code; chainable like the platform equivalents. */
  status(statusCode: number): YandexHttpResponseFacade;
  getHeader(name: string): string | undefined;
  /** Replaces any previous values for the header. */
  setHeader(name: string, value: string): YandexHttpResponseFacade;
  /** Appends another value, preserving multiplicity (e.g. Set-Cookie). */
  appendHeader(name: string, value: string): YandexHttpResponseFacade;
  hasHeader(name: string): boolean;
  /** Marks the body as JSON; serialized with `application/json`. */
  json(payload: unknown): void;
  /**
   * Express-style generic send: strings stay text, buffers stay binary,
   * plain objects serialize as JSON.
   */
  send(payload: string | Buffer | object): void;
  /** Finishes the response without a payload. */
  end(): void;
  redirect(statusCode: number, url: string): void;
};

/**
 * Transport policy for implicit content types, applied exactly once — here,
 * at payload-write time — and nowhere else (AGENTS.md section 12: no magic
 * constants scattered across layers). Handlers that set an explicit
 * `Content-Type` always win.
 */
const IMPLICIT_JSON_CONTENT_TYPE = "application/json";
const IMPLICIT_TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
const IMPLICIT_BINARY_CONTENT_TYPE = "application/octet-stream";

function normalizeHeaderName(name: string): string {
  return name.toLowerCase();
}

export function createResponseFacade(): YandexHttpResponseFacade {
  let statusCode = 200;
  let ended = false;
  let bodyPayload: string | Buffer | undefined = undefined;
  const headerValues = new Map<string, string[]>();

  const facade: YandexHttpResponseFacade = {
    headerEntries: [],
    bodyPayload: undefined,

    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    get headersSent() {
      return ended;
    },

    status(code) {
      statusCode = code;
      return facade;
    },

    getHeader(name) {
      const values = headerValues.get(normalizeHeaderName(name));
      if (values === undefined || values.length === 0) {
        return undefined;
      }
      return values.length === 1 ? values[0] : values.join(", ");
    },

    setHeader(name, value) {
      headerValues.set(normalizeHeaderName(name), [value]);
      return facade;
    },

    appendHeader(name, value) {
      const key = normalizeHeaderName(name);
      const existing = headerValues.get(key);
      if (existing === undefined) {
        headerValues.set(key, [value]);
      } else {
        existing.push(value);
      }
      return facade;
    },

    hasHeader(name) {
      return headerValues.has(normalizeHeaderName(name));
    },

    json(payload) {
      if (!facade.hasHeader("content-type")) {
        facade.setHeader("content-type", IMPLICIT_JSON_CONTENT_TYPE);
      }
      // Serialized at write time, not in the serializer: a serialization
      // failure (e.g. circular structures) then surfaces inside the route
      // proxy's try/catch and maps through Nest's exception filters to a
      // proper 500 response — exactly like platform servers.
      bodyPayload = JSON.stringify(payload);
      ended = true;
    },

    send(payload) {
      if (typeof payload === "string") {
        if (!facade.hasHeader("content-type")) {
          facade.setHeader("content-type", IMPLICIT_TEXT_CONTENT_TYPE);
        }
        bodyPayload = payload;
      } else if (Buffer.isBuffer(payload)) {
        if (!facade.hasHeader("content-type")) {
          facade.setHeader("content-type", IMPLICIT_BINARY_CONTENT_TYPE);
        }
        bodyPayload = payload;
      } else {
        // Objects behave like json() (express parity for res.send(obj)).
        if (!facade.hasHeader("content-type")) {
          facade.setHeader("content-type", IMPLICIT_JSON_CONTENT_TYPE);
        }
        bodyPayload = JSON.stringify(payload);
      }
      ended = true;
    },

    end() {
      ended = true;
    },

    redirect(code, url) {
      statusCode = code;
      facade.setHeader("location", url);
      // Deliberate deviation from Express: no HTML redirect body — an API
      // gateway envelope carries the Location header, not a landing page.
      // Set directly: an empty body must not gain an implicit content type.
      bodyPayload = "";
      ended = true;
    },
  };

  // Live views over the closure state so the serializer always reads the
  // final values after the pipeline completes.
  Object.defineProperty(facade, "headerEntries", {
    enumerable: true,
    get: () =>
      [...headerValues.entries()].map(([name, values]) => ({
        name,
        values: [...values],
      })),
  });
  Object.defineProperty(facade, "bodyPayload", {
    enumerable: true,
    get: () => bodyPayload,
  });

  return facade;
}
