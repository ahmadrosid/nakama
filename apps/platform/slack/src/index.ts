import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
  splitTelegramChunks,
} from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import { channelOwnerFromEnv } from "@nakama/core/channel-config-shared";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import {
  callSlackApi,
  getSlackConfigDir,
  loadSlackConfigFile,
  type SlackMember,
} from "@nakama/core/slack-config";
import {
  createSlackWorkerHeartbeat,
  isHeartbeatAlive,
} from "@nakama/core/slack-worker";
import { createChatHandler, type SlackApi } from "./chat-handler";
import { connectSlackSocket } from "./socket";

installErrorHandlers("worker:slack");
void installErrorTrackingSink();

const owner = channelOwnerFromEnv();
const heartbeat = createSlackWorkerHeartbeat(owner);

let spawnedChild: Bun.Subprocess | null = null;
let closeSocket: (() => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let connected = false;

async function shutdown(code: number): Promise<never> {
  closeSocket?.();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  await heartbeat.clear();
  if (hasActiveStreams()) {
    console.warn(
      "Leaving the spawned Nakama server running so in-flight agent turns can finish; the next worker start will reuse it."
    );
  } else {
    stopSpawnedServer(spawnedChild);
  }
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void shutdown(0));
}

function isSlackBlockRejection(error: unknown): boolean {
  return error instanceof Error && /failed: invalid_blocks/.test(error.message);
}

function createSlackApi(botToken: string): SlackApi {
  return {
    addReaction: async (channel, timestamp, name) => {
      await callSlackApi("reactions.add", botToken, {
        channel,
        name,
        timestamp,
      });
    },
    getMember: async (user) =>
      (
        await callSlackApi<{ user: SlackMember }>("users.info", botToken, {
          user,
        })
      ).user,
    postMessage: async (channel, text, threadTs) => {
      // A payload's markdown blocks share a 12,000 character budget.
      for (const chunk of splitTelegramChunks(text, 11_000)) {
        const message = { channel, text: chunk, thread_ts: threadTs };
        // The markdown block renders the model's Markdown as-is. Plain text is
        // retried only when Slack rejects the block itself: after a timeout the
        // first post may have landed, and a rate limit would just fail again.
        await callSlackApi("chat.postMessage", botToken, {
          ...message,
          blocks: [{ text: chunk, type: "markdown" }],
        }).catch((error: unknown) => {
          if (!isSlackBlockRejection(error)) {
            throw error;
          }
          return callSlackApi("chat.postMessage", botToken, message);
        });
      }
    },
    removeReaction: async (channel, timestamp, name) => {
      await callSlackApi("reactions.remove", botToken, {
        channel,
        name,
        timestamp,
      });
    },
  };
}

try {
  const existing = await heartbeat.read();
  if (existing && existing.pid !== process.pid && isHeartbeatAlive(existing)) {
    throw new Error(
      `Another Nakama Slack bridge already runs this connection (pid ${existing.pid}).`
    );
  }

  const config = await loadSlackConfigFile(owner);
  if (!config?.appToken) {
    throw new Error(
      "Configure this agent's Slack connection before starting its worker."
    );
  }

  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;
  const client = new NakamaClient({
    authToken: (await loadLocalAuthToken("slack@nakama.internal")) ?? undefined,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
  });
  await client.listUserOrgs();

  const identity = await callSlackApi<{ team_id: string; user_id: string }>(
    "auth.test",
    config.botToken
  );

  const sessionStore = new ChannelSessionStore(
    join(getSlackConfigDir(owner), "chat-sessions.json")
  );
  await sessionStore.load();

  const handleEvent = createChatHandler({
    botTeamId: identity.team_id,
    botUserId: identity.user_id,
    client,
    owner,
    sessionStore,
    slack: createSlackApi(config.botToken),
  });

  closeSocket = connectSlackSocket({
    appToken: config.appToken,
    onEvent: (event) => {
      if (process.env.NAKAMA_CH_DEBUG === "1") {
        console.log(
          `[slack] ${event.type} channel_type=${event.channel_type} subtype=${event.subtype ?? "-"} user=${event.user ?? "-"} thread=${event.thread_ts ? "yes" : "no"}`
        );
      }
      handleEvent(event).catch((error) => {
        console.error("Slack message handler error:", error);
      });
    },
    onStatus: (next) => {
      connected = next;
      void heartbeat.write(connected);
    },
  }).close;

  await heartbeat.write(connected);
  heartbeatTimer = setInterval(() => {
    void heartbeat.write(connected);
  }, 15_000);

  log("info", "worker.started", { worker: "slack" });
  console.log(`Server: ${serverUrl}`);
  console.log(`Agent: ${owner.profileId}`);
  console.log(`Bot user: ${identity.user_id}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
}
