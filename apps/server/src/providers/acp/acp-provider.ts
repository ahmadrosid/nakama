import type * as acp from "@agentclientprotocol/sdk";
import type {
  AcpAgentConfig,
  ChatCompletionResult,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import {
  type AcpAgentProcess,
  startAcpAgentProcess,
} from "./acp-agent-process";
import { isEditInsideFolder } from "./acp-edit-policy";
import { isNakamaToolPermission, moveAcpToolAccess } from "./acp-mcp-tools";
import { createAcpUpdateMapper } from "./acp-session-events";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface AcpProviderOptions {
  agent: AcpAgentConfig;
  /** Absolute path. The agent works here; Nakama never runs its own tools in it. */
  cwd: string;
  /** Settings applied once when the agent session starts, such as the model and effort. */
  initialSettings?: Record<string, string>;
  mcpServers?: acp.McpServer[];
  /** One chat session keeps one agent process, so the agent keeps its context between turns. */
  sessionKey: string;
}

type UpdateMapper = ReturnType<typeof createAcpUpdateMapper>;

interface LiveSession {
  agent: AcpAgentConfig;
  configOptions: acp.SessionConfigOption[];
  cwd: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  key: string;
  process: AcpAgentProcess;
  /** Read by the agent's callbacks, which keep working after a key move. */
  route: { key: string; mapper: UpdateMapper | null };
  sessionId: string | null;
  /** The system prompt goes out with the first turn only; the agent keeps it after that. */
  systemSent: boolean;
}

const liveSessions = new Map<string, LiveSession>();

/**
 * Chat provider backed by an ACP agent. The agent runs its own model loop and
 * tools. Nakama sends the new user message, shows the streamed updates, and
 * gets the Nakama tools through `mcpServers`.
 */
export function createAcpProvider(options: AcpProviderOptions): ProviderClient {
  const generateChat = async (
    input: GenerateChatInput,
    handlers: StreamChatHandlers
  ): Promise<ChatCompletionResult> => {
    const prompt = lastUserText(input);

    if (!prompt) {
      throw new Error("ACP agent turns need a user message.");
    }

    const live = await ensureSession(options);
    // SAFETY: ensureSession sets sessionId before it returns the live session.
    const sessionId = live.sessionId as string;

    const text =
      !live.systemSent && input.system.trim()
        ? `${input.system.trim()}\n\n${prompt}`
        : prompt;

    live.systemSent = true;

    const mapper = createAcpUpdateMapper(handlers);
    live.route.mapper = mapper;

    const onAbort = () => {
      void live.process.connection.cancel({ sessionId });
    };

    input.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await live.process.connection.prompt({
        prompt: [{ text, type: "text" }],
        sessionId,
      });
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
      live.route.mapper = null;
      scheduleIdleStop(live);
    }

    const content = mapper.assistantText();

    return {
      assistantMessage: { content, role: "assistant" },
      content,
      toolCalls: [],
    };
  };

  return {
    generateChat: (input) => generateChat(input, { onChunk: () => {} }),
    generateText: async (
      input: GenerateTextInput
    ): Promise<GenerateTextResult> => {
      throw new Error(
        `ACP agents do not generate text for ${input.format ?? "titles"} requests. Configure a text provider for this profile.`
      );
    },
    name: "acp",
    streamChat: generateChat,
  };
}

/**
 * The agent's own settings for this chat, such as model and reasoning effort.
 * Starts the agent and its session if they are not running yet.
 */
export async function getAcpConfigOptions(
  options: AcpProviderOptions
): Promise<acp.SessionConfigOption[]> {
  const live = await ensureSession(options);

  return live.configOptions;
}

/** Changes one agent setting, such as the model, for the rest of this chat. */
export async function setAcpConfigOption(
  options: AcpProviderOptions,
  configId: string,
  value: string
): Promise<acp.SessionConfigOption[]> {
  const live = await ensureSession(options);
  // SAFETY: ensureSession sets sessionId before it returns the live session.
  const sessionId = live.sessionId as string;

  const response = await live.process.connection.setSessionConfigOption({
    configId,
    sessionId,
    value,
  });

  live.configOptions = response.configOptions;

  return live.configOptions;
}

/**
 * Moves a running agent from a draft key to a chat's key, so the settings the
 * user picked before the first message stay on the agent that answers it.
 * Returns false when there is no draft agent or the chat already has one.
 */
export function adoptAcpDraftSession(
  draftKey: string,
  sessionKey: string
): boolean {
  const draft = liveSessions.get(draftKey);

  if (!draft || liveSessions.has(sessionKey)) {
    return false;
  }

  liveSessions.delete(draftKey);
  draft.key = sessionKey;
  draft.route.key = sessionKey;
  liveSessions.set(sessionKey, draft);
  moveAcpToolAccess(draftKey, sessionKey);

  return true;
}

