import type { SystemStatusResponse } from "@nakama/core/contract";

type ChannelWorker = {
  configured?: boolean;
  connected?: boolean;
  paired?: boolean;
  running?: boolean;
};

/**
 * Channels whose "connected" only means a local listener is up. Microsoft can
 * reach a Teams worker only through the public messaging endpoint, which this
 * status cannot see, so a running worker is never shown as connected.
 */
const LISTENER_ONLY = new Set(["teams"]);

export function buildProfileChannels(
  status: Partial<SystemStatusResponse> | undefined,
  failed: boolean,
  isPending: boolean
) {
  // Brand SVGs: Simple Icons v16 (CC0), https://simpleicons.org. Slack is from
  // v13.21.0, the last release that still ships it. Teams uses a plain glyph.
  const channels = [
    { id: "telegram", name: "Telegram", worker: status?.telegramWorker },
    { id: "whatsapp", name: "WhatsApp", worker: status?.whatsappWorker },
    { id: "discord", name: "Discord", worker: status?.discordWorker },
    { id: "slack", name: "Slack", worker: status?.slackWorker },
    { id: "teams", name: "Microsoft Teams", worker: status?.teamsWorker },
  ].map((channel) => {
    const worker: ChannelWorker | undefined = channel.worker;

    const live = Boolean(
      !failed &&
        worker?.running &&
        worker.paired &&
        ("connected" in worker ? worker.connected : true)
    );

    const listenerOnly = LISTENER_ONLY.has(channel.id);
    const connected = live && !listenerOnly;
    const unavailable = failed || !worker;

    const action =
      unavailable || worker?.configured || worker?.paired
        ? "Settings"
        : "Connect";

    const statusLabel = isPending
      ? "Checking…"
      : unavailable
        ? "Status unavailable"
        : live
          ? listenerOnly
            ? "Listening locally"
            : "Connected"
          : worker?.paired
            ? "Offline"
            : worker?.configured
              ? "Setup incomplete"
              : "Not connected";

    return { ...channel, action, connected, statusLabel };
  });

  return { channels };
}
