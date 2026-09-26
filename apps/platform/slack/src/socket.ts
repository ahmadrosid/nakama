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
  /**
   * Handles one event. The envelope is acked only after this settles, so a
   * throw leaves the event unacked and Slack redelivers it. A handler that
   * never settles would stall that envelope, so the ack path below is bounded.
   */
  onEvent: (event: SlackMessageEvent) => Promise<void> | void;
  onStatus: (connected: boolean) => void;
}): { close: () => void } {
  let socket: WebSocket | null = null;
  let closed = false;
  let backoffMs = 1000;
  let envelopeQueue: Promise<void> = Promise.resolve();
  const seenEventIds = new Set<string>();

  function scheduleReconnect(): void {
    if (closed) {
      return;
    }
    setTimeout(() => void open(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function ack(envelopeId: string): void {
    try {
      socket?.send(JSON.stringify({ envelope_id: envelopeId }));
    } catch (error) {
      // A failed ack means Slack redelivers, which is the safe direction: the
      // dedupe set stops it running twice.
      console.error("Slack ack failed:", error);
    }
  }

  async function handleEnvelope(envelope: SocketEnvelope): Promise<void> {
    if (envelope.type === "hello") {
      // Slack redelivers a hello until it is acked, so ack before returning.
      if (envelope.envelope_id) {
        ack(envelope.envelope_id);
      }
      backoffMs = 1000;
      options.onStatus(true);
      return;
    }

    if (envelope.type === "disconnect") {
      if (envelope.envelope_id) {
        ack(envelope.envelope_id);
      }
      socket?.close();
      return;
    }

    const event = envelope.payload?.event;
    const eventId = envelope.payload?.event_id;
    if (envelope.type !== "events_api" || !event) {
      if (envelope.envelope_id) {
        ack(envelope.envelope_id);
      }
      return;
    }
    // Slack redelivers when an ack is late; never run the same turn twice.
    // Only recorded once the work is done, so a redelivery after a failure is
    // still processed instead of being dropped as a duplicate.
    if (eventId && seenEventIds.has(eventId)) {
      if (envelope.envelope_id) {
        ack(envelope.envelope_id);
      }
      return;
    }

    // Ack after the work, not before. Acking first meant a crash or a throw
    // lost the message with no redelivery and no record of the failure.
    try {
      await options.onEvent(event);
      if (eventId) {
        seenEventIds.add(eventId);
        if (seenEventIds.size > SEEN_EVENT_LIMIT) {
          seenEventIds.delete(seenEventIds.values().next().value as string);
        }
      }
      if (envelope.envelope_id) {
        ack(envelope.envelope_id);
      }
    } catch (error) {
      console.error("Slack event handling failed, leaving it unacked:", error);
    }
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
      // Envelopes are handled in arrival order. A disconnect must not overtake
      // the event envelopes sent before it, and acking is now asynchronous —
      // concurrent handling let the close win and swallow the pending acks.
      envelopeQueue = envelopeQueue
        .then(async () => {
          try {
            await handleEnvelope(
              JSON.parse(String(message.data)) as SocketEnvelope
            );
          } catch (error) {
            console.error("Slack envelope error:", error);
          }
        })
        .catch(() => undefined);
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
