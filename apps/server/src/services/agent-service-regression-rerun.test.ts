import { describe, expect, test } from "bun:test";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { buildProviderHttpError } from "../providers/shared";
import { setupTestConfigDir } from "../test-config-dir";
import { createSessionTools } from "../tools/session-tools";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import type { TurnKind } from "./turn-kinds";

interface AgentServiceProfileToolsAccess {
  resolveProfileTools(
    profile: StoredProfileRecord,
    kind: TurnKind
  ): Promise<ToolDefinition[]>;
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("regression rerun tools", () => {
  setupTestConfigDir("nakama-rerun-tools-");

  test("keeps mutating tools visible but refuses them without running", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = createDefaultProfile();
    const now = new Date().toISOString();

    await db.upsertProfile(profile);

    for (const [name, handlerType] of [
      ["read_file", "builtin"],
      ["write_file", "builtin"],
      ["web_fetch", "builtin"],
      ["read_profile_session", "session"],
    ] as const) {
      await db.upsertTool({
        createdAt: now,
        description: name,
        handlerConfig: { name },
        handlerType,
        id: `tool_${name}`,
        name,
        updatedAt: now,
      });
      await db.assignToolToProfile(profile.id, `tool_${name}`);
    }

    const service = new AgentService(null, null, db);

    service.setServerTools({ session: createSessionTools(service) });

    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const tool = async (kind: TurnKind, name: string) => {
      const found = (await resolve(profile, kind)).find(
        (item) => item.name === name
      );

      expect(found).toBeDefined();

      return found!;
    };

    const context: ToolContext = {
      orgId: profile.orgId!,
      profileId: profile.id,
    };

    const read = async () =>
      JSON.stringify(
        await (await tool("regression_rerun", "read_file"))
          .run({ path: "out.txt" }, context)
          .catch((error: Error) => error.message)
      );

    const write = { content: "changed", path: "out.txt" };

    expect(
      await (await tool("regression_rerun", "write_file")).run(write, context)
    ).toHaveProperty("error");
    expect(await read()).not.toContain("changed");

    await (await tool("automation", "write_file")).run(write, context);
    expect(await read()).toContain("changed");

    expect(await tool("regression_rerun", "read_file")).toBe(
      await tool("automation", "read_file")
    );

    // web_fetch reaches other hosts, and a session reader puts the caller's
    // own chats in an output that other members can read.
    for (const name of ["web_fetch", "read_profile_session"]) {
      expect(await tool("regression_rerun", name)).not.toBe(
        await tool("automation", name)
      );
    }

    const names = (await resolve(profile, "regression_rerun")).map(
      (item) => item.name
    );

    expect(names).toContain("org_memory_search");
    expect(await tool("regression_rerun", "org_memory_search")).toBe(
      await tool("automation", "org_memory_search")
    );
    expect(await tool("regression_rerun", "propose_org_memory")).not.toBe(
      await tool("automation", "propose_org_memory")
    );
  });

  test("refuses to rerun an ACP agent, whose own tools skip the gate", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      acpAgent: { args: [], command: "opencode" },
    };

    await db.upsertProfile(profile);

    const service = new AgentService(null, null, db);

    // A configured provider leaves the ACP check as the only refusal.
    Reflect.set(service, "_providerConfigured", true);

    await expect(
      service.runRegressionCase({
        input: "Why did the deploy fail?",
        orgId: profile.orgId!,
        profileId: profile.id,
        userId: "user_1",
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("a run that fails, gives no reply or loses its caller resolves as failed", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = createDefaultProfile();

    await db.upsertProfile(profile);

    const service = new AgentService(null, null, db);
    let mode: "empty" | "provider_hang" | "reject" | "setup_hang" = "reject";
    let leave = () => undefined;

    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat() {
            if (mode === "provider_hang") {
              // A provider that ignores the abort signal.
              leave();

              return new Promise(() => undefined);
            }

            if (mode === "empty") {
              return Promise.resolve({
                assistantMessage: { content: " ", role: "assistant" },
                content: " ",
                toolCalls: [],
              });
            }

            // The real adapters wrap the provider's raw body in a NakamaApiError.
            return Promise.reject(
              buildProviderHttpError(
                "OpenAI",
                401,
                '{"error":{"message":"Incorrect API key provided: sk-secret"}}'
              )
            );
          },
        },
      }),
      resolveProfileSystemPrompt: () => {
        if (mode === "setup_hang") {
          leave();

          return new Promise(() => undefined);
        }

        return Promise.resolve({ soulActive: false, systemPrompt: "Test" });
      },
    });

    const rerun = (signal?: AbortSignal) =>
      service.runRegressionCase({
        input: "Why did the deploy fail?",
        orgId: profile.orgId!,
        profileId: profile.id,
        signal,
        userId: "user_1",
      });

    const failed = await rerun();

    expect(failed.output).toBeNull();
    expect(failed.error).not.toContain("sk-secret");

    // No reply is no answer, so it cannot be marked pass.
    mode = "empty";
    expect(await rerun()).toMatchObject({
      error: expect.any(String),
      output: null,
    });

    // A caller that leaves is not kept waiting, in the run or in its setup.
    for (const stall of ["provider_hang", "setup_hang"] as const) {
      const controller = new AbortController();

      mode = stall;
      leave = () => controller.abort();

      expect(await rerun(controller.signal)).toMatchObject({
        error: expect.any(String),
        output: null,
      });
    }
  });
});
