import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type GenerateChatInput,
  getProfileSoulDir,
  type ProfileResponse,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import type { AgentGroupMemoryChange } from "@nakama/core/agent-groups";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { groupWorkspace } from "./agent-group-workspace";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { resolveDefaultModelForInstance } from "./provider-instance-helpers";

const TEST_ORG_ID = "org_test";

const ORG_ID = "org_test";

interface AgentServiceSuperNakamaToolsAccess {
  superNakamaTools: ToolDefinition[];
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("shared agent direct configuration", () => {
  setupTestConfigDir("nakama-shared-direct-config-");

  test("blocks source configuration writes after revocation and keeps team memory writable", async () => {
    const db = createInMemoryDatabaseAdapter();

    const source = {
      ...createDefaultProfile(),
      isDefault: false,
      orgId: TEST_ORG_ID,
    };

    for (const id of [source.orgId, "team"]) {
      await db.upsertOrganization({
        createdAt: source.createdAt,
        id,
        name: id,
        parentOrgId: id === "team" ? source.orgId : null,
        slug: id,
        updatedAt: source.updatedAt,
      });
    }

    await db.upsertProfile(source);
    const storedSource = await db.getProfile(source.id);

    const publication = await db.publishOrgSharedResource({
      createdAt: source.createdAt,
      id: "publication",
      orgId: source.orgId,
      resourceId: source.id,
      resourceKind: "agent",
      updatedAt: source.updatedAt,
    });

    const profile = await db.createSharedAgentInstance(
      "team",
      publication.id,
      "shared",
      source.createdAt
    );

    const service = new AgentService(null, null, db);
    const directory = getProfileSoulDir("team", profile.id);
    await mkdir(directory, { recursive: true });

    for (const file of [
      "SOUL.md",
      "STYLE.md",
      "INSTRUCTIONS.md",
      "MEMORY.md",
      "USER.md",
    ]) {
      await writeFile(path.join(directory, file), file);
    }

    const meta = { actorUserId: "admin", source: "dashboard" as const };

    for (const revoked of [false, true]) {
      if (revoked) {
        await db.deleteOrgSharedResource(source.orgId, publication.id);
      }

      for (const key of ["soul", "style", "instructions"]) {
        await expect(
          service.writeProfileSoulFile(
            "team",
            profile.id,
            key,
            { content: "Changed" },
            meta
          )
        ).rejects.toMatchObject({ status: 403 });
      }

      await expect(
        service.setAcpDraftSetting("team", profile.id, "model", "Changed")
      ).rejects.toMatchObject({ status: 403 });
      expect(await db.getProfile(profile.id)).toEqual(profile);
      expect(await db.listProfileChangeEvents("team", profile.id)).toEqual([]);
    }

    await expect(
      service.writeProfileSoulFile(
        source.orgId,
        profile.id,
        "soul",
        { content: "Changed" },
        meta
      )
    ).rejects.toMatchObject({ status: 404 });

    for (const file of ["SOUL.md", "STYLE.md", "INSTRUCTIONS.md", "USER.md"]) {
      expect(await readFile(path.join(directory, file), "utf8")).toBe(file);
    }

    await service.writeProfileSoulFile(
      "team",
      profile.id,
      "memory",
      { content: "Team memory" },
      meta
    );
    expect(await readFile(path.join(directory, "MEMORY.md"), "utf8")).toBe(
      "Team memory"
    );
    expect(await db.getProfile(source.id)).toEqual(storedSource);
    await service.writeProfileSoulFile(source.orgId, source.id, "style", {
      content: "Local style",
    });
    expect(
      await readFile(
        path.join(getProfileSoulDir(source.orgId, source.id), "STYLE.md"),
        "utf8"
      )
    ).toBe("Local style");
  });
});

describe("Super Nakama provider inheritance", () => {
  setupTestConfigDir("nakama-inherited-provider-");

  test("persists each resolved provider selection on the new profile", async () => {
    for (const source of ["server default", "profile", "session"] as const) {
      const db = createInMemoryDatabaseAdapter();

      const profile = {
        ...createDefaultProfile(),
        isSuper: true,
        model: source === "server default" ? null : "openai-1::gpt-4.1",
      };

      await db.upsertProfile(profile);
      await db.upsertSession({
        agentQuestionnaire: null,
        agentTodos: [],
        channel: "web",
        createdAt: profile.createdAt,
        id: "super-session",
        model: source === "session" ? "openai-2::gpt-4.1-mini" : null,
        profileId: profile.id,
        title: null,
      });

      const provider = {
        apiKey: "test-key",
        createdAt: profile.createdAt,
        id: "openai-1",
        label: "OpenAI",
        type: "openai" as const,
      };

      const service = new AgentService(
        {
          defaultProviderId: provider.id,
          providers: [provider, { ...provider, id: "openai-2" }],
        },
        null,
        db
      );

      // SAFETY: This test checks the private tool built from its profile fixture.
      const tool = privateServiceAccess<AgentServiceSuperNakamaToolsAccess>(
        service
      ).superNakamaTools.find((entry) => entry.name === "create_profile");

      expect(tool).toBeDefined();

      // SAFETY: This test controls the fixture shape at this boundary.
      const result = (await tool!.run(
        { name: "New Agent" },
        {
          orgId: ORG_ID,
          profileId: profile.id,
          sessionId: "super-session",
        }
      )) as ProfileResponse;

      const expected =
        source === "session"
          ? "openai-2::gpt-4.1-mini"
          : (profile.model ??
            `${provider.id}::${resolveDefaultModelForInstance(provider)}`);

      expect(result.profile.model).toBe(expected);
      expect((await db.getProfile(result.profile.id))?.model).toBe(expected);
    }
  });
});

describe("AgentService sub-agent roles", () => {
  setupTestConfigDir("nakama-sub-agent-role-");

  test("reports completed memory writes but refuses a provider's late write after timeout", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = createDefaultProfile();
    await db.upsertProfile(profile);
    const service = new AgentService(null, null, db);

    const sharedDir = path.join(
      process.env.NAKAMA_CONFIG_DIR!,
      "group",
      "shared"
    );

    const resume = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const changes: AgentGroupMemoryChange[] = [];
    let calls = 0;
    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          async streamChat(input: GenerateChatInput) {
            calls += 1;

            if (calls === 2) {
              await resume.promise;
            }

            const content = calls === 3 ? "Done" : "";

            const toolCalls =
              calls === 3
                ? []
                : [
                    {
                      arguments: {
                        entry: calls === 1 ? "Before timeout" : "After timeout",
                      },
                      id: `memory-${calls}`,
                      name: "update_group_memory",
                    },
                  ];

            if (calls === 3) {
              expect(
                JSON.parse(String(input.messages.at(-1)?.content))
              ).toHaveProperty("error");
              finished.resolve();
            }

            return {
              assistantMessage: { content, role: "assistant", toolCalls },
              content,
              toolCalls,
            };
          },
        },
      }),
      resolveProfileSystemPrompt: async () => ({
        soulActive: false,
        systemPrompt: "Test",
      }),
      resolveProfileTools: async () => [],
    });

    const result = await service.runGroupTurn({
      agentDepth: 1,
      onGroupMemoryChange: (change) => changes.push(change),
      orgId: ORG_ID,
      profileId: profile.id,
      sharedDir,
      task: "Save memory",
      timeoutMs: 100,
    });

    expect(result.status).toBe("timeout");
    expect(changes).toEqual([{ newEntry: "- Before timeout", oldEntry: null }]);
    resume.resolve();
    // The timeout aborts the tool loop, so the late write usually never runs;
    // when a harness keeps going anyway, the tool refuses it.
    await Promise.race([finished.promise, Bun.sleep(200)]);
    expect(groupWorkspace(sharedDir).memory.read()).toBe("- Before timeout");
    expect(changes).toHaveLength(1);
  });

  test("uses the inherited role for the child prompt and tool execution", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);
    let promptRole: ToolContext["orgRole"];
    let toolRole: ToolContext["orgRole"];

    const tool: ToolDefinition = {
      description: "Observe child context",
      name: "observe_role",
      parameters: { properties: {}, type: "object" },
      run(_input, context) {
        toolRole = context.orgRole;

        return Promise.resolve({ ok: true });
      },
    };

    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat(input: GenerateChatInput) {
            const done = input.messages.at(-1)?.role === "tool";
            const content = done ? "Done" : "";

            const toolCalls = done
              ? []
              : [{ arguments: {}, id: "call_role", name: tool.name }];

            return Promise.resolve({
              assistantMessage: { content, role: "assistant", toolCalls },
              content,
              toolCalls,
            });
          },
        },
      }),
      resolveProfileSystemPrompt: (
        _orgId: string,
        _profileId: string,
        _prompt: string,
        orgRole: ToolContext["orgRole"]
      ) => {
        promptRole = orgRole;

        return Promise.resolve({ soulActive: false, systemPrompt: "Test" });
      },
      resolveProfileTools: () => Promise.resolve([tool]),
    });

    for (const orgRole of ["admin", "member", undefined] as const) {
      const result = await service.runSubAgentPrompt({
        agentDepth: 1,
        orgId: ORG_ID,
        orgRole,
        profileId: "profile_default",
        task: "Observe the child role",
      });

      expect(result.status).toBe("success");
      expect(promptRole).toBe(orgRole);
      expect(toolRole).toBe(orgRole);
    }
  });
});
