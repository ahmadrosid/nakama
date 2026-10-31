import { callSlackApi } from "@nakama/core/slack-config";

/** Inner event of a Socket Mode `events_api` envelope. */
export interface SlackMessageEvent {
  bot_id?: string;
  channel: string;
  channel_type?: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  ts: string;
  type: string;
  user?: string;
}

interface SocketEnvelope {
  envelope_id?: string;
  payload?: { event?: SlackMessageEvent; event_id?: string };
  reason?: string;
  type?: string;
}

const MAX_BACKOFF_MS = 30_000;

const SEEN_EVENT_LIMIT = 500;

/**
 * Socket Mode without the SDK: open a ticket URL, ack each envelope, and
 * reconnect on `disconnect` or close. No public URL is needed.
 * ponytail: no client-side ping watchdog; a half-open socket waits for Slack's
 * next refresh. Add one if the bridge goes silent without a close event.
 */
export function connectSlackSocket(options: {
  appToken: string;
  /** Resolves once the event is safe to ack; the turn itself runs on after. */
  onEvent: (event: SlackMessageEvent, eventId: string) => Promise<void> | void;
  onStatus: (connected: boolean) => void;
}) {
  let socket: WebSocket | null = null;
  let closed = false;
  let backoffMs = 1000;
  // Each event's accept, so a duplicate is acked only once the first is safe.
  const seenEvents = new Map<string, Promise<void>>();

  function scheduleReconnect(): void {
    if (closed) {
      return;
    }

    setTimeout(() => void open(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function ack(envelope: SocketEnvelope): void {
    if (envelope.envelope_id) {
      socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }
  }

  function handleEnvelope(envelope: SocketEnvelope): void {
    const event = envelope.payload?.event;

    if (envelope.type !== "events_api" || !event) {
      ack(envelope);
    }

    if (envelope.type === "hello") {
      backoffMs = 1000;
      options.onStatus(true);

      return;
    }

    if (envelope.type === "disconnect") {
      socket?.close();

      return;
    }

    if (envelope.type !== "events_api" || !event) {
      return;
    }

    const eventId =
      envelope.payload?.event_id ?? `${event.channel}:${event.ts}`;

    // Slack redelivers when an ack is late; never run the same turn twice.
    const from = socket;

    const ackOnSameSocket = () => {
      // The envelope belongs to this connection. Once it is gone, Slack
      // redelivers on the next one and this map answers it.
      if (from?.readyState === WebSocket.OPEN && envelope.envelope_id) {
        from.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      }
    };

    const seen = seenEvents.get(eventId);

    if (seen) {
      seen.then(ackOnSameSocket, () => {});

      return;
    }

    const accepted = Promise.resolve().then(() =>
      options.onEvent(event, eventId)
    );

    seenEvents.set(eventId, accepted);

    if (seenEvents.size > SEEN_EVENT_LIMIT) {
      const oldestEventId = seenEvents.keys().next().value;

      if (oldestEventId) {
        seenEvents.delete(oldestEventId);
      }
    }

    // No ack on a failure, so Slack delivers the event again.
    accepted.then(ackOnSameSocket, (error) => {
      seenEvents.delete(eventId);
      console.error("Slack event not accepted:", error);
    });
  }

  async function open(): Promise<void> {
    if (closed) {
      return;
    }

    let url: string;

    try {
      ({ url } = await callSlackApi<{ url: string }>(
        "apps.connections.open",
        options.appToken
      ));
    } catch (error) {
      console.error("Slack connection failed:", error);
      scheduleReconnect();

      return;
    }

    const next = new WebSocket(url);
    socket = next;
    next.addEventListener("message", (message) => {
      try {
        // SAFETY: Slack sends each Socket Mode event as a JSON envelope.
        handleEnvelope(JSON.parse(String(message.data)) as SocketEnvelope);
      } catch (error) {
        console.error("Slack envelope error:", error);
      }
    });
    next.addEventListener("close", () => {
      if (socket === next) {
        socket = null;
        options.onStatus(false);
        scheduleReconnect();
      }
    });
  }

  void open();

  return {
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}
