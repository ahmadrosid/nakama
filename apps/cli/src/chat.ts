import {
  formatClientError,
  type AgentChannel,
  type InitSoulResponse,
  type InitUserContextResponse,
  type ModelsResponse,
  type ProfileSummary,
  type SendMessageInput,
  type SoulStatusResponse,
  type UserContextStatusResponse,
} from "@tinyclaw/core";
import type { RemoteChatSession, StreamHandlers } from "@tinyclaw/client";
import type { TinyClawClient } from "@tinyclaw/client";
import { mergeSendInput, parseImageLine } from "./image-input";
import { formatSlashCommands, effectiveModelState, isActiveModelOption, resolveModelSwitchTarget, resolveSuggestions } from "./commands";
import { saveCliProfileId } from "./cli-config";
import {
  resolveProfileInput,
  resolveStartupProfile,
  type CliProfileOptions,
} from "./profile";
import { PersistentPrompt } from "./persistent-prompt";
import { PromptCancelledError, promptLine, type PromptLineResult } from "./prompt";
import { MessageQueue, type PendingMessage } from "./message-queue";
import { sendStreamCancellable } from "./stream-abort";
import { ThinkingIndicator } from "./thinking-indicator";
import { TerminalRenderer } from "./terminal-renderer";
import { TerminalInput } from "./terminal-input";
import { styledLine } from "./styled-text";

const HELP_TEXT = `${formatSlashCommands()}\n\n@/path/to/image.png [message]   attach an image from file\n/paste                            attach image from clipboard (recommended)\nCtrl+V / Cmd+V (empty paste)      attach image when terminal supports it\nPageUp/PageDown                   scroll conversation history\nHome/End                          jump to oldest/newest visible history`;

interface RunChatOptions {
  client: TinyClawClient;
  channel: AgentChannel;
  offline?: boolean;
  profileId?: CliProfileOptions["profileId"];
  signal?: AbortSignal;
}

export function needsTrailingStreamNewline(lastChunk: string | null): boolean {
  return lastChunk === null || !lastChunk.endsWith("\n");
}

export async function runChat(options: RunChatOptions): Promise<void> {
  const startup = await resolveStartupProfile(options.client, {
    profileId: options.profileId,
  });
  let currentProfileId = startup.profileId;
  let currentProfile = startup.profile;
  let session = await options.client.createSession(options.channel, {
    profileId: currentProfileId,
  });

  const terminalInput = new TerminalInput();
  const renderer = new TerminalRenderer(terminalInput);
  const useStickyInput = renderer.apply();

  console.log(`Profile: ${currentProfile.name} (${currentProfile.id})`);
  console.log("");

  if (options.offline) {
    console.log("Server has no provider configured. Chat runs in offline mode.");
    console.log("");
  } else {
    try {
      await printCurrentModel(options.client);
    } catch (error) {
      console.log(`${formatError(error)}`);
      console.log("Restart the server to pick up the latest API:\n  bun run dev:server");
    }
    console.log("");
  }

  if (useStickyInput) {
    terminalInput.start();
    await renderer.anchorFromCursor();

    await runStickyChat({
      options,
      renderer,
      terminalInput,
      session,
      currentProfileId,
      currentProfile,
      onSessionChange: (next) => {
        session = next;
      },
      onProfileChange: (profileId, profile) => {
        currentProfileId = profileId;
        currentProfile = profile;
      },
    });
    return;
  }

  await runBlockingChat({
    options,
    session,
    currentProfileId,
    onSessionChange: (next) => {
      session = next;
    },
  });
}

interface ChatContext {
  options: RunChatOptions;
  session: RemoteChatSession;
  currentProfileId: string;
  onSessionChange: (session: RemoteChatSession) => void;
}

