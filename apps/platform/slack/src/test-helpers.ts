import { join } from "node:path";
import type { NakamaClient } from "@nakama/client";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { createDefaultTestOrgs } from "@nakama/core/channel-test-helpers";
import { type SlackMember, saveSlackConfig } from "@nakama/core/slack-config";
import { createChatHandler, type SlackApi } from "./chat-handler";
import type { SlackMessageEvent } from "./socket";

export const BOT = "UBOT0001";

export const OWNER = "UOWNER01";

export type Posted = { channel: string; text: string; threadTs?: string };

export const TEAM = "T0HOME01";

export const ORG = "org_test";

export const OWNER_AGENT = { orgId: ORG, profileId: "default" };

type StreamHandlers = {
  onChunk: (delta: string) => void;
  onToolStart?: () => void;
};

export type FakeStream = (
  handlers: StreamHandlers,
  signal: AbortSignal
) => Promise<string>;

export function createHarness(
  homeDir: string,
  orgs = createDefaultTestOrgs(),
  members: Record<string, SlackMember> = {},
  options: { postDelayMs?: (text: string) => number; stream?: FakeStream } = {}
) {
  const posted: Posted[] = [];
  const turns: string[] = [];
  const orgRequests: Array<string | null> = [];

  const slack: SlackApi = {
    addReaction: async () => {},
    getMember: async (userId) => {
      const member = members[userId];

      if (!member) {
        throw new Error("Slack users.info failed: user_not_found");
      }

      return member;
    },
    postMessage: async (channel, text, threadTs) => {
      await Bun.sleep(options.postDelayMs?.(text) ?? 0);
      posted.push({ channel, text, threadTs });
    },
    removeReaction: async () => {},
  };

  let sessionCount = 0;

  const createSession = () => {
    sessionCount += 1;
    const id = `session_${sessionCount}`;

    return {
      clear: async () => {},
      getMessages: async () => [],
      id,
      sendStream: async (
        input: { message: string },
        handlers: StreamHandlers,
        streamOptions?: { signal?: AbortSignal }
      ) => {
        turns.push(input.message);

        if (options.stream && streamOptions?.signal) {
          return options.stream(handlers, streamOptions.signal);
        }

        handlers.onChunk(`reply from ${id}`);

        return `reply from ${id}`;
      },
    };
  };

  // SAFETY: The handler calls only the methods supplied by this mock.
  const client = {
    createChatSession: () => createSession(),
    createSession: async () => createSession(),
    forOrg: (orgId: string | null) => {
      orgRequests.push(orgId);

      return client;
    },
    getModels: async () => ({ provider: "openai" }),
    health: async () => ({ ok: true, providerConfigured: true }),
    listProfiles: async () => ({
      profiles: [{ id: "default", isDefault: true, name: "Default" }],
    }),
    listUserOrgs: async () => ({ orgs }),
    setOrgId: () => {},
  } as NakamaClient;

  const sessionStore = new ChannelSessionStore(
    join(
      homeDir,
      ".nakama",
      "orgs",
      ORG,
      "channels",
      "default",
      "slack",
      "chat-sessions.json"
    )
  );

  const handle = createChatHandler({
    botTeamId: TEAM,
    botUserId: BOT,
    client,
    owner: OWNER_AGENT,
    sessionStore,
    slack,
  });

  return { handle, orgRequests, posted, sessionStore, turns };
}

export function message(
  fields: Partial<SlackMessageEvent> & { text: string }
): SlackMessageEvent {
  return {
    channel: "C0CHANNEL",
    channel_type: "channel",
    ts: "100.000",
    type: "message",
    user: OWNER,
    ...fields,
  };
}

export async function saveTokens(allowedUserIds = "") {
  await saveSlackConfig(OWNER_AGENT, {
    allowedUserIds,
    appToken: "xapp-1-test",
    botToken: "xoxb-test",
  });
}
