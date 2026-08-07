import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
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

export function createMultiTestOrgs(): UserOrgSummary[] {
  const now = new Date().toISOString();
  return [
    {
      id: "org_a",
      name: "Personal",
      slug: "helipod",
      role: "admin",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "org_b",
      name: "Tinyclaw",
      slug: "tinyclaw",
      role: "member",
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

export interface MockGuildChatMessage {
  message: Message;
  channelSentMessages: string[];
  threadSentMessages: string[];
  startThreadCalls: number;
  createdThreadId: string | null;
  channelFileSendCalls: number;
  threadFileSendCalls: number;
  lastThreadName: string | null;
}

let guildThreadSeq = 0;

export function createGuildChatMessage(options: {
  userId?: string;
  channelId?: string;
  threadId?: string;
  parentId?: string;
  content?: string;
  mentionsBot?: boolean;
  replyToBot?: boolean;
  inThread?: boolean;
  startThreadError?: Error;
  existingThreads?: Map<
    string,
    {
      id: string;
      archived?: boolean;
      parentId?: string;
    }
  >;
}): MockGuildChatMessage {
  const channelSentMessages: string[] = [];
  const threadSentMessages: string[] = [];
  let startThreadCalls = 0;
  let createdThreadId: string | null = null;
  let lastThreadName: string | null = null;
  let channelFileSendCalls = 0;
  let threadFileSendCalls = 0;

  const userId = options.userId ?? "424242424242424242";
  const channelId = options.channelId ?? "guild_channel_1";
  const threadId = options.threadId ?? "thread_1";
  const parentId = options.parentId ?? channelId;
  const botId = "bot_id";
  const existingThreads = options.existingThreads ?? new Map();

  const messages = new Map<string, { author: { id: string } }>();
  if (options.replyToBot) {
    messages.set("reply_1", { author: { id: botId } });
  }

  function createThreadChannel(id: string, parent: string, archived = false) {
    return {
      id,
      parentId: parent,
      archived,
      isDMBased: () => false,
      isTextBased: () => true,
      isThread: () => true,
      setArchived: async (value: boolean) => {
        archived = value;
        return createThreadChannel(id, parent, archived);
      },
      send: async (payload: string | { files: unknown[] }) => {
        if (typeof payload === "string") {
          threadSentMessages.push(payload);
          return { id: `tmsg_${threadSentMessages.length}` };
        }

        threadFileSendCalls += 1;
        return { id: `tfile_${threadFileSendCalls}` };
      },
      sendTyping: async () => {},
      messages: {
        cache: messages,
        fetch: async () => ({
          edit: async () => {},
        }),
      },
    };
  }

  const parentChannel = {
    id: channelId,
    parentId: null as string | null,
    isDMBased: () => false,
    isTextBased: () => true,
    isThread: () => false,
    send: async (payload: string | { files: unknown[] }) => {
      if (typeof payload === "string") {
        channelSentMessages.push(payload);
        return { id: `cmsg_${channelSentMessages.length}` };
      }

      channelFileSendCalls += 1;
      return { id: `cfile_${channelFileSendCalls}` };
    },
    sendTyping: async () => {},
    messages: {
      cache: messages,
      fetch: async () => ({
        edit: async () => {},
      }),
    },
    threads: {
      create: async ({ name }: { name: string }) => {
        startThreadCalls += 1;
        lastThreadName = name;
        if (options.startThreadError) {
          throw options.startThreadError;
        }

        guildThreadSeq += 1;
        createdThreadId = `created_thread_${guildThreadSeq}`;
        const thread = createThreadChannel(createdThreadId, channelId, false);
        existingThreads.set(createdThreadId, {
          id: createdThreadId,
          parentId: channelId,
          archived: false,
        });
        return thread;
      },
    },
  };

  const channel = options.inThread
    ? createThreadChannel(threadId, parentId, false)
    : parentChannel;

  const clientChannels = {
    fetch: async (id: string) => {
      const known = existingThreads.get(id);
      if (known) {
        return createThreadChannel(known.id, known.parentId ?? parentId, known.archived ?? false);
      }

      if (createdThreadId && id === createdThreadId) {
        return createThreadChannel(createdThreadId, channelId, false);
      }

      throw new Error(`Unknown channel ${id}`);
    },
  };

  const message = {
    author: { id: userId, bot: false },
    content: options.content ?? "",
    mentions: {
      users: {
        has: (id: string) => (options.mentionsBot ? id === botId : false),
      },
    },
    reference: options.replyToBot ? { messageId: "reply_1" } : null,
    channel,
    client: {
      user: { id: botId, username: "nakamabot" },
      channels: clientChannels,
    },
    startThread: async ({ name }: { name: string }) => {
      startThreadCalls += 1;
      lastThreadName = name;
      if (options.startThreadError) {
        throw options.startThreadError;
      }

      guildThreadSeq += 1;
      createdThreadId = `created_thread_${guildThreadSeq}`;
      const thread = createThreadChannel(createdThreadId, channelId, false);
      existingThreads.set(createdThreadId, {
        id: createdThreadId,
        parentId: channelId,
        archived: false,
      });
      return thread;
    },
  } as unknown as Message;

  return {
    message,
    channelSentMessages,
    threadSentMessages,
    get startThreadCalls() {
      return startThreadCalls;
    },
    get createdThreadId() {
      return createdThreadId;
    },
    get lastThreadName() {
      return lastThreadName;
    },
    get channelFileSendCalls() {
      return channelFileSendCalls;
    },
    get threadFileSendCalls() {
      return threadFileSendCalls;
    },
  };
}

export function createSlashInteraction(options: {
  userId?: string;
  channelId?: string;
  commandName: string;
  inThread?: boolean;
  parentId?: string;
  threadId?: string;
  startThreadError?: Error;
}): {
  interaction: import("discord.js").ChatInputCommandInteraction;
  replies: string[];
  createdThreadId: string | null;
  startThreadCalls: number;
} {
  const replies: string[] = [];
  const userId = options.userId ?? "424242424242424242";
  const channelId = options.channelId ?? "guild_channel_1";
  const threadId = options.threadId ?? "thread_1";
  const parentId = options.parentId ?? channelId;
  let createdThreadId: string | null = null;
  let startThreadCalls = 0;

  const channel = options.inThread
    ? {
        id: threadId,
        parentId,
        archived: false,
        isDMBased: () => false,
        isThread: () => true,
        setArchived: async (value: boolean) => {
          channel.archived = value;
          return channel;
        },
      }
    : {
        id: channelId,
        parentId: null,
        isDMBased: () => false,
        isThread: () => false,
        threads: {
          create: async ({ name }: { name: string }) => {
            startThreadCalls += 1;
            if (options.startThreadError) {
              throw options.startThreadError;
            }
            createdThreadId = `slash_thread_${startThreadCalls}`;
            return {
              id: createdThreadId,
              parentId: channelId,
              name,
              isThread: () => true,
              isDMBased: () => false,
            };
          },
        },
      };

  const interaction = {
    user: { id: userId },
    channelId: options.inThread ? threadId : channelId,
    channel,
    commandName: options.commandName,
    reply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
    followUp: async ({ content }: { content: string }) => {
      replies.push(content);
    },
    editReply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
  } as unknown as import("discord.js").ChatInputCommandInteraction;

  return {
    interaction,
    replies,
    get createdThreadId() {
      return createdThreadId;
    },
    get startThreadCalls() {
      return startThreadCalls;
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

let tempHomeChain: Promise<void> = Promise.resolve();

export async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = tempHomeChain;
  tempHomeChain = previous.then(() => gate);

  await previous;

  const homeDir = await mkdtemp(path.join(os.tmpdir(), "nakama-discord-home-"));
  const configDir = path.join(homeDir, ".nakama");
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  process.env.NAKAMA_CONFIG_DIR = configDir;

  try {
    return await run(homeDir);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }

    await rm(homeDir, { recursive: true, force: true });
    release();
  }
}
