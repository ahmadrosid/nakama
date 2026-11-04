import { join } from "node:path";
import type { NakamaClient } from "@nakama/client";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { createDefaultTestOrgs } from "@nakama/core/channel-test-helpers";
import type { TeamsConfigFile } from "@nakama/core/teams-config";
import { createTeamsChatHandler, type TeamsActivity } from "./chat-handler";

const ORG = "org_test";

export const OWNER = { orgId: ORG, profileId: "default" };

export const TENANT = "33333333-3333-4333-8333-333333333333";

export const ALLOWED = "11111111-1111-4111-8111-111111111111";

export const CONFIG: TeamsConfigFile = {
  allowedUserIds: [ALLOWED],
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "secret",
  handshakeCode: null,
  handshakeExpiresAt: null,
  inboundPort: 4321,
  pairedUserIds: [],
  profileId: "default",
  tenantId: TENANT,
};

export function activity(patch: Partial<TeamsActivity> = {}): TeamsActivity {
  return {
    channelId: "msteams",
    conversationId: "conv_1",
    conversationType: "personal",
    id: `act_${Math.random().toString(16).slice(2)}`,
    isBot: false,
    senderId: ALLOWED,
    tenantId: TENANT,
    text: "hello",
    ...patch,
  };
}

export function createHarness(
  homeDir: string,
  options: {
    beforeCreateSession?: () => Promise<void>;
    beforeGetModels?: () => Promise<void>;
    beforeReply?: (text: string) => Promise<void>;
    config?: TeamsConfigFile | null;
    health?: () => Promise<{ ok: boolean; providerConfigured: boolean }>;
    loadConfig?: () => Promise<TeamsConfigFile | null>;
    onSend?: (
      message: string,
      signal?: AbortSignal,
      onChunk?: (delta: string) => void
    ) => Promise<string>;
  } = {}
) {
  const turns: { message: string; sessionId: string }[] = [];
  const replies: { conversationId: string; text: string }[] = [];
  const createdSessions: string[] = [];
  const clearedSessions: string[] = [];
  let nextSession = 0;

  const makeSession = (sessionId: string) => ({
    clear: async () => {
      clearedSessions.push(sessionId);
    },
    getMessages: async () => [],
    id: sessionId,
    sendStream: async (
      input: { message: string },
      // The Teams handler always passes a plain chunk callback.
      onChunk: (delta: string) => void,
      streamOptions?: { signal?: AbortSignal }
    ) => {
      turns.push({ message: input.message, sessionId });

      return options.onSend
        ? await options.onSend(input.message, streamOptions?.signal, onChunk)
        : `echo: ${input.message}`;
    },
  });

  // SAFETY: The handler calls only these client methods, and the fake answers
  // each one the way the real client does.
  const client = {
    createChatSession: (sessionId: string) => makeSession(sessionId),
    createSession: async () => {
      await options.beforeCreateSession?.();
      nextSession += 1;
      const id = `session_${nextSession}`;

      createdSessions.push(id);

      return makeSession(id);
    },
    forOrg: (_orgId: string | null) => client,
    getModels: async () => {
      await options.beforeGetModels?.();

      return { provider: "test-provider" };
    },
    health:
      options.health ?? (async () => ({ ok: true, providerConfigured: true })),
    listProfiles: async () => ({
      profiles: [
        { id: "default", model: "test-provider::test-model", name: "Helper" },
      ],
    }),
    listUserOrgs: async () => ({ orgs: createDefaultTestOrgs() }),
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
      "teams",
      "chat-sessions.json"
    )
  );

  const handle = createTeamsChatHandler({
    client,
    loadConfig:
      options.loadConfig ??
      (async () => (options.config === undefined ? CONFIG : options.config)),
    owner: OWNER,
    send: async (conversationId, text) => {
      await options.beforeReply?.(text);
      replies.push({ conversationId, text });
    },
    sessionStore,
  });

  return {
    clearedSessions,
    createdSessions,
    handle,
    replies,
    sessionStore,
    turns,
  };
}
