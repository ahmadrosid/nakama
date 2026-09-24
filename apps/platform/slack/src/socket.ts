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
 * Socket Mode without the SDK: open a ticket URL, ack every envelope, and
 * reconnect on `disconnect` or close. No public URL is needed.
 * ponytail: no client-side ping watchdog; a half-open socket waits for Slack's
 * next refresh. Add one if the bridge goes silent without a close event.
 */
export function connectSlackSocket(options: {
  appToken: string;
  onEvent: (event: SlackMessageEvent) => void;
  onStatus: (connected: boolean) => void;
}): { close: () => void } {
  let socket: WebSocket | null = null;
  let closed = false;
  let backoffMs = 1000;
  const seenEventIds = new Set<string>();

  function scheduleReconnect(): void {
    if (closed) {
      return;
    }
    setTimeout(() => void open(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function handleEnvelope(envelope: SocketEnvelope): void {
    if (envelope.envelope_id) {
      socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
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

    const event = envelope.payload?.event;
    const eventId = envelope.payload?.event_id;
    if (envelope.type !== "events_api" || !event) {
      return;
    }
    // Slack redelivers when an ack is late; never run the same turn twice.
    if (eventId) {
      if (seenEventIds.has(eventId)) {
        return;
      }
      seenEventIds.add(eventId);
      if (seenEventIds.size > SEEN_EVENT_LIMIT) {
        seenEventIds.delete(seenEventIds.values().next().value as string);
      }
    }
    options.onEvent(event);
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