/** Stops the agent for one chat session. Call when the chat is closed. */
export function stopAcpSession(sessionKey: string): void {
  const live = liveSessions.get(sessionKey);

  if (!live) {
    return;
  }

  if (live.idleTimer) {
    clearTimeout(live.idleTimer);
  }

  live.process.kill();
  liveSessions.delete(sessionKey);
}

/** Returns a live agent session with an ACP session id, starting either if needed. */
async function ensureSession(
  options: AcpProviderOptions
): Promise<LiveSession> {
  const live = await getOrStartProcess(options);

  if (live.sessionId === null) {
    const created = await live.process.connection.newSession({
      cwd: options.cwd,
      mcpServers: options.mcpServers ?? [],
    });

    live.sessionId = created.sessionId;
    live.configOptions = created.configOptions ?? [];
    await applyInitialSettings(live, options.initialSettings ?? {});
  }

  return live;
}

/**
 * Applies the profile's saved choices to a new agent session. A value the agent
 * no longer offers is skipped, so an old choice never fails a new chat.
 */
async function applyInitialSettings(
  live: LiveSession,
  settings: Record<string, string>
): Promise<void> {
  for (const [configId, value] of Object.entries(settings)) {
    const option = live.configOptions.find((item) => item.id === configId);

    if (
      option?.type !== "select" ||
      !option.options.some(optionAccepts(value))
    ) {
      continue;
    }

    const response = await live.process.connection.setSessionConfigOption({
      configId,
      // SAFETY: ensureSession sets sessionId before this runs.
      sessionId: live.sessionId as string,
      value,
    });

    live.configOptions = response.configOptions;
  }
}

function optionAccepts(
  value: string
): (
  entry: { value: string } | { options: Array<{ value: string }> }
) => boolean {
  return (entry) =>
    "options" in entry
      ? entry.options.some((item) => item.value === value)
      : entry.value === value;
}

async function getOrStartProcess(
  options: AcpProviderOptions
): Promise<LiveSession> {
  const existing = liveSessions.get(options.sessionKey);

  if (existing && sameAgent(existing, options)) {
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }

    return existing;
  }

  if (existing) {
    stopAcpSession(options.sessionKey);
  }

  const route: LiveSession["route"] = { key: options.sessionKey, mapper: null };

  const process = await startAcpAgentProcess(
    {
      args: options.agent.args,
      command: options.agent.command,
      cwd: options.cwd,
    },
    {
      requestPermission: async (params) => {
        // Approved: the chat's own Nakama tools, and edits to files inside the
        // profile folder. Commands and edits outside the folder are denied.
        const approve =
          isNakamaToolPermission(route.key, params.toolCall) ||
          isEditInsideFolder(options.cwd, params.toolCall);

        const choice = params.options.find((option) =>
          approve
            ? option.kind === "allow_once"
            : option.kind === "reject_once" || option.kind === "reject_always"
        );

        return choice
          ? { outcome: { optionId: choice.optionId, outcome: "selected" } }
          : { outcome: { outcome: "cancelled" } };
      },
      sessionUpdate: async (notification) => {
        route.mapper?.handle(notification);
      },
    }
  );

  const session: LiveSession = {
    agent: options.agent,
    configOptions: [],
    cwd: options.cwd,
    idleTimer: null,
    key: options.sessionKey,
    process,
    route,
    sessionId: null,
    systemSent: false,
  };

  liveSessions.set(options.sessionKey, session);
  void process.exited.then(() => {
    if (liveSessions.get(session.key) === session) {
      liveSessions.delete(session.key);
    }
  });

  return session;
}

function scheduleIdleStop(live: LiveSession): void {
  if (live.idleTimer) {
    clearTimeout(live.idleTimer);
  }

  live.idleTimer = setTimeout(() => {
    if (liveSessions.get(live.key) === live) {
      stopAcpSession(live.key);
    }
  }, IDLE_TIMEOUT_MS);
  live.idleTimer.unref?.();
}

function sameAgent(live: LiveSession, options: AcpProviderOptions): boolean {
  return (
    live.cwd === options.cwd &&
    live.agent.command === options.agent.command &&
    live.agent.args.join("\u0000") === options.agent.args.join("\u0000")
  );
}

function lastUserText(input: GenerateChatInput): string {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];

    if (message?.role !== "user") {
      continue;
    }

    const content = message.content;

    if (!Array.isArray(content)) {
      return content;
    }

    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  return "";
}
