import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { spyOn } from "bun:test";
import type { TinyClawClient } from "@tinyclaw/client";
import type { StreamHandlers } from "@tinyclaw/client";

export interface MockStreamControl {
  complete(reply?: string): void;
  fail(error?: Error): void;
  readonly signal: AbortSignal | undefined;
}

type StreamStep =
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
    profileIds: [] as string[],
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
          if (settled) return;
          settled = true;
          resolve(reply);
        },
        fail(error = new Error("Stream failed")) {
          if (settled) return;
          settled = true;
          reject(error);
        },
      };

      streamOptions?.signal?.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );

      queueMicrotask(() => {
        for (const step of options.steps ?? []) {
          if (settled) break;

          switch (step.type) {
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
    createSession: async (_channel, options = {}) => {
      calls.createSession += 1;
      calls.profileIds.push(options.profileId ?? "profile_default");
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

export async function writeWhatsAppConfigIni(
  homeDir: string,
  config: {
    phoneNumber: string;
    profileId?: string;
    pairingCode?: string | null;
    pairedJid?: string | null;
  },
): Promise<void> {
  const dir = path.join(homeDir, ".tinyclaw", "whatsapp");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# TinyClaw WhatsApp bridge",
    `phone_number=${config.phoneNumber}`,
    `profile_id=${config.profileId ?? "profile_default"}`,
  ];

  if (config.pairingCode) {
    lines.push(`pairing_code=${config.pairingCode}`);
  }

  if (config.pairedJid) {
    lines.push(`paired_jid=${config.pairedJid}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}

export async function withTempHome<T>(
  run: (homeDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-whatsapp-home-"));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

  try {
    return await run(homeDir);
  } finally {
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
  }
}