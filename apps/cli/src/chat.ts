import type { AgentChannel, InitSoulResponse, ModelsResponse, SoulStatusResponse } from "@tinyclaw/core";
import type { TinyClawClient } from "@tinyclaw/client";
import { formatSlashCommands, resolveSuggestions } from "./commands";
import { PromptCancelledError, promptLine } from "./prompt";

const HELP_TEXT = formatSlashCommands();

interface RunChatOptions {
  client: TinyClawClient;
  channel: AgentChannel;
  offline?: boolean;
}

export async function runChat(options: RunChatOptions): Promise<void> {
  let session = await options.client.createSession(options.channel);

  if (options.offline) {
    console.error("Server has no provider configured. Chat runs in offline mode.\n");
  } else {
    try {
      await printCurrentModel(options.client);
    } catch (error) {
      console.error(`${formatError(error)}`);
      console.error("Restart the server to pick up the latest API:\n  bun run dev:server\n");
    }
  }

  let processing = false;
  let lastUserMessage: string | null = null;
  let modelsCache: ModelsResponse | null = null;

  async function refreshModelsCache() {
    try {
      modelsCache = await options.client.getModels();
    } catch {
      modelsCache = null;
    }
  }

  if (!options.offline) {
    await refreshModelsCache();
  }

  try {
    while (true) {
      let line: string;

      try {
        line = (
          await promptLine("> ", {
            getSuggestions: (input) =>
              resolveSuggestions({
                input,
                models: modelsCache?.models,
                currentModel: modelsCache?.currentModel,
              }),
          })
        ).trim();
      } catch (error) {
        if (error instanceof PromptCancelledError) {
          break;
        }

        throw error;
      }

      if (!line) {
        continue;
      }

      if (isExitCommand(line)) {
        break;
      }

      if (line === "/clear") {
        await session.clear();
        lastUserMessage = null;
        console.log("History cleared.\n");
        continue;
      }

      if (line === "/help") {
        console.log(`${HELP_TEXT}\n`);
        continue;
      }

      if (line === "/models") {
        await printModels(options.client);
        continue;
      }

      if (line === "/model" || line.startsWith("/model ")) {
        const modelId = line.slice("/model".length).trim();

        if (!modelId) {
          await printCurrentModel(options.client);
          continue;
        }

        if (processing) {
          continue;
        }

        processing = true;

        try {
          const result = await options.client.setModel(modelId);
          session = await options.client.createSession(options.channel);
          lastUserMessage = null;
          await refreshModelsCache();
          console.log(
            `Model switched to ${result.currentModel}. Chat history reset.\n`,
          );
        } catch (error) {
          console.log(`${formatError(error)}\n`);
        } finally {
          processing = false;
        }

        continue;
      }

      if (line.startsWith("/create")) {
        if (processing) {
          continue;
        }

        const prompt = line.slice("/create".length).trim() || lastUserMessage;

        if (!prompt) {
          console.log("Usage: /create [prompt]\n");
          continue;
        }

        processing = true;

        try {
          const automation = await session.createAutomation(prompt);
          console.log(`${JSON.stringify(automation, null, 2)}\n`);
        } catch (error) {
          console.log(`${formatError(error)}\n`);
        } finally {
          processing = false;
        }

        continue;
      }

      if (line === "/soul" || line.startsWith("/soul ")) {
        if (processing) {
          continue;
        }

        const subcommand = line.slice("/soul".length).trim().toLowerCase();
        processing = true;

        try {
          if (subcommand === "init") {
            const result = await options.client.initSoul();
            printSoulInitResult(result);
          } else {
            const status = await options.client.getSoulStatus();
            printSoulStatus(status);
          }
        } catch (error) {
          console.log(`${formatError(error)}\n`);
        } finally {
          processing = false;
        }

        continue;
      }

      if (processing) {
        continue;
      }

      processing = true;
      lastUserMessage = line;

      try {
        await session.sendStream(line, {
          onChunk: (delta) => {
            process.stdout.write(delta);
          },
          onToolStart: (event) => {
            process.stdout.write(`\n\x1b[2m[tool: ${event.tool}]\x1b[0m\n`);
          },
          onToolEnd: (event) => {
            process.stdout.write(`\x1b[2m[tool: ${event.tool} done]\x1b[0m\n`);
          },
        });
        process.stdout.write("\n\n");
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

async function printCurrentModel(client: TinyClawClient): Promise<void> {
  const models = await client.getModels();

  if (!models.provider || !models.currentModel) {
    console.log("No model configured.\n");
    return;
  }

  console.log(`Provider: ${models.provider}`);
  console.log(`Model: ${models.currentModel}\n`);
}

async function printModels(client: TinyClawClient): Promise<void> {
  const models = await client.getModels();

  if (!models.provider || models.models.length === 0) {
    console.log("No models available.\n");
    return;
  }

  console.log(`Provider: ${models.provider}`);
  console.log(`Current: ${models.currentModel ?? "none"}\n`);

  for (const model of models.models) {
    const markers = [
      model.id === models.currentModel ? "*" : " ",
      model.default ? "(default)" : "",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(`${markers} ${model.name} [${model.provider}] (${model.id})`);
  }

  console.log("\nUse /model <id> to switch.\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printSoulStatus(status: SoulStatusResponse): void {
  console.log(`Soul directory: ${status.directory}`);
  console.log(`Active: ${status.active ? "yes" : "no"}`);

  if (status.profileId) {
    console.log(`Profile: ${status.profileId}`);
  }

  console.log("\nFiles:");
  console.log(`  SOUL.md     ${status.files.soul ? "✓" : "—"}`);
  console.log(`  STYLE.md    ${status.files.style ? "✓" : "—"}`);
  console.log(`  SKILL.md    ${status.files.skill ? "✓" : "—"}`);
  console.log(`  MEMORY.md   ${status.files.memory ? "✓" : "—"}`);
  console.log(`  examples/   ${status.files.examples ? "✓" : "—"}`);

  if (!status.active) {
    console.log("\nRun /soul init to scaffold templates in ~/.tinyclaw/\n");
    return;
  }

  console.log("\nEdit the files above to shape agent identity. Start a new session to reload.\n");
}

function printSoulInitResult(result: InitSoulResponse): void {
  console.log(`Soul directory: ${result.directory}`);

  if (result.created.length === 0) {
    console.log("Templates already exist — nothing created.\n");
    return;
  }

  console.log("\nCreated:");
  for (const file of result.created) {
    console.log(`  ${file}`);
  }

  console.log("\nEdit SOUL.md, STYLE.md, and SKILL.md, then start a new session.\n");
}

function isExitCommand(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized === "/exit" || normalized === "/quit";
}
