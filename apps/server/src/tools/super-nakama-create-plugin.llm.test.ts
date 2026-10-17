import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildToolExecutionContext,
  type ChatMessage,
  getProfileSoulDir,
  loadUserConfig,
  type ProviderInstance,
  readBundledSkillBody,
  toLlmToolDefinition,
} from "@nakama/core";
import { writeFileTool } from "@nakama/core/tools";
import {
  createInMemoryDatabaseAdapter,
  SUPER_NAKAMA_SYSTEM_PROMPT,
} from "@nakama/db";
import { z } from "zod";
import { createProviderForInstance } from "../providers/create";
import { PluginService } from "../services/plugin-service";
import { withMswCassette } from "../testing/llm-msw-cassette";
import { bashTool, runBash } from "./bash";

test(
  "Super Nakama creates a compiled local draft from chat without installing or executing it",
  async () => {
    const config =
      process.env.LLM_VCR_MODE?.trim().toLowerCase() === "record"
        ? await loadUserConfig()
        : null;

    const instance: ProviderInstance = config?.providers.find(
      (provider) => provider.type === "deepseek" && provider.apiKey.trim()
    ) ?? {
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() || "sk-replay-placeholder",
      createdAt: "2026-10-13T00:00:00Z",
      id: "plugin-draft-provider",
      label: "DeepSeek",
      type: "deepseek",
    };

    const root = await mkdtemp(join(tmpdir(), "nakama-plugin-chat-"));
    const previous = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = root;
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertOrganization({
      createdAt: now,
      id: "org_chat",
      name: "Chat",
      slug: "chat",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "super_chat",
      isDefault: false,
      isSuper: true,
      model: null,
      name: "Super",
      orgId: "org_chat",
      systemPrompt: "",
      updatedAt: now,
    });

    const context = buildToolExecutionContext({
      orgId: "org_chat",
      orgRole: "admin",
      profileId: "super_chat",
      sessionId: "plugin-chat",
      userId: "admin",
    });

    await mkdir(context.workspaceRoot!, { recursive: true });

    try {
      await withMswCassette(
        "super-nakama-create-plugin",
        async () => {
          const provider = createProviderForInstance(
            instance,
            "deepseek-v4-flash"
          );

          if (!provider) {
            throw new Error("Plugin drafting provider unavailable");
          }

          const messages: ChatMessage[] = [
            {
              content:
                "Create a minimal Nakama plugin named Greeting with ID greeting, version 1.0.0, and package name @test/greeting. Its greet action returns a greeting for a supplied name. Keep source and built output. No UI, database, workers, dependencies, execution tests, or install. Use write_file for every source file. Use direct bun commands only, one command per bash call; use cwd to select the draft directory. Build the action before finishing.",
              role: "user",
            },
          ];

          for (let turn = 0; turn < 12; turn += 1) {
            const result = await provider.generateChat({
              messages,
              system: [
                SUPER_NAKAMA_SYSTEM_PROMPT,
                "# Active skill: create-plugin",
                await readBundledSkillBody("create-plugin"),
              ].join("\n"),
              tools: [writeFileTool, bashTool].map(toLlmToolDefinition),
            });

            messages.push(result.assistantMessage);

            if (!result.toolCalls?.length) {
              break;
            }

            for (const call of result.toolCalls) {
              let output: unknown;

              if (call.name === "write_file") {
                const input = z
                  .object({ content: z.string(), path: z.string() })
                  .parse(call.arguments);

                expect(input.path.startsWith("plugin-drafts/greeting/")).toBe(
                  true
                );
                output = await writeFileTool.run(input, context);
              } else {
                expect(call.name).toBe("bash");

                const input = z
                  .object({ command: z.string(), cwd: z.string().optional() })
                  .parse(call.arguments);

                if (
                  !/^bun (?:--version|build [A-Za-z0-9_./ =-]+)$/.test(
                    input.command
                  )
                ) {
                  messages.push({
                    content: JSON.stringify({
                      error:
                        "Use one direct bun --version or bun build command. No shell wrappers, extra commands, or scripts.",
                    }),
                    name: call.name,
                    role: "tool",
                    toolCallId: call.id,
                  });
                  continue;
                }

                if (input.cwd) {
                  expect(input.cwd).toBe("plugin-drafts/greeting");
                }

                const result = await runBash(input, context, {
                  backend: "host",
                });

                expect(result.exitCode).toBe(0);
                output = result;
              }

              messages.push({
                content: JSON.stringify(output),
                name: call.name,
                role: "tool",
                toolCallId: call.id,
              });
            }
          }

          const directory = join(
            getProfileSoulDir("org_chat", "super_chat"),
            "plugin-drafts/greeting"
          );

          const manifest = JSON.parse(
            await readFile(join(directory, "nakama.plugin.json"), "utf8")
          );

          expect(manifest.id).toBe("greeting");
          expect(
            (await readFile(join(directory, manifest.actions[0].entry), "utf8"))
              .length
          ).toBeGreaterThan(0);
          expect(await db.listPluginReleases()).toHaveLength(0);
          expect(await db.getOrgPlugin("org_chat", "greeting")).toBeNull();

          const preview = await new PluginService(db, root).previewLocalPlugin(
            { draftId: "greeting", orgId: "org_chat", profileId: "super_chat" },
            { id: "admin", isPlatformAdmin: true }
          );

          expect(
            preview.files.some((file) => file.path.startsWith("src/"))
          ).toBe(true);
          expect(preview.manifest.actions).toHaveLength(1);
        },
        { url: "https://api.deepseek.com/chat/completions" }
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }

      await rm(root, { force: true, recursive: true });
    }
  },
  { timeout: 180_000 }
);
