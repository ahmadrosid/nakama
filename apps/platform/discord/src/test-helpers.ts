import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NakamaClient, StreamHandlers } from "@nakama/client";
import {
  assertBridgeClientMethods,
  parseListProfilesResponse,
  parseListUserOrgsResponse,
} from "@nakama/core/bridge-api";
import type { ChannelOrgStore } from "@nakama/core/channel-org";
import {
  createDefaultTestOrgs,
  createTestOrgStore as createSharedTestOrgStore,
  withTempHome as withSharedTempHome,
} from "@nakama/core/channel-test-helpers";
import type {
  AgentQuestionnaire,
  ChatMessage,
  UserOrgSummary,
} from "@nakama/core/contract";
import type { Message } from "discord.js";

export function createMultiTestOrgs(): UserOrgSummary[] {
  const now = new Date().toISOString();
  return [
    {
      createdAt: now,
      id: "org_a",
      name: "Personal",
      role: "admin",
      slug: "helipod",
      updatedAt: now,
    },
    {
      createdAt: now,
      id: "org_b",
      name: "Nakama",
      role: "member",
      slug: "nakama",
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
    listedArtifacts?: Array<{
      filename: string;
      mimeType: string;
      path: string;
      sizeBytes: number;
      updatedAt: string;
    }>;
    onSendStream?: (
      input: unknown,
      handlers?: StreamHandlers
    ) => Promise<string>;
    artifactContentBytes?: Uint8Array;
  } = {}
) {
  const calls = {
    createChatSession: 0,
    createSession: 0,
    getMessages: 0,
    getSessionMessages: 0,
    listProfileArtifacts: 0,
    publishProfileArtifactShare: 0,
    readProfileArtifactContent: 0,
    sendStream: 0,
  };
  const createdSessionProfileIds: string[] = [];

  const sendStream = async (input: unknown, handlers?: StreamHandlers) => {
    calls.sendStream += 1;
    if (options.onSendStream) {
      return options.onSendStream(input, handlers);
    }
    return "Agent reply";
  };

  const session = {
    clear: async () => {},
    compact: async () => ({
      action: "summarized" as const,
      messagesAfter: 4,
      messagesBefore: 10,
    }),
    createAutomation: async () => ({}),
    getMessages: async () => {
      calls.getMessages += 1;
      return options.messages ?? [];
    },
    id: "session_test",
    purge: async () => {},
    send: async () => "ok",
    sendStream,
  };

  const profiles = options.profiles ?? [{ id: "default", model: null }];
  const orgs = options.orgs ?? createDefaultTestOrgs();
  let activeOrgId: string | null = orgs[0]?.id ?? null;

  const client = {
    createChatSession: () => {
      calls.createChatSession += 1;
      return session;
    },
    createSession: async (_channel: string, input?: { profileId?: string }) => {
      calls.createSession += 1;
      if (input?.profileId) {
        createdSessionProfileIds.push(input.profileId);
      }
      return session;
    },
    getModels: async () => ({
      currentProviderId: null,
      displayName: null,
      models: [],
      provider: null,
      providers: [],
    }),
    getSessionMessages: async () => {
      calls.getSessionMessages += 1;
      return {
        channel: "discord" as const,
        messageMeta: [],
        messages: options.messages ?? [],
        questionnaire: options.questionnaire ?? null,
        todos: [],
      };
    },
    health: async () => ({ ok: true, providerConfigured: false }),
    listProfileArtifacts: async () => {
      calls.listProfileArtifacts += 1;
      const artifacts = options.listedArtifacts ?? [];
      return {
        artifacts,
        directory: "/tmp/artifacts",
        profileId: "default",
        total: artifacts.length,
      };
    },
    listProfiles: async () =>
      parseListProfilesResponse({
        profiles: profiles.map((profile) => ({
          id: profile.id,
          isDefault: profile.isDefault ?? false,
          isSuper: profile.isSuper ?? false,
          model: profile.model ?? null,
          name: profile.name ?? profile.id,
        })),
      }),
    listUserOrgs: async () => parseListUserOrgsResponse({ orgs }),
    publishProfileArtifactShare: async () => {
      calls.publishProfileArtifactShare += 1;
      return {
        id: "share_test",
        refreshed: false,
        sharePath: "/s/tok_test",
        shareUrl: "https://app.example/s/tok_test",
        token: "tok_test",
        webPublicUrlConfigured: true,
      };
    },
    readProfileArtifactContent: async () => {
      calls.readProfileArtifactContent += 1;
      const data =
        options.artifactContentBytes ?? new TextEncoder().encode("# Report");
      return {
        contentType: "text/markdown",
        data: data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength
        ),
      };
    },
    setOrgId: (orgId: string | null) => {
      activeOrgId = orgId?.trim() || null;
    },
  } as unknown as NakamaClient;

  assertBridgeClientMethods(client);

  return { calls, client, createdSessionProfileIds };
}

