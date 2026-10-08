/**
 * Live LLM cassette test: Super Bot create-automation end-to-end.
 *
 * Starts from a one-line user ask (confirm-schedule skill flow), then
 * continues briefly until `create_automation` is called. Asserts the saved
 * automation after executing the tool.
 *
 * Record (needs DeepSeek key in ~/.nakama config, or DEEPSEEK_API_KEY):
 *   LLM_VCR_MODE=record bun test src/tools/super-bot-create-automation.llm.test.ts
 *
 * Replay (default when cassette exists; CI-safe):
 *   bun test src/tools/super-bot-create-automation.llm.test.ts
 */
import { expect, test } from "bun:test";
import {
  type ChatMessage,
  loadUserConfig,
  type ProviderInstance,
  readBundledSkillBody,
  type ToolCall,
  toLlmToolDefinition,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  SUPER_BOT_PROFILE_ID,
  SUPER_BOT_SYSTEM_PROMPT,
  SUPER_BOT_TOOL_AUTHORING_RULES,
} from "@nakama/db";
import { z } from "zod";
import { createProviderForInstance } from "../providers/create";
import { AutomationRunner } from "../services/automation-runner";
import { AutomationService } from "../services/automation-service";
import {
  cassetteFilePath,
  loadCassette,
  withMswCassette,
} from "../testing/llm-msw-cassette";
import { createAutomationTools } from "./automation-tools";

const cassetteName = "super-bot-create-automation";

const AutomationTriggerResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    cron: z.string(),
    timezone: z.string().optional(),
    type: z.literal("schedule"),
  }),
  z.object({
    at: z.string(),
    timezone: z.string().optional(),
    type: z.literal("runAt"),
  }),
]);

const CreateAutomationCallSchema = z.object({
  delivery: z.unknown().optional(),
  description: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  trigger: AutomationTriggerResultSchema,
});

const CreatedAutomationSchema = z.object({
  delivery: z.unknown(),
  description: z.string(),
  enabled: z.boolean(),
  id: z.string(),
  name: z.string(),
  nextRunAt: z.string().nullable(),
  prompt: z.string(),
  trigger: AutomationTriggerResultSchema,
});

const modelId = "deepseek-v4-flash";

const deepseekChatCompletionsUrl = "https://api.deepseek.com/chat/completions";

const ORG_ID = "org_super_bot_automation_llm";

const SESSION_ID = "session_super_bot_automation_llm";

const USER_TIMEZONE = "Asia/Jakarta";

const USER_ASK =
  "Remind me every Monday at 9am Asia/Jakarta to review open tasks. Just save the results — no delivery.";

const MAX_TURNS = 5;

async function resolveDeepseekInstance(): Promise<ProviderInstance | null> {
  const config = await loadUserConfig();

  const configured =
    config?.providers.find(
      (provider) => provider.type === "deepseek" && provider.apiKey.trim()
    ) ?? null;

  if (configured) {
    return configured;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    createdAt: new Date().toISOString(),
    id: "env-deepseek",
    label: "DeepSeek",
    type: "deepseek",
  };
}

async function buildSuperBotSystemPrompt(): Promise<string> {
  const skillBody = await readBundledSkillBody("create-automation");

  return [
    SUPER_BOT_SYSTEM_PROMPT.trim(),
    "",
    SUPER_BOT_TOOL_AUTHORING_RULES.trim(),
    "",
    "# Active Skill: create-automation",
    skillBody.trim(),
  ].join("\n");
}

async function seedOrgAndSuperBot(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
): Promise<void> {
  const now = new Date().toISOString();

  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Super Bot Automation Org",
    slug: "super-bot-automation-org",
    updatedAt: now,
  });

  await db.upsertProfile({
    createdAt: now,
    id: SUPER_BOT_PROFILE_ID,
    isDefault: false,
    isSuper: true,
    model: null,
    name: "Super Bot",
    orgId: ORG_ID,
    systemPrompt: SUPER_BOT_SYSTEM_PROMPT,
    updatedAt: now,
  });
}

