import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { spyOn } from "bun:test";
import type { NakamaClient } from "@nakama/client";
import type { ProfileSummary, UserOrgSummary } from "@nakama/core/contract";
import {
  assertBridgeClientMethods,
  parseListProfilesResponse,
  parseListUserOrgsResponse,
} from "@nakama/core/bridge-api";
import { ChannelOrgStore } from "@nakama/core/channel-org";
import type { StreamHandlers } from "@nakama/client";

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
    profiles?: ProfileSummary[];
    orgs?: UserOrgSummary[];
  } = {},
) {
  const calls = {
    createSession: 0,
    sendStream: 0,
    compact: 0,
    profileIds: [] as string[],
    listProfiles: 0,
    listUserOrgs: 0,
    setOrgId: 0,
  };
  const orgIds: string[] = [];

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

  const orgs = options.orgs ?? createDefaultTestOrgs();

  const client = {
    listProfiles: async () => {
      calls.listProfiles += 1;
      return parseListProfilesResponse({
        profiles: options.profiles ?? [createDefaultProfileSummary()],
      });
    },
    listUserOrgs: async () => {
      calls.listUserOrgs += 1;
      return parseListUserOrgsResponse({ orgs });
    },
    setOrgId: (orgId: string | null) => {
      calls.setOrgId += 1;
      orgIds.push(orgId ?? "");
    },
    createSession: async (_channel, options = {}) => {
      calls.createSession += 1;
      calls.profileIds.push(options.profileId ?? "default");
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
  } as unknown as NakamaClient;

  assertBridgeClientMethods(client);

  return {
    client,
    calls,
    orgIds,
    getStreamControl: () => streamControl,
  };
}

function createDefaultProfileSummary(): ProfileSummary {
  const now = new Date().toISOString();
  return {
    id: "default",
    name: "Default",
    model: null,
    isSuper: false,
    toolCount: 0,
    mcpServerCount: 0,
    soulActive: false,
    hasAvatar: false,
    createdAt: now,
    updatedAt: now,
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
  const dir = path.join(homeDir, ".nakama", "whatsapp");
  await mkdir(dir, { recursive: true });

  const lines = [
    "# Nakama WhatsApp bridge",
    `phone_number=${config.phoneNumber}`,
    `profile_id=${config.profileId ?? "default"}`,
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

export function createTestOrgStore(homeDir: string): ChannelOrgStore {
  return new ChannelOrgStore(
    path.join(homeDir, ".nakama", "whatsapp", "org-selection.json"),
  );
}

export async function withTempHome<T>(
  run: (homeDir: string) => Promise<T>,
): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "nakama-whatsapp-home-"));
  const homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

  try {
    return await run(homeDir);
  } finally {
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
  }
}
