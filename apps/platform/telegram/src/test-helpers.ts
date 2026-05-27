import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { spyOn } from "bun:test";
import type { TinyClawClient } from "@tinyclaw/client";
import type { Context } from "grammy";

export interface MockMessageContext {
  ctx: Context;
  replies: string[];
}

export function createMessageContext(options: {
  userId?: number;
  chatId?: number;
  text?: string;
  chatType?: "private" | "group" | "supergroup";
}): MockMessageContext {
  const replies: string[] = [];
  const ctx = {
    chat: options.chatType
      ? { id: options.chatId ?? -100, type: options.chatType }
      : { id: options.chatId ?? options.userId ?? 1, type: "private" as const },
    from: options.userId !== undefined ? { id: options.userId } : undefined,
    message: options.text !== undefined ? { text: options.text } : {},
    reply: async (text: string) => {
      replies.push(text);
    },
    replyWithChatAction: async () => {},
  } as unknown as Context;

  return { ctx, replies };
}

export interface MockStreamControl {
  complete(reply?: string): void;
  readonly signal: AbortSignal | undefined;
}

export function createMockClient(options: { streaming?: boolean } = {}) {
  const calls = {
    createSession: 0,
    sendStream: 0,
    compact: 0,
  };

  let streamControl: MockStreamControl | null = null;

  const sendStream = async (
    _input: unknown,
    _handlers: unknown,
    streamOptions?: { signal?: AbortSignal },
  ) => {
    calls.sendStream += 1;

    if (!options.streaming) {
      return "Agent reply";
    }

    return new Promise<string>((resolve, reject) => {
      streamControl = {
        get signal() {
          return streamOptions?.signal;
        },
        complete(reply = "Agent reply") {
          resolve(reply);
        },
      };

      streamOptions?.signal?.addEventListener(
        "abort",
        () => {
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
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
    getModels: async () => ({ provider: null, currentModel: null }),
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
