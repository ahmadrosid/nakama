/**
 * Live LLM cassette test: Super Bot create-profile end-to-end.
 *
 * Starts from a one-line user ask (real Super Bot confirm-first flow), then
 * continues briefly until `create_profile` is called. Asserts defaults after
 * executing the tool.
 *
 * Record (needs DeepSeek key in ~/.nakama config, or DEEPSEEK_API_KEY):
 *   LLM_VCR_MODE=record bun test src/tools/super-bot-create-profile.llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test src/tools/super-bot-create-profile.llm.test.ts
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  DEFAULT_BUNDLED_SKILL_NAMES,
  loadUserConfig,
  readBundledSkillBody,
  toLlmToolDefinition,
  type ChatMessage,
  type ProviderInstance,
  type ToolCall,
} from "@nakama/core";
import {
  SUPER_BOT_SYSTEM_PROMPT,
  SUPER_BOT_TOOL_AUTHORING_RULES,
  createInMemoryDatabaseAdapter,
  ensureBuiltinToolDefinitions,
} from "@nakama/db";
import { createProviderForInstance } from "../providers/create";
import { ProfileService } from "../services/profile-service";
import { SuperBotSessionState } from "../services/super-bot-session-state";
import { cassetteFilePath, loadCassette, withMswCassette } from "../testing/llm-msw-cassette";
import { createSuperBotTools } from "./super-bot-tools";

const cassetteName = "super-bot-create-profile";
const modelId = "deepseek-v4-flash";
const deepseekChatCompletionsUrl = "https://api.deepseek.com/chat/completions";
const ORG_ID = "org_super_bot_llm";
const SESSION_ID = "session_super_bot_llm";
const USER_ASK = "Create a Refund Support Bot for customer refund questions.";
const MAX_TURNS = 5;

const DEFAULT_TOOL_NAMES = [
  "read_file",
  "write_file",
  "edit_file",
  "search_files",
  "knowledge_base_search",
  "web_fetch",
] as const;

let tempConfigDir: string | null = null;
let previousConfigDir: string | undefined;

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }

  if (tempConfigDir) {
    await rm(tempConfigDir, { recursive: true, force: true });
    tempConfigDir = null;
  }
});

async function resolveDeepseekInstance(): Promise<ProviderInstance | null> {
  const config = await loadUserConfig();
  const configured =
    config?.providers.find((provider) => provider.type === "deepseek" && provider.apiKey.trim()) ??
    null;

  if (configured) {
    return configured;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    id: "env-deepseek",
    type: "deepseek",
    label: "DeepSeek",
    apiKey,
    createdAt: new Date().toISOString(),
  };
}

async function seedDefaultBundledSkills(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  root: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (const name of DEFAULT_BUNDLED_SKILL_NAMES) {
    await db.upsertSkill({
      id: `skill_${name.replaceAll("-", "_")}`,
      name,
      description: `Bundled skill ${name}`,
      sourcePath: join(root, "skills", name),
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function buildSuperBotSystemPrompt(): Promise<string> {
  const skillBody = await readBundledSkillBody("create-profile");
  return [
    SUPER_BOT_SYSTEM_PROMPT.trim(),
    "",
    SUPER_BOT_TOOL_AUTHORING_RULES.trim(),
    "",
    "# Active Skill: create-profile",
    skillBody.trim(),
  ].join("\n");
}

test(
  "Super Bot prompt + create-profile skill creates a profile with defaults",
  async () => {
    const cassettePath = cassetteFilePath(cassetteName);
    const existing = await loadCassette(cassettePath);
    const mode = process.env.LLM_VCR_MODE?.trim().toLowerCase();
    const instance = await resolveDeepseekInstance();

    if (!existing && mode !== "record" && !instance) {
      throw new Error(
        "Missing DeepSeek credentials to record super-bot-create-profile cassette. Set DEEPSEEK_API_KEY or configure a DeepSeek provider, then run with LLM_VCR_MODE=record.",
      );
    }

    previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    tempConfigDir = await mkdtemp(join(tmpdir(), "nakama-super-bot-create-profile-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    await seedDefaultBundledSkills(db, tempConfigDir);

    const profileService = new ProfileService(db);
    const sessionState = new SuperBotSessionState();
    sessionState.beginTurn(SESSION_ID);
    const tools = createSuperBotTools(profileService, sessionState);
    const toolDefs = tools.map(toLlmToolDefinition);
    const toolContext = { sessionId: SESSION_ID, orgId: ORG_ID };
    const createProfileTool = tools.find((entry) => entry.name === "create_profile");
    if (!createProfileTool) {
      throw new Error("create_profile tool missing");
    }

    await withMswCassette(
      cassetteName,
      async () => {
        const liveProvider = createProviderForInstance(
          instance ?? {
            id: "replay-deepseek",
            type: "deepseek",
            label: "DeepSeek",
            apiKey: "sk-replay-placeholder",
            createdAt: new Date().toISOString(),
          },
          modelId,
        );

        if (!liveProvider) {
          throw new Error("Failed to construct DeepSeek provider.");
        }

        const system = await buildSuperBotSystemPrompt();
        const messages: ChatMessage[] = [{ role: "user", content: USER_ASK }];
        let createCall: ToolCall | null = null;
        let confirmed = false;

        for (let turn = 0; turn < MAX_TURNS; turn += 1) {
          const result = await liveProvider.generateChat({
            system,
            messages,
            tools: toolDefs,
          });

          messages.push(result.assistantMessage);

          const found = result.toolCalls?.find((call) => call.name === "create_profile");
          if (found) {
            createCall = found;
            break;
          }

          if (result.toolCalls?.length) {
            for (const call of result.toolCalls) {
              const tool = tools.find((entry) => entry.name === call.name);
              const output = tool
                ? await tool.run(call.arguments, toolContext)
                : { error: `Unknown tool: ${call.name}` };
              messages.push({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: JSON.stringify(output),
              });
            }
            continue;
          }

          // Confirm-first skill drafts in chat before create_profile.
          if (!confirmed) {
            confirmed = true;
            messages.push({ role: "user", content: "yes" });
            continue;
          }

          break;
        }

        expect(createCall?.name).toBe("create_profile");

        const args = createCall?.arguments ?? {};
        expect(typeof args.name).toBe("string");
        expect(String(args.name).toLowerCase()).toContain("refund");
        expect(args.isSuper).not.toBe(true);

        const soulFiles = args.soulFiles;
        expect(typeof soulFiles === "object" && soulFiles !== null).toBe(true);
        const soul = soulFiles as Record<string, unknown>;
        expect(typeof soul["SOUL.md"]).toBe("string");
        expect(typeof soul["STYLE.md"]).toBe("string");
        expect(typeof soul["INSTRUCTIONS.md"]).toBe("string");
        expect(String(soul["SOUL.md"]).trim().length).toBeGreaterThan(0);
        expect(String(soul["STYLE.md"]).trim().length).toBeGreaterThan(0);
        expect(String(soul["INSTRUCTIONS.md"]).trim().length).toBeGreaterThan(0);
        if ("MEMORY.md" in soul) {
          expect(String(soul["MEMORY.md"] ?? "").trim()).toBe("");
        }

        const created = (await createProfileTool.run(args, toolContext)) as {
          profile: {
            id: string;
            name: string;
            systemPrompt: string;
            isSuper: boolean;
            tools: Array<{ name: string }>;
            skills: Array<{ name: string }>;
          };
        };

        expect(created.profile.name.toLowerCase()).toContain("refund");
        expect(created.profile.isSuper).toBe(false);
        expect(created.profile.systemPrompt.trim().length).toBeGreaterThan(0);

        const assignedToolNames = created.profile.tools.map((tool) => tool.name);
        for (const toolName of DEFAULT_TOOL_NAMES) {
          expect(assignedToolNames).toContain(toolName);
        }

        const assignedSkillNames = created.profile.skills.map((skill) => skill.name);
        for (const skillName of DEFAULT_BUNDLED_SKILL_NAMES) {
          expect(assignedSkillNames).toContain(skillName);
        }

        const soulDir = join(tempConfigDir!, "orgs", ORG_ID, "profiles", created.profile.id);
        const soulMd = await readFile(join(soulDir, "SOUL.md"), "utf8");
        const styleMd = await readFile(join(soulDir, "STYLE.md"), "utf8");
        const instructionsMd = await readFile(join(soulDir, "INSTRUCTIONS.md"), "utf8");
        const memoryMd = await readFile(join(soulDir, "MEMORY.md"), "utf8");

        expect(soulMd.trim().length).toBeGreaterThan(0);
        expect(styleMd.trim().length).toBeGreaterThan(0);
        expect(instructionsMd.trim().length).toBeGreaterThan(0);
        expect(memoryMd).toBe("");
        expect(soulMd).toBe(String(soul["SOUL.md"]));
        expect(styleMd).toBe(String(soul["STYLE.md"]));
        expect(instructionsMd).toBe(String(soul["INSTRUCTIONS.md"]));
      },
      { url: deepseekChatCompletionsUrl },
    );
  },
  { timeout: 180_000 },
);