async function runStickyChat(
  context: ChatContext & {
    renderer: TerminalRenderer;
    terminalInput: TerminalInput;
    currentProfile: ProfileSummary;
    onProfileChange: (profileId: string, profile: ProfileSummary) => void;
  },
): Promise<void> {
  const { options, renderer, terminalInput } = context;
  let session = context.session;
  let currentProfileId = context.currentProfileId;
  let currentProfile = context.currentProfile;

  let isStreaming = false;
  let abortController: AbortController | null = null;
  let lastUserMessage: string | null = null;
  let modelsCache: ModelsResponse | null = null;
  let profilesCache: ProfileSummary[] = [];
  const queue = new MessageQueue();
  const thinkingIndicator = new ThinkingIndicator();
  thinkingIndicator.setRenderer(renderer);

  async function refreshModelsCache() {
    try {
      modelsCache = await options.client.getModels();
    } catch {
      modelsCache = null;
    }
  }

  async function refreshProfilesCache() {
    try {
      const response = await options.client.listProfiles();
      profilesCache = response.profiles;
    } catch {
      profilesCache = [];
    }
  }

  await refreshProfilesCache();

  if (!options.offline) {
    await refreshModelsCache();
  }

  function writeOutput(text: string): void {
    renderer.appendOutputLine(text);
  }

  function syncPendingMessages(): void {
    renderer.setPendingMessages(queue.peekAll());
  }

  function createStreamHandlers(): StreamHandlers {
    return {
      onThinking: () => {
        thinkingIndicator.start();
      },
      onChunk: (delta) => {
        thinkingIndicator.stop();
        renderer.appendStreamChunk(delta);
      },
      onToolStart: (event) => {
        thinkingIndicator.stop();
        renderer.appendToolLine(styledLine(` [tool: ${event.tool}] `, { dim: true }));
      },
      onToolEnd: (event) => {
        renderer.appendToolLine(styledLine(` [tool: ${event.tool} done] `, { dim: true }));
      },
    };
  }

  async function sendMessageStream(input: SendMessageInput): Promise<{ aborted: boolean }> {
    if (!thinkingIndicator.isActive()) {
      thinkingIndicator.start();
    }

    try {
      return await sendStreamCancellable(session, input, createStreamHandlers(), {
        signal: abortController?.signal,
      });
    } catch (error) {
      thinkingIndicator.stop();
      throw error;
    }
  }

  async function drainQueue(): Promise<void> {
    if (isStreaming || exiting) {
      return;
    }

    const next = queue.dequeue();

    if (!next) {
      syncPendingMessages();
      return;
    }

    syncPendingMessages();
    await startSend(next);
  }

  async function startSend(message: PendingMessage): Promise<void> {
    isStreaming = true;
    abortController = new AbortController();
    renderer.beginStream();

    if (!message.echoed) {
      renderer.appendUserMessage(message.line, { placement: "scroll" });
    }

    let aborted = false;
    let caught: unknown = undefined;

    try {
      const result = await sendMessageStream(message.sendInput);
      aborted = result.aborted;
    } catch (error) {
      caught = error;
    } finally {
      isStreaming = false;
      abortController = null;
      thinkingIndicator.stop();
      renderer.endStream();
      await drainQueue();
    }

    // Post-stream output — the stream buffer is now flushed into the VirtualMessageList,
    // so any appended output appears after the assistant's response, not before it.
    if (caught !== undefined) {
      renderer.appendOutputLine(formatError(caught));
    } else if (aborted) {
      renderer.appendOutputLine(styledLine("[stopped]", { dim: true }));
    }
  }

  async function handleChatMessage(promptResult: PromptLineResult): Promise<void> {
    const line = promptResult.text.trim();
    const hasImages = Boolean(promptResult.images?.length);

    if (!line && !hasImages) {
      return;
    }

    let sendInput: SendMessageInput;

    try {
      const fromPath = await parseImageLine(line);
      sendInput = mergeSendInput(line, {
        promptImages: promptResult.images,
        fromPath,
      });
    } catch (error) {
      writeOutput(formatError(error));
      return;
    }

    lastUserMessage = sendInput.message || line;
    const pending: PendingMessage = { line, images: promptResult.images, sendInput };
    renderer.scrollToLatest();

    if (isStreaming) {
      renderer.appendUserMessage(line, { placement: "below_status" });
      queue.enqueue({ ...pending, echoed: true });
      syncPendingMessages();
      return;
    }

    await startSend(pending);
  }

  async function handleSlashCommand(line: string): Promise<"handled" | "exit" | "unhandled"> {
    if (isExitCommand(line)) {
      return "exit";
    }

    if (line === "/clear") {
      await session.clear();
      lastUserMessage = null;
      writeOutput("History cleared.");
      return "handled";
    }

    if (line === "/compact") {
      if (isStreaming) {
        writeOutput("Wait for the current response to finish.");
        return "handled";
      }

      try {
        const result = await session.compact({ force: true });
        writeOutput(`Compacted (${result.action}). Messages: ${result.messagesAfter}`);
      } catch (error) {
        writeOutput(formatError(error));
      }

      return "handled";
    }

    if (line === "/help") {
      for (const helpLine of HELP_TEXT.split("\n")) {
        writeOutput(helpLine);
      }

      return "handled";
    }

    if (line === "/paste") {
      if (isStreaming) {
        writeOutput("Wait for the current response to finish.");
        return "handled";
      }

      try {
        const { readClipboardImage } = await import("./clipboard-image");
        const image = await readClipboardImage();

        if (!image) {
          writeOutput("No image on clipboard. Copy a screenshot or image first.");
          return "handled";
        }

        lastUserMessage = "";
        await startSend({
          line: "",
          images: [image],
          sendInput: { message: "", images: [image] },
        });
      } catch (error) {
        writeOutput(formatError(error));
      }

      return "handled";
    }

    if (line === "/models") {
      await printModels(options.client, writeOutput, currentProfile, modelsCache);
      return "handled";
    }

    if (line === "/thinking" || line.startsWith("/thinking ")) {
      return handleThinkingCommand(line);
    }

    if (line === "/debug" || line.startsWith("/debug ")) {
      return handleDebugCommand(line);
    }

    if (line === "/model" || line.startsWith("/model ")) {
      return handleModelCommand(line);
    }

    if (line === "/profile" || line.startsWith("/profile ")) {
      return handleProfileCommand(line);
    }

    if (line.startsWith("/create")) {
      return handleCreateCommand(line);
    }

    if (line === "/soul" || line.startsWith("/soul ")) {
      return handleSoulCommand(line);
    }

    if (line === "/user" || line.startsWith("/user ")) {
      return handleUserCommand(line);
    }

    return "unhandled";
  }

  async function handleThinkingCommand(line: string): Promise<"handled"> {
    const arg = line.slice("/thinking".length).trim().toLowerCase();

    if (!arg) {
      try {
        const settings = await options.client.getThinkingSettings();
        writeOutput(`Thinking: ${settings.enabled ? "on" : "off"} (${settings.effort} effort)`);
      } catch (error) {
        writeOutput(formatError(error));
      }

      return "handled";
    }

    if (isStreaming) {
      writeOutput("Wait for the current response to finish.");
      return "handled";
    }

    try {
      const current = await options.client.getThinkingSettings();
      let enabled = current.enabled;
      let effort = current.effort;

      if (arg === "on") {
        enabled = true;
      } else if (arg === "off") {
        enabled = false;
      } else if (arg === "low" || arg === "medium" || arg === "high") {
        enabled = true;
        effort = arg;
      } else {
        writeOutput("Usage: /thinking [on|off|low|medium|high]");
        return "handled";
      }

      const saved = await options.client.setThinkingSettings({ enabled, effort });
      session = await options.client.createSession(options.channel, {
        profileId: currentProfileId,
      });
      context.onSessionChange(session);
      lastUserMessage = null;
      writeOutput(
        `Thinking ${saved.enabled ? "enabled" : "disabled"} (${saved.effort} effort). Chat history reset.`,
      );
    } catch (error) {
      writeOutput(formatError(error));
    }

    syncPendingMessages();
    return "handled";
  }

  async function handleDebugCommand(line: string): Promise<"handled"> {
    const arg = line.slice("/debug".length).trim().toLowerCase();

    if (!arg) {
      writeOutput(`Debug overlay: ${renderer.isDebugOverlayEnabled() ? "on" : "off"}`);
      return "handled";
    }

    if (arg !== "on" && arg !== "off") {
      writeOutput("Usage: /debug [on|off]");
      return "handled";
    }

    renderer.setDebugOverlay(arg === "on");
    writeOutput(`Debug overlay ${arg}.`);
    return "handled";
  }

  async function handleModelCommand(line: string): Promise<"handled"> {
    const modelArg = line.slice("/model".length).trim();

    if (!modelArg) {
      await printCurrentModel(options.client, writeOutput, currentProfile, modelsCache);
      return "handled";
    }

    if (isStreaming) {
      writeOutput("Wait for the current response to finish.");
      return "handled";
    }

    try {
      const cached = modelsCache ?? (await options.client.getModels());
      const target = resolveModelSwitchTarget(cached, modelArg);

      if (target === "unknown") {
        writeOutput(`Unknown model: ${modelArg}`);
        return "handled";
      }

      if (target === "ambiguous") {
        writeOutput(
          `Ambiguous model: ${modelArg}. Use /model <provider-id>::<model-id> (see /models).`,
        );
        return "handled";
      }

      const profileResponse = await options.client.updateProfile(currentProfileId, {
        model: `${target.providerId}::${target.modelId}`,
      });
      currentProfile = profileResponse.profile;
      session = await options.client.createSession(options.channel, {
        profileId: currentProfileId,
      });
      context.onSessionChange(session);
      lastUserMessage = null;
      await refreshModelsCache();
      writeOutput(`Model switched to ${target.modelId}. Chat history reset.`);
    } catch (error) {
      writeOutput(formatError(error));
    }

    syncPendingMessages();
    return "handled";
  }

  async function handleProfileCommand(line: string): Promise<"handled"> {
    const profileArg = line.slice("/profile".length).trim();

    if (!profileArg) {
      for (const profileLine of formatProfilesLines(profilesCache, currentProfileId)) {
        writeOutput(profileLine);
      }

      return "handled";
    }

    if (isStreaming) {
      writeOutput("Wait for the current response to finish.");
      return "handled";
    }

    try {
      await refreshProfilesCache();
      const nextProfile = resolveProfileInput(profilesCache, profileArg);

      if (!nextProfile) {
        writeOutput(`Unknown profile: ${profileArg}`);
        return "handled";
      }

      if (nextProfile.id === currentProfileId) {
        writeOutput(`Already using ${nextProfile.name}.`);
        return "handled";
      }

      currentProfileId = nextProfile.id;
      currentProfile = nextProfile;
      context.onProfileChange(currentProfileId, currentProfile);
      await saveCliProfileId(currentProfileId);
      session = await options.client.createSession(options.channel, {
        profileId: currentProfileId,
      });
      context.onSessionChange(session);
      lastUserMessage = null;
      writeOutput(`Profile switched to ${currentProfile.name}. Chat history reset.`);
    } catch (error) {
      writeOutput(formatError(error));
    }

    syncPendingMessages();
    return "handled";
  }

  async function handleCreateCommand(line: string): Promise<"handled"> {
    if (isStreaming) {
      writeOutput("Wait for the current response to finish.");
      return "handled";
    }

    const promptText = line.slice("/create".length).trim() || lastUserMessage;

    if (!promptText) {
      writeOutput("Usage: /create [prompt]");
      return "handled";
    }

    try {
      const automation = await session.createAutomation(promptText);
      writeOutput(JSON.stringify(automation, null, 2));
    } catch (error) {
      writeOutput(formatError(error));
    }

    return "handled";
  }

  async function handleSoulCommand(line: string): Promise<"handled"> {
    if (isStreaming) {
      writeOutput("Wait for the current response to finish.");
      return "handled";
    }

    const subcommand = line.slice("/soul".length).trim().toLowerCase();

    try {
      if (subcommand === "init") {
        const result = await options.client.initProfileSoul(currentProfileId);
        for (const outputLine of formatSoulInitLines(result)) {
          writeOutput(outputLine);
        }
      } else {
        const status = await options.client.getProfileSoulStatus(currentProfileId);
        for (const outputLine of formatSoulStatusLines(status)) {
          writeOutput(outputLine);
        }
      }
    } catch (error) {
      writeOutput(formatError(error));
    }

    return "handled";
  }

  async function handleUserCommand(line: string): Promise<"handled"> {
    if (isStreaming) {
      writeOutput("Wait for the current response to finish.");
      return "handled";
    }

    const subcommand = line.slice("/user".length).trim().toLowerCase();

    try {
      if (subcommand === "init") {
        const result = await options.client.initUserContext();
        for (const outputLine of formatUserInitLines(result)) {
          writeOutput(outputLine);
        }
      } else {
        const status = await options.client.getUserContext();
        for (const outputLine of formatUserStatusLines(status)) {
          writeOutput(outputLine);
        }
      }
    } catch (error) {
      writeOutput(formatError(error));
    }

    return "handled";
  }

  let exiting = false;

  const prompt = new PersistentPrompt({
    renderer,
    terminalInput,
    getSuggestions: (input) => {
      const active = effectiveModelState(currentProfile, modelsCache);

      return resolveSuggestions({
        input,
        models: modelsCache?.models,
        currentModel: active.modelId,
        currentProviderId: active.providerId,
        profiles: profilesCache,
        currentProfileId,
      });
    },
    onAbortStream: () => {
      if (isStreaming && abortController) {
        abortController.abort();
      }
    },
    onScrollHistory: (event) => {
      if (event === "line_up") {
        renderer.scrollLines(1);
        return;
      }

      if (event === "line_down") {
        renderer.scrollLines(-1);
        return;
      }

      if (event === "page_up") {
        renderer.scrollPage(1);
        return;
      }

      if (event === "page_down") {
        renderer.scrollPage(-1);
        return;
      }

      if (event === "home") {
        renderer.scrollPage(10_000);
        return;
      }

      renderer.scrollToLatest();
    },
    onCancel: () => {
      exiting = true;
    },
    onSubmit: async (result) => {
      const line = result.text.trim();
      const hasImages = Boolean(result.images?.length);

      if (!line && !hasImages) {
        return;
      }

      if (line.startsWith("/") || isExitCommand(line)) {
        const outcome = await handleSlashCommand(line);

        if (outcome === "exit") {
          exiting = true;
          return;
        }

        if (outcome === "handled") {
          return;
        }
      }

      await handleChatMessage(result);
    },
  });

  syncPendingMessages();
  prompt.start();

  function cleanupChat(): void {
    prompt.stop();
    renderer.reset();
    terminalInput.stop();
  }

  function onAbortSignal(): void {
    exiting = true;
  }

  options.signal?.addEventListener("abort", onAbortSignal);

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (exiting) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

  options.signal?.removeEventListener("abort", onAbortSignal);
  cleanupChat();
}

