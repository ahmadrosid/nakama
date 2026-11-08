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

/** The word after "!", in lower case, or null for a message without one. */
export function channelCommandWord(text: string): string | null {
  if (!text.startsWith("!")) {
    return null;
  }

  // Phone keyboards capitalise the first letter of a message.
  return (text.slice(1).split(/\s+/)[0] ?? "").toLowerCase() || null;
}

/**
 * "!New please" is "new". Any other message is null and goes to the agent,
 * "!urgent summarise the report" included.
 */
export function parseChannelCommand(text: string): ChannelCommand | null {
  const word = channelCommandWord(text);

  return CHANNEL_COMMANDS.find((command) => command === word) ?? null;
}

export function channelCommandHelp(): string {
  return [
    "!new: start a fresh conversation",
    "!clear: clear this conversation's history",
    "!stop: stop the current reply",
    "!status: server and model status",
    "!help: this message",
  ].join("\n");
}

/**
 * Turns that wait for a chat's lock. A stop aborts them here, because the
 * active-stream registry only knows the turn that holds the lock.
 */
export function createWaitingTurns() {
  const waiting = new Map<string, Set<AbortController>>();

  return {
    /** Called before the turn queues on the lock. */
    join(key: string): AbortController {
      const turn = new AbortController();
      const turns = waiting.get(key) ?? new Set<AbortController>();

      turns.add(turn);
      waiting.set(key, turns);

      return turn;
    },

    /** Called once the turn can be stopped through the registry, or ends. */
    leave(key: string, turn: AbortController): void {
      const turns = waiting.get(key);

      turns?.delete(turn);

      if (turns?.size === 0) {
        waiting.delete(key);
      }
    },

    /** Aborts every waiting turn; true when there was one. */
    stop(key: string): boolean {
      const turns = waiting.get(key);

      for (const turn of turns ?? []) {
        turn.abort();
      }

      waiting.delete(key);

      return (turns?.size ?? 0) > 0;
    },
  };
}

export interface ChannelCommandHandlers {
  clearSession(): Promise<void>;
  helpText: string;
  reply(text: string): Promise<void>;
  /** Holds the chat lock, so the work waits for the turn being stopped. */
  runLocked(work: () => Promise<void>): Promise<void>;
  startSession(): Promise<void>;
  status(): Promise<string>;
  /** Stops the running turn and the ones waiting; true when there was one. */
  stop(): boolean;
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
      handlers.stop();

      await handlers.runLocked(async () => {
        try {
          if (command === "new") {
            await handlers.startSession();
            await handlers.reply("Started a new conversation.");
          } else {
            await handlers.clearSession();
            await handlers.reply("History cleared.");
          }
        } catch (error) {
          await handlers.reply(formatClientError(error));
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

/**
 * The status command's answer. A failed agent or model lookup becomes a line
 * of its own, so the server lines above it stay.
 */
export async function describeChannelStatus(
  source: ChannelStatusSource,
  options: ChannelStatusOptions
): Promise<string> {
  let health: Awaited<ReturnType<ChannelStatusSource["health"]>>;

  try {
    health = await source.health();
  } catch (error) {
    return formatClientError(error);
  }

  const lines = [
    `Server: ${health.ok ? "ok" : "degraded"}`,
    `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
  ];

  if (health.providerConfigured) {
    try {
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
    } catch (error) {
      lines.push(formatClientError(error));
    }
  } else {
    lines.push("Chat runs in offline mode without an API key.");
  }

  if (options.sessionId) {
    lines.push(`Session: ${options.sessionId.slice(0, 8)}`);
  }

  return lines.join("\n");
}
