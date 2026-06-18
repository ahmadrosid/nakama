import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { spyOn } from "bun:test";
import type { TinyClawClient } from "@tinyclaw/client";
import type { AgentTodo } from "@tinyclaw/core/contract";
import type { StreamHandlers } from "@tinyclaw/client";
import type { Context } from "grammy";

export interface MockMessageContext {
  ctx: Context;
  replies: string[];
  edits: Array<{ chatId: number; messageId: number; text: string }>;
}

export function createMessageContext(options: {
  userId?: number;
  chatId?: number;
  text?: string;
  chatType?: "private" | "group" | "supergroup";
}): MockMessageContext {
  const replies: string[] = [];
  const edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  let nextMessageId = 1;
  const ctx = {
    chat: options.chatType
      ? { id: options.chatId ?? -100, type: options.chatType }
      : { id: options.chatId ?? options.userId ?? 1, type: "private" as const },
    from: options.userId !== undefined ? { id: options.userId } : undefined,
    message: options.text !== undefined ? { text: options.text } : {},
    reply: async (text: string) => {
      replies.push(text);
      return { message_id: nextMessageId++ };
    },
    replyWithChatAction: async () => {},
    api: {
      editMessageText: async (chatId: number, messageId: number, text: string) => {
        edits.push({ chatId, messageId, text });
      },
    },
  } as unknown as Context;

  return { ctx, replies, edits };
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

export function createMockClient(
  options: { streaming?: boolean; steps?: StreamStep[]; autoComplete?: boolean } = {},
) {
  const calls = {
    createSession: 0,
    sendStream: 0,
    compact: 0,
  };

  let streamControl: MockStreamControl | null = null;

  const sendStream = async (
    _input: unknown,
    handlers: unknown,
    streamOptions?: { signal?: AbortSignal },
  ) => {
    calls.sendStream += 1;

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

  const client = {
    createSession: async () => {
      calls.createSession += 1;
      return session;
    },
    createChatSession: () => session,
    health: async () => ({ ok: true, providerConfigured: false }),
    getModels: async () => ({
      provider: null,
      currentProviderId: null,
      providers: [],
      models: [],
      displayName: null,
    }),
  } as unknown as TinyClawClient;

  return {
    client,
    calls,
    getStreamControl: () => streamControl,
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
  const dir = path.join(homeDir, ".tinyclaw", "telegram");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# TinyClaw Telegram bridge",
    `bot_token=${config.botToken}`,
    `profile_id=${config.profileId ?? "profile_default"}`,
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

export async function withTempHome<T>(
  run: (homeDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-telegram-home-"));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

  try {
    return await run(homeDir);
  } finally {
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
  }
}
