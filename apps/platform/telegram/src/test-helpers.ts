import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { spyOn } from "bun:test";
import type { NakamaClient } from "@nakama/client";
import type { AgentTodo, UserOrgSummary } from "@nakama/core/contract";
import {
  assertBridgeClientMethods,
  parseListProfilesResponse,
  parseListUserOrgsResponse,
} from "@nakama/core/bridge-api";
import { ChannelOrgStore } from "@nakama/core/channel-org";
import type { StreamHandlers } from "@nakama/client";
import type { Context } from "grammy";
import type { TelegramBotInfo } from "./group-message";

export const TEST_BOT_INFO: TelegramBotInfo = { id: 999, username: "mybot" };

export interface MockMessageContext {
  ctx: Context;
  replies: string[];
  replyOptions: unknown[];
  edits: Array<{ chatId: number; messageId: number; text: string }>;
  editOptions: unknown[];
}

export function createMessageContext(options: {
  userId?: number;
  chatId?: number;
  text?: string;
  chatType?: "private" | "group" | "supergroup";
  entities?: Array<{ type: "mention"; offset: number; length: number }>;
  replyToBot?: boolean;
  replyToBotId?: number;
  failRichReply?: boolean;
  failRichEdit?: boolean;
  messageThreadId?: number;
}): MockMessageContext {
  const replies: string[] = [];
  const replyOptions: unknown[] = [];
  const edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  const editOptions: unknown[] = [];
  let nextMessageId = 1;
  const replyFrom =
    options.replyToBot || options.replyToBotId !== undefined
      ? {
          id: options.replyToBotId ?? 999,
          is_bot: true as const,
        }
      : undefined;
  const ctx = {
    chat: options.chatType
      ? { id: options.chatId ?? -100, type: options.chatType }
      : { id: options.chatId ?? options.userId ?? 1, type: "private" as const },
    from: options.userId !== undefined ? { id: options.userId } : undefined,
    message: {
      ...(options.text !== undefined ? { text: options.text } : {}),
      ...(options.entities ? { entities: options.entities } : {}),
      ...(options.messageThreadId !== undefined
        ? { message_thread_id: options.messageThreadId }
        : {}),
      ...(replyFrom ? { reply_to_message: { from: replyFrom } } : {}),
    },
    reply: async (text: string, replyOptionsArg?: unknown) => {
      if (isHtmlParseMode(replyOptionsArg) && options.failRichReply) {
        throw new Error("Rich reply failed");
      }

      replies.push(text);
      replyOptions.push(replyOptionsArg);
      return { message_id: nextMessageId++ };
    },
    replyWithChatAction: async () => {},
    api: {
      editMessageText: async (
        chatId: number,
        messageId: number,
        text: string,
        editOptionsArg?: unknown,
      ) => {
        if (isHtmlParseMode(editOptionsArg) && options.failRichEdit) {
          throw new Error("Rich edit failed");
        }

        edits.push({ chatId, messageId, text });
        editOptions.push(editOptionsArg);
      },
    },
  } as unknown as Context;

  return { ctx, replies, replyOptions, edits, editOptions };
}

function isHtmlParseMode(options: unknown): options is { parse_mode: "HTML" } {
  return Boolean(
    options &&
      typeof options === "object" &&
      "parse_mode" in options &&
      options.parse_mode === "HTML",
  );
}

export interface MockStreamControl {
  complete(reply?: string): void;
  fail(error?: Error): void;
  readonly signal: AbortSignal | undefined;
}

type StreamStep =
  | { type: "todos"; todos: AgentTodo[] }
  | { type: "chunk"; delta: string }
  | { type: "thinking"; delta?: string }
  | { type: "tool_start" }
  | { type: "tool_end" }
  | { type: "error"; message: string }
  | { type: "resolve"; reply?: string };

