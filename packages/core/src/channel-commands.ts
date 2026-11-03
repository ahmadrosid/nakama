import { formatClientError } from "./api-error";
import type {
  HealthResponse,
  ModelsResponse,
  ProfileSummary,
} from "./contract";

export const CHANNEL_COMMANDS = [
  "clear",
  "help",
  "new",
  "status",
  "stop",
] as const;

export type ChannelCommand = (typeof CHANNEL_COMMANDS)[number];

/**
 * "!New please" is "new". Any other message is null and goes to the agent,
 * "!urgent summarise the report" included.
 */
export function parseChannelCommand(
  text: string,
  prefix: string
): ChannelCommand | null {
  if (!text.startsWith(prefix)) {
    return null;
  }

  // Phone keyboards capitalise the first letter of a message.
  const word = (text.slice(prefix.length).split(/\s+/)[0] ?? "").toLowerCase();

  return CHANNEL_COMMANDS.find((command) => command === word) ?? null;
}

export function channelCommandHelp(prefix: string): string {
  return [
    `${prefix}new: start a fresh conversation`,
    `${prefix}clear: clear this conversation's history`,
    `${prefix}stop: stop the current reply`,
    `${prefix}status: server and model status`,
    `${prefix}help: this message`,
  ].join("\n");
}

export interface ChannelCommandHandlers {
  clearSession(): Promise<void>;
  helpText: string;
  reply(text: string): Promise<void>;
  /** Holds the chat lock, so the work waits for the turn being stopped. */
  runLocked(work: () => Promise<void>): Promise<void>;
  startSession(): Promise<void>;
  status(): Promise<string>;
  /** For stop: true when a turn was stopped. */
  stop(): boolean;
  /** For new and clear: stops the running turn so they do not wait for it. */
  stopRunning(): void;
}

/** Answers a command. It never reaches the agent as a turn. */
export async function runChannelCommand(
  command: ChannelCommand,
  handlers: ChannelCommandHandlers
): Promise<void> {
  switch (command) {
    case "stop": {
      // Not behind the lock: the turn it stops is holding it.
      await handlers.reply(handlers.stop() ? "Stopping…" : "Nothing to stop.");

      return;
    }

    case "help": {
      await handlers.reply(handlers.helpText);

      return;
    }

    case "status": {
      await handlers.reply(await handlers.status());

      return;
    }

    case "new":
    case "clear": {
      // A turn holds the chat lock until it ends, so stop it before
      // queueing on the lock; otherwise this waits for the whole turn.
      handlers.stopRunning();

      await handlers.runLocked(async () => {
        if (command === "new") {
          await handlers.startSession();
          await handlers.reply("Started a new conversation.");
        } else {
          await handlers.clearSession();
          await handlers.reply("History cleared.");
        }
      });

      return;
    }
  }
}

export interface ChannelStatusSource {
  getModels(): Promise<Pick<ModelsResponse, "provider">>;
  health(): Promise<Pick<HealthResponse, "ok" | "providerConfigured">>;
}

export interface ChannelStatusOptions {
  /** The chat's agent; `agent` is undefined when the server no longer lists it. */
  findAgent(): Promise<{
    agent: Pick<ProfileSummary, "model" | "name"> | undefined;
    id: string;
  }>;
  /** "Profile" where the channel has a /profile command, "Agent" elsewhere. */
  label: "Agent" | "Profile";
  sessionId?: string | null;
}

/** The status command's answer, or the error that stopped it. */
export async function describeChannelStatus(
  source: ChannelStatusSource,
  options: ChannelStatusOptions
): Promise<string> {
  try {
    const health = await source.health();

    const lines = [
      `Server: ${health.ok ? "ok" : "degraded"}`,
      `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
    ];

    if (health.providerConfigured) {
      const [models, { agent, id }] = await Promise.all([
        source.getModels(),
        options.findAgent(),
      ]);

      const model = agent?.model?.includes("::")
        ? agent.model.slice(agent.model.indexOf("::") + 2)
        : (agent?.model ?? "none");

      lines.push(`${options.label}: ${agent?.name ?? id}`);
      lines.push(`Provider: ${models.provider ?? "unknown"}`);
      lines.push(`Model: ${model}`);
    } else {
      lines.push("Chat runs in offline mode without an API key.");
    }

    if (options.sessionId) {
      lines.push(`Session: ${options.sessionId.slice(0, 8)}`);
    }

    return lines.join("\n");
  } catch (error) {
    return formatClientError(error);
  }
}