export interface MockDmMessage {
  fileSendCalls: number;
  message: Message;
  sentMessages: string[];
}

type MockAttachmentInput = {
  contentType?: string | null;
  name?: string;
  size?: number;
  url?: string;
};

function buildMockAttachments(inputs: MockAttachmentInput[] | undefined): Map<
  string,
  {
    contentType: string | null;
    name: string;
    size: number;
    url: string;
  }
> {
  const attachments = new Map<
    string,
    {
      contentType: string | null;
      name: string;
      size: number;
      url: string;
    }
  >();

  for (const [index, attachment] of (inputs ?? []).entries()) {
    attachments.set(String(index + 1), {
      contentType: attachment.contentType ?? "image/png",
      name: attachment.name ?? `image-${index + 1}.png`,
      size: attachment.size ?? 32,
      url: attachment.url ?? `https://cdn.example/image-${index + 1}.png`,
    });
  }

  return attachments;
}

export function createDmMessage(options: {
  userId?: string;
  channelId?: string;
  content?: string;
  attachments?: MockAttachmentInput[];
}): MockDmMessage {
  const sentMessages: string[] = [];
  let fileSendCalls = 0;
  const channelId = options.channelId ?? "dm_channel_1";

  const channel = {
    id: channelId,
    isDMBased: () => true,
    isTextBased: () => true,
    isThread: () => false,
    messages: {
      fetch: async () => ({
        edit: async () => {},
      }),
    },
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
  };

  const message = {
    attachments: buildMockAttachments(options.attachments),
    author: { bot: false, id: options.userId ?? "424242424242424242" },
    channel,
    client: { user: { id: "bot_id", username: "nakamabot" } },
    content: options.content ?? "",
    stickers: { size: 0 },
  } as unknown as Message;

  return {
    get fileSendCalls() {
      return fileSendCalls;
    },
    message,
    sentMessages,
  };
}

export interface MockGuildChatMessage {
  channelFileSendCalls: number;
  channelSentMessages: string[];
  createdThreadId: string | null;
  lastThreadName: string | null;
  message: Message;
  startThreadCalls: number;
  threadFileSendCalls: number;
  threadSentMessages: string[];
}

