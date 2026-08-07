import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { spyOn } from "bun:test";
import type { AgentQuestionnaire, ChatMessage } from "@nakama/core/contract";
import type { UserOrgSummary } from "@nakama/core/contract";
import {
  assertBridgeClientMethods,
  parseListProfilesResponse,
  parseListUserOrgsResponse,
} from "@nakama/core/bridge-api";
import { ChannelOrgStore } from "@nakama/core/channel-org";
import type { NakamaClient, StreamHandlers } from "@nakama/client";
import type { Message } from "discord.js";

export function createDefaultTestOrgs(): UserOrgSummary[] {
  const now = new Date().toISOString();
  return [
    {
      id: "org_test",
      name: "Test Org",
      slug: "test-org",
      role: "admin",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createMockClient(
  options: {
    messages?: ChatMessage[];
    questionnaire?: AgentQuestionnaire | null;
    profiles?: Array<{
      id: string;
      name?: string;
      model?: string | null;
      isDefault?: boolean;
      isSuper?: boolean;
    }>;
    orgs?: UserOrgSummary[];
    onSendStream?: (input: unknown, handlers?: StreamHandlers) => Promise<string>;
    artifactContentBytes?: Uint8Array;
  } = {},
) {
  const calls = {
    createSession: 0,
    sendStream: 0,
    getSessionMessages: 0,
    publishProfileArtifactShare: 0,
    readProfileArtifactContent: 0,
  };

  const sendStream = async (input: unknown, handlers?: StreamHandlers) => {
    calls.sendStream += 1;
    if (options.onSendStream) {
      return options.onSendStream(input, handlers);
    }
    return "Agent reply";
  };

  const session = {
    id: "session_test",
    sendStream,
    compact: async () => ({
      action: "summarized" as const,
      messagesBefore: 10,
      messagesAfter: 4,
    }),
    getMessages: async () => options.messages ?? [],
    clear: async () => {},
    send: async () => "ok",
    purge: async () => {},
    createAutomation: async () => ({}),
  };

  const profiles = options.profiles ?? [{ id: "default", model: null }];
  const orgs = options.orgs ?? createDefaultTestOrgs();
  let activeOrgId: string | null = orgs[0]?.id ?? null;

  const client = {
    createSession: async () => {
      calls.createSession += 1;
      return session;
    },
    createChatSession: () => session,
    getSessionMessages: async () => {
      calls.getSessionMessages += 1;
      return {
        channel: "discord" as const,
        messages: options.messages ?? [],
        messageMeta: [],
        todos: [],
        questionnaire: options.questionnaire ?? null,
      };
    },
    health: async () => ({ ok: true, providerConfigured: false }),
    listProfiles: async () =>
      parseListProfilesResponse({
        profiles: profiles.map((profile) => ({
          id: profile.id,
          name: profile.name ?? profile.id,
          model: profile.model ?? null,
          isDefault: profile.isDefault ?? false,
          isSuper: profile.isSuper ?? false,
        })),
      }),
    listUserOrgs: async () => parseListUserOrgsResponse({ orgs }),
    setOrgId: (orgId: string | null) => {
      activeOrgId = orgId?.trim() || null;
    },
    getModels: async () => ({
      provider: null,
      currentProviderId: null,
      providers: [],
      models: [],
      displayName: null,
    }),
    publishProfileArtifactShare: async () => {
      calls.publishProfileArtifactShare += 1;
      return {
        id: "share_test",
        token: "tok_test",
        shareUrl: "https://app.example/s/tok_test",
        sharePath: "/s/tok_test",
        webPublicUrlConfigured: true,
        refreshed: false,
      };
    },
    readProfileArtifactContent: async () => {
      calls.readProfileArtifactContent += 1;
      const data = options.artifactContentBytes ?? new TextEncoder().encode("# Report");
      return {
        contentType: "text/markdown",
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      };
    },
  } as unknown as NakamaClient;

  assertBridgeClientMethods(client);

  return { client, calls };
}

export interface MockDmMessage {
  message: Message;
  sentMessages: string[];
  fileSendCalls: number;
}

export function createDmMessage(options: {
  userId?: string;
  channelId?: string;
  content?: string;
}): MockDmMessage {
  const sentMessages: string[] = [];
  let fileSendCalls = 0;
  const channelId = options.channelId ?? "dm_channel_1";

  const channel = {
    id: channelId,
    isDMBased: () => true,
    isTextBased: () => true,
    isThread: () => false,
    parentId: null,
    send: async (payload: string | { files: unknown[] }) => {
      if (typeof payload === "string") {
        sentMessages.push(payload);
        return { id: String(sentMessages.length) };
      }

      fileSendCalls += 1;
      return { id: String(sentMessages.length) };
    },
    sendTyping: async () => {},
    messages: {
      fetch: async () => ({
        edit: async () => {},
      }),
    },
  };

  const message = {
    author: { id: options.userId ?? "424242424242424242", bot: false },
    content: options.content ?? "",
    channel,
    client: { user: { id: "bot_id", username: "nakamabot" } },
  } as unknown as Message;

  return {
    message,
    sentMessages,
    get fileSendCalls() {
      return fileSendCalls;
    },
  };
}

export async function writeDiscordConfigIni(
  homeDir: string,
  config: {
    botToken: string;
    profileId?: string;
    pairedUserIds?: string[];
  },
): Promise<void> {
  const dir = path.join(homeDir, ".nakama", "discord");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# Nakama Discord bridge",
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId ?? "default"}`,
  ];

  if (config.pairedUserIds?.length) {
    lines.push(`paired_user_ids=${config.pairedUserIds.join(",")}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}

export function createTestOrgStore(homeDir: string): ChannelOrgStore {
  return new ChannelOrgStore(path.join(homeDir, ".nakama", "discord", "org-selection.json"));
}

export async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "nakama-discord-home-"));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

  try {
    return await run(homeDir);
  } finally {
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
  }
}
