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
  createMultiTestOrgs,
  createTestOrgStore as createSharedTestOrgStore,
  withTempHome as withSharedTempHome,
} from "@nakama/core/channel-test-helpers";
import type {
  ChatMessage,
  ProfileSummary,
  UserOrgSummary,
} from "@nakama/core/contract";

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
  options: {
    streaming?: boolean;
    steps?: StreamStep[];
    autoComplete?: boolean;
    profiles?: ProfileSummary[];
    orgs?: UserOrgSummary[];
    messages?: ChatMessage[];
  } = {}
) {
  const calls = {
    compact: 0,
    createChatSession: 0,
    createSession: 0,
    getMessages: 0,
    listProfiles: 0,
    listUserOrgs: 0,
    profileIds: [] as string[],
    publishProfileArtifactShare: 0,
    readProfileArtifactContent: 0,
    sendStream: 0,
    setOrgId: 0,
    streamInputs: [] as unknown[],
  };
  const orgIds: string[] = [];

  let streamControl: MockStreamControl | null = null;

  const sendStream = async (
    _input: unknown,
    handlers: unknown,
    streamOptions?: { signal?: AbortSignal }
  ) => {
    calls.sendStream += 1;
    calls.streamInputs.push(_input);

    if (!options.streaming) {
      return "Agent reply";
    }

    const streamHandlers = handlers as StreamHandlers;

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      streamControl = {
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
        get signal() {
          return streamOptions?.signal;
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
        { once: true }
      );

      queueMicrotask(() => {
        for (const step of options.steps ?? []) {
          if (settled) {
            break;
          }

          switch (step.type) {
            case "chunk":
              streamHandlers.onChunk(step.delta);
              break;
            case "thinking":
              streamHandlers.onThinking?.(step.delta ?? "");
              break;
            case "tool_start":
              streamHandlers.onToolStart?.({
                input: {},
                tool: "todo_write",
                toolCallId: "tool_call_1",
              });
              break;
            case "tool_end":
              streamHandlers.onToolEnd?.({
                result: {},
                tool: "todo_write",
                toolCallId: "tool_call_1",
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

        if (
          !settled &&
          options.steps?.length &&
          options.autoComplete !== false
        ) {
          streamControl?.complete("Agent reply");
        }
      });
    });
  };

  const session = {
    clear: async () => {},
    compact: async () => {
      calls.compact += 1;
      return {
        action: "summarized" as const,
        messagesAfter: 4,
        messagesBefore: 10,
      };
    },
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

  const orgs = options.orgs ?? createDefaultTestOrgs();

  const client = {
    createChatSession: () => {
      calls.createChatSession += 1;
      return session;
    },
    createSession: async (_channel, options = {}) => {
      calls.createSession += 1;
      calls.profileIds.push(options.profileId ?? "default");
      return session;
    },
    getModels: async () => ({
      currentProviderId: null,
      displayName: null,
      models: [],
      provider: null,
      providers: [],
    }),
    health: async () => ({ ok: true, providerConfigured: false }),
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
      return {
        contentType: "text/markdown",
        data: new TextEncoder().encode("# Report").buffer,
      };
    },
    setOrgId: (orgId: string | null) => {
      calls.setOrgId += 1;
      orgIds.push(orgId ?? "");
    },
  } as unknown as NakamaClient;

  assertBridgeClientMethods(client);

  return {
    calls,
    client,
    getStreamControl: () => streamControl,
    orgIds,
  };
}

function createDefaultProfileSummary(): ProfileSummary {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    hasAvatar: false,
    id: "default",
    isSuper: false,
    mcpServerCount: 0,
    model: null,
    name: "Default",
    soulActive: false,
    toolCount: 0,
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
    allowedPhones?: string[];
  }
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

  if (config.allowedPhones?.length) {
    lines.push(`allowed_phones=${config.allowedPhones.join(",")}`);
  }

  lines.push("");
  await writeFile(path.join(dir, "config.ini"), lines.join("\n"), "utf8");
}

export async function waitForStreamControl(
  getStreamControl: () => MockStreamControl | null,
  timeoutMs = 2000
): Promise<MockStreamControl> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const control = getStreamControl();

    if (control?.signal) {
      return control;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for stream control");
}

export { createDefaultTestOrgs, createMultiTestOrgs };

export function createTestOrgStore(homeDir: string): ChannelOrgStore {
  return createSharedTestOrgStore(homeDir, "whatsapp");
}

export async function withTempHome<T>(
  run: (homeDir: string) => Promise<T>
): Promise<T> {
  return withSharedTempHome("nakama-whatsapp-home-", run);
}
