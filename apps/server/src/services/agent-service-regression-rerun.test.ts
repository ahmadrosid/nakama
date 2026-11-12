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

  test("a started run that fails resolves without the provider's error", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = createDefaultProfile();

    await db.upsertProfile(profile);

    const service = new AgentService(null, null, db);
    let hang = false;

    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat() {
            // A provider that ignores the abort signal.
            // The real adapters wrap the provider's raw body in a NakamaApiError.
            return hang
              ? new Promise(() => undefined)
              : Promise.reject(
                  buildProviderHttpError(
                    "OpenAI",
                    401,
                    '{"error":{"message":"Incorrect API key provided: sk-secret"}}'
                  )
                );
          },
        },
      }),
      resolveProfileSystemPrompt: () =>
        Promise.resolve({ soulActive: false, systemPrompt: "Test" }),
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

    hang = true;

    const controller = new AbortController();
    const pending = rerun(controller.signal);

    controller.abort();

    expect((await pending).output).toBeNull();
  });
});