async function runBlockingChat(context: ChatContext): Promise<void> {
  const { options } = context;
  let session = context.session;
  let currentProfileId = context.currentProfileId;
  let processing = false;
  let modelsCache: ModelsResponse | null = null;
  let profilesCache: ProfileSummary[] = [];

  async function refreshModelsCache() {
    try {
      modelsCache = await options.client.getModels();
    } catch {
      modelsCache = null;
    }
  }

  async function refreshProfilesCache() {
    try {
      const response = await options.client.listProfiles();
      profilesCache = response.profiles;
    } catch {
      profilesCache = [];
    }
  }

  await refreshProfilesCache();

  if (!options.offline) {
    await refreshModelsCache();
  }

  const thinkingIndicator = new ThinkingIndicator();
  let lastChunk: string | null = null;

  function createStreamHandlers(): StreamHandlers {
    return {
      onThinking: () => {
        thinkingIndicator.start();
      },
      onChunk: (delta) => {
        thinkingIndicator.stop();
        lastChunk = delta;
        process.stdout.write(delta);
      },
      onToolStart: (event) => {
        thinkingIndicator.stop();
        process.stdout.write(`\n\x1b[2m [tool: ${event.tool}] \x1b[0m\n`);
      },
      onToolEnd: (event) => {
        process.stdout.write(`\x1b[2m [tool: ${event.tool} done] \x1b[0m\n`);
      },
    };
  }

  async function sendMessageStream(input: SendMessageInput): Promise<{ aborted: boolean }> {
    lastChunk = null;
    thinkingIndicator.start();

    try {
      return await sendStreamCancellable(session, input, createStreamHandlers());
    } catch (error) {
      thinkingIndicator.stop();
      throw error;
    }
  }

  function finishStreamOutput(aborted: boolean): void {
    thinkingIndicator.stop();

    if (aborted) {
      if (needsTrailingStreamNewline(lastChunk)) {
        process.stdout.write("\n");
      }

      process.stdout.write("\x1b[2m[stopped]\x1b[0m\n");
      return;
    }

    if (needsTrailingStreamNewline(lastChunk)) {
      process.stdout.write("\n");
    }
  }

  try {
    while (true) {
      let promptResult: PromptLineResult;

      try {
        promptResult = await promptLine("> ", {
          getSuggestions: (input) => {
            const profile =
              profilesCache.find((entry) => entry.id === currentProfileId) ?? null;
            const active = effectiveModelState(
              profile ?? { id: currentProfileId, name: "", model: null, isSuper: false, toolCount: 0, mcpServerCount: 0, soulActive: false, hasAvatar: false, createdAt: "", updatedAt: "" },
              modelsCache,
            );

            return resolveSuggestions({
              input,
              models: modelsCache?.models,
              currentModel: active.modelId,
              currentProviderId: active.providerId,
              profiles: profilesCache,
              currentProfileId,
            });
          },
        });
      } catch (error) {
        if (error instanceof PromptCancelledError) {
          break;
        }

        throw error;
      }

      const line = promptResult.text.trim();
      const hasImages = Boolean(promptResult.images?.length);

      if (!line && !hasImages) {
        continue;
      }

      if (line && isExitCommand(line)) {
        break;
      }

      if (processing) {
        continue;
      }

      processing = true;

      let sendInput: SendMessageInput;

      try {
        const fromPath = await parseImageLine(line);
        sendInput = mergeSendInput(line, {
          promptImages: promptResult.images,
          fromPath,
        });
      } catch (error) {
        console.log(`${formatError(error)}\n`);
        processing = false;
        continue;
      }

      try {
        const { aborted } = await sendMessageStream(sendInput);
        finishStreamOutput(aborted);
      } catch (error) {
        console.log(`${formatError(error)}\n`);
      } finally {
        processing = false;
      }
    }
  } finally {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?25h");
    }
  }
}

