/**
 * Raw Yandex Cloud Functions Message Queue trigger event, exactly as delivered
 * to the function.
 *
 * Evidence level: **observed** — this mirrors the captured runtime payload
 * documented in AGENTS.md section 4.6. Field names stay verbatim snake_case so
 * `raw` remains a faithful record of what Yandex sent; do not rename them.
 *
 * Index signatures keep additive future fields accessible instead of
 * discarding them (AGENTS.md section 36).
 */
export interface RawQueueEventMetadata {
  event_id: string;
  event_type: string;
  created_at: string;

  /** Shape not fully characterized during capture; intentionally `unknown`. */
  tracing_context: unknown;

  cloud_id: string;
  folder_id: string;

  [key: string]: unknown;
}

/** Observed message attribute value form; additional value kinds may appear as additive fields. */
export interface RawQueueMessageAttributeValue {
  data_type: string;
  string_value: string;

  [key: string]: unknown;
}

export interface RawQueueMessageEvent {
  event_metadata: RawQueueEventMetadata;

  details: {
    queue_id: string;

    message: {
      message_id: string;
      md5_of_body: string;
      body: string;

      attributes: Record<string, string>;

      message_attributes: Record<string, RawQueueMessageAttributeValue>;

      md5_of_message_attributes: string;

      [key: string]: unknown;
    };

    [key: string]: unknown;
  };

  [key: string]: unknown;
}

export interface RawQueueEvent {
  /** Always an array on the wire even when the trigger groups one message. */
  messages: RawQueueMessageEvent[];

  [key: string]: unknown;
}