test(
  "Super Bot prompt + create-automation skill creates a Monday schedule",
  async () => {
    const cassettePath = cassetteFilePath(cassetteName);
    const existing = await loadCassette(cassettePath);
    const mode = process.env.LLM_VCR_MODE?.trim().toLowerCase();
    const instance = await resolveDeepseekInstance();

    if (!existing && mode !== "record" && !instance) {
      throw new Error(
        "Missing DeepSeek credentials to record super-bot-create-automation cassette. Set DEEPSEEK_API_KEY or configure a DeepSeek provider, then run with LLM_VCR_MODE=record."
      );
    }

    const db = createInMemoryDatabaseAdapter();
    await seedOrgAndSuperBot(db);

    const automationService = new AutomationService(db, {
      getUserTimezone: async () => USER_TIMEZONE,
    });

    // SAFETY: This test only runs create_automation; its runner never invokes the agent.
    const automationRunner = new AutomationRunner(automationService, {
      runAutomationPrompt: async () => "ok",
    } as never);

    const tools = createAutomationTools(automationService, automationRunner);
    const toolDefs = tools.map(toLlmToolDefinition);

    const toolContext = {
      orgId: ORG_ID,
      orgRole: "admin" as const,
      profileId: SUPER_BOT_PROFILE_ID,
      sessionId: SESSION_ID,
    };

    const createAutomationTool = tools.find(
      (entry) => entry.name === "create_automation"
    );

    if (!createAutomationTool) {
      throw new Error("create_automation tool missing");
    }

    await withMswCassette(
      cassetteName,
      async () => {
        const liveProvider = createProviderForInstance(
          instance ?? {
            apiKey: "sk-replay-placeholder",
            createdAt: new Date().toISOString(),
            id: "replay-deepseek",
            label: "DeepSeek",
            type: "deepseek",
          },
          modelId
        );

        if (!liveProvider) {
          throw new Error("Failed to construct DeepSeek provider.");
        }

        const system = await buildSuperBotSystemPrompt();
        const messages: ChatMessage[] = [{ content: USER_ASK, role: "user" }];
        let createCall: ToolCall | null = null;
        let confirmed = false;

        for (let turn = 0; turn < MAX_TURNS; turn += 1) {
          const result = await liveProvider.generateChat({
            messages,
            system,
            tools: toolDefs,
          });

          messages.push(result.assistantMessage);

          const found = result.toolCalls?.find(
            (call) => call.name === "create_automation"
          );

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
                content: JSON.stringify(output),
                name: call.name,
                role: "tool",
                toolCallId: call.id,
              });
            }

            continue;
          }

          // Skill confirms schedule in chat before create_automation.
          if (!confirmed) {
            confirmed = true;
            messages.push({ content: "yes", role: "user" });
            continue;
          }

          break;
        }

        expect(createCall?.name).toBe("create_automation");

        const parsedArgs = CreateAutomationCallSchema.safeParse(
          createCall?.arguments
        );

        if (!parsedArgs.success) {
          throw new Error(
            "Model returned invalid create_automation arguments."
          );
        }

        const args = parsedArgs.data;
        const trigger = args.trigger;
        expect(args.prompt.toLowerCase()).toMatch(/task|review/);
        expect(trigger.type).toBe("schedule");

        if (trigger.type === "schedule") {
          expect(trigger.cron).toMatch(/\b9\b|\b09\b/);
          expect(trigger.cron).toMatch(/\b1\b/);
          expect(trigger.timezone).toBe(USER_TIMEZONE);
        }

        expect(args.delivery).toBeUndefined();

        const created = CreatedAutomationSchema.parse(
          await createAutomationTool.run(args, toolContext)
        );

        expect(created.id.startsWith("automation")).toBe(true);
        expect(created.name.trim().length).toBeGreaterThan(0);
        expect(created.prompt.toLowerCase()).toMatch(/task|review/);
        expect(created.trigger.type).toBe("schedule");

        if (created.trigger.type === "schedule") {
          expect(created.trigger.timezone ?? USER_TIMEZONE).toBe(USER_TIMEZONE);
        }

        expect(created.delivery).toBeNull();
        expect(created.enabled).toBe(true);
        expect(created.nextRunAt).not.toBeNull();

        const listed = await automationService.listForOrg(ORG_ID);
        expect(listed.automations).toHaveLength(1);
        expect(listed.automations[0]?.id).toBe(created.id);
        expect(listed.automations[0]?.profileId).toBe(SUPER_BOT_PROFILE_ID);
      },
      { url: deepseekChatCompletionsUrl }
    );
  },
  { timeout: 180_000 }
);