async function printCurrentModel(
  client: TinyClawClient,
  write: (text: string) => void = (text) => console.log(text),
  profile: ProfileSummary | null = null,
  cachedModels: ModelsResponse | null = null,
): Promise<void> {
  const models = cachedModels ?? (await client.getModels());
  const active = profile
    ? effectiveModelState(profile, models)
    : { modelId: null, providerId: models.currentProviderId };

  if (!models.provider || !active.modelId) {
    write("No model configured.");
    return;
  }

  write(`Provider: ${models.provider}`);
  write(`Model: ${active.modelId}`);
}

async function printModels(
  client: TinyClawClient,
  write: (text: string) => void = (text) => console.log(text),
  profile: ProfileSummary | null = null,
  cachedModels: ModelsResponse | null = null,
): Promise<void> {
  const models = cachedModels ?? (await client.getModels());

  if (!models.provider || models.models.length === 0) {
    write("No models available.");
    return;
  }

  const active = profile
    ? effectiveModelState(profile, models)
    : { modelId: null, providerId: models.currentProviderId };

  write(`Provider: ${models.provider}`);
  write(`Current: ${active.modelId ?? "none"}`);

  for (const model of models.models) {
    const markers = [
      isActiveModelOption(model, active) ? "*" : " ",
      model.default ? "(default)" : "",
    ]
      .filter(Boolean)
      .join(" ");

    write(
      `${markers} ${model.name} [${model.providerLabel ?? model.provider}] (${model.id})`,
    );
  }

  write("Use /model <id> or /model <provider-id>::<id> to switch.");
}

