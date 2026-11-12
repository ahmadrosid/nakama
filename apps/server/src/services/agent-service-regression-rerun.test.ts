import { describe, expect, test } from "bun:test";
import type { ToolContext, ToolDefinition } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
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

    for (const name of ["read_file", "write_file"]) {
      await db.upsertTool({
        createdAt: now,
        description: name,
        handlerConfig: { name },
        handlerType: "builtin",
        id: `tool_${name}`,
        name,
        updatedAt: now,
      });
      await db.assignToolToProfile(profile.id, `tool_${name}`);
    }

    const service = new AgentService(null, null, db);

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
    ).toEqual({ error: expect.stringContaining("Refused: write_file") });
    expect(await read()).not.toContain("changed");

    await (await tool("automation", "write_file")).run(write, context);
    expect(await read()).toContain("changed");

    expect(await tool("regression_rerun", "read_file")).toBe(
      await tool("automation", "read_file")
    );

    const names = (await resolve(profile, "regression_rerun")).map(
      (item) => item.name
    );

    expect(names).toContain("org_memory_search");
    expect(names).not.toContain("propose_org_memory");
  });

  test("refuses to rerun an ACP agent, whose own tools skip the gate", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      acpAgent: { args: [], command: "opencode" },
    };

    await db.upsertProfile(profile);

    await expect(
      new AgentService(null, null, db).runRegressionCase({
        input: "Why did the deploy fail?",
        orgId: profile.orgId!,
        profileId: profile.id,
        userId: "user_1",
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});