export function createMultiTestOrgs(): UserOrgSummary[] {
  const now = new Date().toISOString();
  return [
    {
      id: "org_a",
      name: "Acme",
      slug: "acme",
      role: "admin",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "org_b",
      name: "Beta",
      slug: "beta",
      role: "member",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

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
    streaming?: boolean;
    steps?: StreamStep[];
    autoComplete?: boolean;
    providerConfigured?: boolean;
    profiles?: Array<{
      id: string;
      name?: string;
      model?: string | null;
      isDefault?: boolean;
      isSuper?: boolean;
    }>;
    orgs?: UserOrgSummary[];
    profilesByOrgId?: Record<
      string,
      Array<{
        id: string;
        name?: string;
        model?: string | null;
        isDefault?: boolean;
        isSuper?: boolean;
      }>
    >;
  } = {},
) {
  const calls = {
    createSession: 0,
    sendStream: 0,
    compact: 0,
    listProfiles: 0,
    listUserOrgs: 0,
    setOrgId: 0,
    transcribeAudio: 0,
  };
  const orgIds: string[] = [];
  let lastCreateSessionProfileId: string | undefined;
  let lastStreamInput: unknown;

  let streamControl: MockStreamControl | null = null;
  const streamControls: MockStreamControl[] = [];

  const sendStream = async (
    input: unknown,
    handlers: unknown,
    streamOptions?: { signal?: AbortSignal },
  ) => {
    calls.sendStream += 1;
    lastStreamInput = input;

    if (!options.streaming) {
      return "Agent reply";
    }

    const streamHandlers = handlers as StreamHandlers;

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      streamControl = {
        get signal() {
          return streamOptions?.signal;
        },
        complete(reply = "Agent reply") {
          if (settled) {
            return;
          }
          settled = true;
          resolve(reply);
        },
        fail(error = new Error("Stream failed")) {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        },
      };
      streamControls.push(streamControl);

      streamOptions?.signal?.addEventListener(
        "abort",
        () => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );

      queueMicrotask(() => {
        for (const step of options.steps ?? []) {
          if (settled) {
            break;
          }

          switch (step.type) {
            case "todos":
              streamHandlers.onTodosUpdated?.(step.todos);
              break;
            case "chunk":
              streamHandlers.onChunk(step.delta);
              break;
            case "thinking":
              streamHandlers.onThinking?.(step.delta ?? "");
              break;
            case "tool_start":
              streamHandlers.onToolStart?.({
                toolCallId: "tool_call_1",
                tool: "todo_write",
                input: {},
              });
              break;
            case "tool_end":
              streamHandlers.onToolEnd?.({
                toolCallId: "tool_call_1",
                tool: "todo_write",
                result: {},
              });
              break;
            case "error":
              streamControl?.fail(new Error(step.message));
              break;
            case "resolve":
              streamControl?.complete(step.reply);
              break;
          }
        }

        if (!settled && options.steps?.length && options.autoComplete !== false) {
          streamControl?.complete("Agent reply");
        }
      });
    });
  };

  const session = {
    id: "session_test",
    sendStream,
    compact: async () => {
      calls.compact += 1;
      return {
        action: "summarized" as const,
        messagesBefore: 10,
        messagesAfter: 4,
      };
    },
    getMessages: async () => [],
    clear: async () => {},
    send: async () => "ok",
    purge: async () => {},
    createAutomation: async () => ({}),
  };

  const profiles = options.profiles ?? [{ id: "default", model: null }];
  const orgs = options.orgs ?? createDefaultTestOrgs();
  let activeOrgId: string | null = orgs[0]?.id ?? null;

  const client = {
    createSession: async (_channel: string, input?: { profileId?: string }) => {
      calls.createSession += 1;
      lastCreateSessionProfileId = input?.profileId;
      return session;
    },
    createChatSession: () => session,
    health: async () => ({ ok: true, providerConfigured: options.providerConfigured ?? false }),
    listProfiles: async () => {
      calls.listProfiles += 1;
      const scopedProfiles =
        (activeOrgId ? options.profilesByOrgId?.[activeOrgId] : undefined) ?? profiles;

      return parseListProfilesResponse({
        profiles: scopedProfiles.map((profile) => ({
          id: profile.id,
          name: profile.name ?? profile.id,
          model: profile.model ?? null,
          isDefault: profile.isDefault ?? false,
          isSuper: profile.isSuper ?? false,
        })),
      });
    },
    listUserOrgs: async () => {
      calls.listUserOrgs += 1;
      return parseListUserOrgsResponse({ orgs });
    },
    setOrgId: (orgId: string | null) => {
      calls.setOrgId += 1;
      activeOrgId = orgId?.trim() || null;
      orgIds.push(orgId ?? "");
    },
    getModels: async () => ({
      provider: null,
      currentProviderId: null,
      providers: [],
      models: [],
      displayName: null,
    }),
    transcribeAudio: async () => {
      calls.transcribeAudio += 1;
      return { text: "Transcribed voice message" };
    },
  } as unknown as NakamaClient;

  assertBridgeClientMethods(client);

  return {
    client,
    calls,
    orgIds,
    getLastCreateSessionProfileId: () => lastCreateSessionProfileId,
    getLastStreamInput: () => lastStreamInput,
    getStreamControl: () => streamControl,
    getStreamControls: () => streamControls,
  };
}

export async function writeTelegramConfigIni(
  homeDir: string,
  config: {
    botToken: string;
    profileId?: string;
    handshakeCode?: string | null;
    pairedUserIds?: number[];
    allowedUserIds?: number[];
  },
): Promise<void> {
  const dir = path.join(homeDir, ".nakama", "telegram");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# Nakama Telegram bridge",
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId ?? "default"}`,
  ];

  if (config.handshakeCode) {
    lines.push(`handshake_code=${config.handshakeCode}`);
  }

  if (config.pairedUserIds?.length) {
    lines.push(`paired_user_ids=${config.pairedUserIds.join(",")}`);
  }

  if (config.allowedUserIds?.length) {
    lines.push(`allowed_user_ids=${config.allowedUserIds.join(",")}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}

export function createTestOrgStore(homeDir: string): ChannelOrgStore {
  return new ChannelOrgStore(
    path.join(homeDir, ".nakama", "telegram", "org-selection.json"),
  );
}

export async function withTempHome<T>(
  run: (homeDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "nakama-telegram-home-"));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

  try {
    return await run(homeDir);
  } finally {
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
  }
}