function formatError(error: unknown): string {
  return formatClientError(error);
}

function formatProfilesLines(
  profiles: ProfileSummary[],
  currentProfileId: string | null,
): string[] {
  const lines = ["Profiles:"];

  for (const profile of profiles) {
    const markers = [
      profile.id === currentProfileId ? "current" : null,
      profile.isSuper ? "orchestrator" : null,
    ]
      .filter(Boolean)
      .join(", ");

    lines.push(`  ${profile.id} — ${profile.name}${markers ? ` (${markers})` : ""}`);
  }

  lines.push("Use /profile <id> to switch.");
  return lines;
}

function formatSoulStatusLines(status: SoulStatusResponse): string[] {
  const lines = [
    `Soul directory: ${status.directory}`,
    `Active: ${status.active ? "yes" : "no"}`,
  ];

  if (status.profileId) {
    lines.push(`Profile: ${status.profileId}`);
  }

  lines.push(
    "Files:",
    `  SOUL.md     ${status.files.soul ? "✓" : "—"}`,
    `  STYLE.md    ${status.files.style ? "✓" : "—"}`,
    `  INSTRUCTIONS.md ${status.files.instructions ? "✓" : "—"}`,
    `  MEMORY.md   ${status.files.memory ? "✓" : "—"}`,
    `  examples/   ${status.files.examples ? "✓" : "—"}`,
  );

  if (!status.active) {
    lines.push("Soul files are missing. Run /soul init to scaffold templates for this profile.");
  } else {
    lines.push("Edit the files above to shape agent identity. Start a new session to reload.");
  }

  return lines;
}

function formatSoulInitLines(result: InitSoulResponse): string[] {
  const lines = [`Soul directory: ${result.directory}`];

  if (result.created.length === 0) {
    lines.push("Templates already exist — nothing created.");
    return lines;
  }

  lines.push("Created:");
  for (const file of result.created) {
    lines.push(`  ${file}`);
  }

  lines.push("Edit SOUL.md, STYLE.md, and INSTRUCTIONS.md, then start a new session.");
  return lines;
}

function formatUserStatusLines(status: UserContextStatusResponse): string[] {
  const lines = [`Active: ${status.active ? "yes" : "no"}`];

  if (!status.active) {
    lines.push("Run /user init to scaffold USER.md, or edit it in Settings (web).");
  } else {
    lines.push("Edit USER.md in Settings (web). Start a new session to reload.");
  }

  return lines;
}

function formatUserInitLines(result: InitUserContextResponse): string[] {
  const lines: string[] = [];

  if (!result.created) {
    lines.push("Template already exists — nothing created.");
  } else {
    lines.push("Created USER.md. Edit it in Settings (web), then start a new session.");
  }

  return lines;
}

function isExitCommand(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized === "/exit" || normalized === "/quit";
}