export function createGuildChatMessage(options: {
  userId?: string;
  channelId?: string;
  threadId?: string;
  /** Pass `null` to simulate a partial thread channel with missing parentId. */
  parentId?: string | null;
  /** Parent id returned by channel.fetch() when initial parentId is null. */
  fetchParentId?: string;
  content?: string;
  attachments?: MockAttachmentInput[];
  mentionsBot?: boolean;
  mentionedRoleIds?: string[];
  botHeldRoleIds?: string[];
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
  const mockInstanceId = `m${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const userId = options.userId ?? "424242424242424242";
  const channelId = options.channelId ?? "guild_channel_1";
  const threadId = options.threadId ?? "thread_1";
  const parentId =
    options.parentId === null ? null : (options.parentId ?? channelId);
  const fetchParentId = options.fetchParentId ?? channelId;
  const botId = "bot_id";
  const guildId = "guild_1";
  const mentionedRoleIds = options.mentionedRoleIds ?? [];
  const botHeldRoleIds = new Set(options.botHeldRoleIds ?? []);
  const existingThreads = options.existingThreads ?? new Map();

  const messages = new Map<string, { author: { id: string } }>();
  if (options.replyToBot) {
    messages.set("reply_1", { author: { id: botId } });
  }

  function createThreadChannel(
    id: string,
    parent: string | null,
    archived = false
  ) {
    const channel = {
      archived,
      fetch: async () => createThreadChannel(id, fetchParentId, archived),
      id,
      isDMBased: () => false,
      isTextBased: () => true,
      isThread: () => true,
      messages: {
        cache: messages,
        fetch: async () => ({
          edit: async () => {},
        }),
      },
      parentId: parent,
      partial: parent === null,
      send: async (payload: string | { files: unknown[] }) => {
        if (typeof payload === "string") {
          threadSentMessages.push(payload);
          return { id: `tmsg_${threadSentMessages.length}` };
        }

        threadFileSendCalls += 1;
        return { id: `tfile_${threadFileSendCalls}` };
      },
      sendTyping: async () => {},
      setArchived: async (value: boolean) => {
        archived = value;
        return createThreadChannel(id, parent, archived);
      },
    };
    return channel;
  }

  const parentChannel = {
    id: channelId,
    isDMBased: () => false,
    isTextBased: () => true,
    isThread: () => false,
    messages: {
      cache: messages,
      fetch: async () => ({
        edit: async () => {},
      }),
    },
    parentId: null as string | null,
    send: async (payload: string | { files: unknown[] }) => {
      if (typeof payload === "string") {
        channelSentMessages.push(payload);
        return { id: `cmsg_${channelSentMessages.length}` };
      }

      channelFileSendCalls += 1;
      return { id: `cfile_${channelFileSendCalls}` };
    },
    sendTyping: async () => {},
  };

  const channel = options.inThread
    ? createThreadChannel(threadId, parentId, false)
    : parentChannel;

  const clientChannels = {
    fetch: async (id: string) => {
      const known = existingThreads.get(id);
      if (known) {
        return createThreadChannel(
          known.id,
          known.parentId ?? parentId,
          known.archived ?? false
        );
      }

      if (createdThreadId && id === createdThreadId) {
        return createThreadChannel(createdThreadId, channelId, false);
      }

      throw new Error(`Unknown channel ${id}`);
    },
  };

  const message = {
    attachments: buildMockAttachments(options.attachments),
    author: { bot: false, id: userId },
    channel,
    client: {
      channels: clientChannels,
      user: { id: botId, username: "nakamabot" },
    },
    content: options.content ?? "",
    guild: {
      id: guildId,
      members: {
        me: {
          roles: {
            cache: {
              has: (id: string) => botHeldRoleIds.has(id),
            },
          },
        },
      },
    },
    mentions: {
      roles: {
        keys: () => mentionedRoleIds.values(),
      },
      users: {
        has: (id: string) => (options.mentionsBot ? id === botId : false),
      },
    },
    reference: options.replyToBot ? { messageId: "reply_1" } : null,
    startThread: async ({ name }: { name: string }) => {
      startThreadCalls += 1;
      lastThreadName = name;
      if (options.startThreadError) {
        throw options.startThreadError;
      }

      createdThreadId = `created_thread_${mockInstanceId}_${startThreadCalls}`;
      const thread = createThreadChannel(createdThreadId, channelId, false);
      existingThreads.set(createdThreadId, {
        archived: false,
        id: createdThreadId,
        parentId: channelId,
      });
      return thread;
    },
    stickers: { size: 0 },
  } as unknown as Message;

  return {
    get channelFileSendCalls() {
      return channelFileSendCalls;
    },
    channelSentMessages,
    get createdThreadId() {
      return createdThreadId;
    },
    get lastThreadName() {
      return lastThreadName;
    },
    message,
    get startThreadCalls() {
      return startThreadCalls;
    },
    get threadFileSendCalls() {
      return threadFileSendCalls;
    },
    threadSentMessages,
  };
}

export function createSlashInteraction(options: {
  userId?: string;
  channelId?: string;
  commandName: string;
  inThread?: boolean;
  /** Pass `null` to simulate a partial thread channel with missing parentId. */
  parentId?: string | null;
  /** Parent id returned by channel.fetch() when initial parentId is null. */
  fetchParentId?: string;
  threadId?: string;
  /** Resolved USER option for commands like /allow. Pass `null` for missing. */
  userOption?: { id: string; username?: string } | null;
}): {
  interaction: import("discord.js").ChatInputCommandInteraction;
  replies: string[];
} {
  const replies: string[] = [];
  const userId = options.userId ?? "424242424242424242";
  const channelId = options.channelId ?? "guild_channel_1";
  const threadId = options.threadId ?? "thread_1";
  const parentId =
    options.parentId === null ? null : (options.parentId ?? channelId);
  const fetchParentId = options.fetchParentId ?? channelId;
  const hasUserOption = options.userOption !== undefined;

  const channel = options.inThread
    ? {
        archived: false,
        fetch: async () => ({
          archived: false,
          id: threadId,
          isDMBased: () => false,
          isThread: () => true,
          parentId: fetchParentId,
        }),
        id: threadId,
        isDMBased: () => false,
        isThread: () => true,
        parentId,
        partial: parentId === null,
        setArchived: async (value: boolean) => {
          channel.archived = value;
          return channel;
        },
      }
    : {
        id: channelId,
        isDMBased: () => false,
        isThread: () => false,
        parentId: null,
      };

  const interaction = {
    channel,
    channelId: options.inThread ? threadId : channelId,
    commandName: options.commandName,
    deleteReply: async () => {
      replies.push("__deleted__");
    },
    editReply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
    followUp: async ({ content }: { content: string }) => {
      replies.push(content);
    },
    options: {
      getUser: (name: string) => {
        if (name !== "user" || !hasUserOption) {
          return null;
        }

        return options.userOption;
      },
    },
    reply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
    user: { id: userId },
  } as unknown as import("discord.js").ChatInputCommandInteraction;

  return { interaction, replies };
}

export async function writeDiscordConfigIni(
  homeDir: string,
  config: {
    botToken: string;
    profileId?: string;
    pairedUserIds?: string[];
    allowedUserIds?: string[];
  }
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

  if (config.allowedUserIds?.length) {
    lines.push(`allowed_user_ids=${config.allowedUserIds.join(",")}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}

export { createDefaultTestOrgs };

export function createTestOrgStore(homeDir: string): ChannelOrgStore {
  return createSharedTestOrgStore(homeDir, "discord");
}

export async function withTempHome<T>(
  run: (homeDir: string) => Promise<T>
): Promise<T> {
  return withSharedTempHome("nakama-discord-home-", run);
}
