import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ChatCompletionResult,
  ensureBundledSkillFiles,
  type GenerateChatInput,
  getProfileSoulDir,
  getUserConfigPath,
  loadDiscordConfigFile,
  loadTelegramConfigFile,
  loadUserConfig,
  loadWhatsAppConfigFile,
  type ProfileResponse,
  type ProviderClient,
  type ProviderInstance,
  saveUserConfig,
  type ToolCall,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { NETRA_AGENT_MODEL_ID } from "@nakama/core/discovery-providers";
import type { StoredProfileRecord } from "@nakama/db";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  mergeWorkspaceSettings,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { asTestFetch } from "../providers/test-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { AuthService } from "./auth-service";
import { LlmUsageTracker } from "./llm-usage-tracker";
import { McpClientManager } from "./mcp-client-manager";
import { McpService } from "./mcp-service";
import { OrgService } from "./org-service";
import { resolveDefaultModelForInstance } from "./provider-instance-helpers";
import { sessionTurnRegistry } from "./session-turn-registry";

const TEST_ORG_ID = "org_test";

describe("AgentService MCP discovery", () => {
  setupTestConfigDir("nakama-mcp-discovery-");
  const previous = process.env.NAKAMA_MCP_TOOL_DISCOVERY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.NAKAMA_MCP_TOOL_DISCOVERY;
    } else {
      process.env.NAKAMA_MCP_TOOL_DISCOVERY = previous;
    }
  });

  test.each([
    "eager",
    "lazy",
    "disabled",
    "unassigned",
    "moved",
    "removed",
    "shared",
    "unpublished",
    "search_revoked",
  ])(
    "chat MCP definitions and calls respect current assignment (%s)",
    async (mode) => {
      if (mode === "eager") {
        delete process.env.NAKAMA_MCP_TOOL_DISCOVERY;
      } else {
        process.env.NAKAMA_MCP_TOOL_DISCOVERY = "1";
      }

      const db = createInMemoryDatabaseAdapter();
      const profile = createDefaultProfile();
      await db.upsertProfile(profile);

      const server = {
        cachedTools: [{ description: "Read a file", name: "read_file" }],
        config: { url: "https://example.invalid/mcp" },
        createdAt: profile.createdAt,
        enabled: true,
        id: "mcp_assigned",
        lastError: null,
        name: "files",
        orgId: TEST_ORG_ID,
        status: "connected" as const,
        transport: "http" as const,
        updatedAt: profile.updatedAt,
      };

      await db.upsertMcpServer(server);
      await db.assignMcpServerToProfile(profile.id, server.id);
      await db.upsertMcpServer({
        ...server,
        id: "mcp_unassigned",
        name: "other",
      });
      await db.upsertMcpServer({
        ...server,
        enabled: false,
        id: "mcp_disabled",
        name: "disabled",
      });
      await db.assignMcpServerToProfile(profile.id, "mcp_disabled");
      const mcp = new McpService(db, new McpClientManager());
      const calls: string[] = [];

      using _call = spyOn(mcp, "callTool").mockImplementation(
        async (_server, _name, _input, orgId, profileId) => {
          calls.push(`${orgId}:${profileId}`);

          return { ok: true };
        }
      );

      const snapshots: string[][] = [];
      let published = true;

      const provider: ProviderClient = {
        async generateChat(input) {
          snapshots.push(input.tools?.map((tool) => tool.name) ?? []);
          const discovered = mode === "eager" || snapshots.length > 1;

          if (mode === "search_revoked" && snapshots.length === 1) {
            await db.unassignMcpServerFromProfile(profile.id, server.id);
          }

          if (snapshots.length === 2) {
            if (mode === "disabled") {
              await db.upsertMcpServer({ ...server, enabled: false });
            } else if (mode === "unassigned") {
              await db.unassignMcpServerFromProfile(profile.id, server.id);
            } else if (mode === "moved") {
              await db.upsertProfile({ ...profile, orgId: "other_org" });
            } else if (mode === "removed") {
              await db.deleteProfile(profile.id);
            } else if (mode === "unpublished") {
              published = false;
            }
          }

          const done = input.messages.some(
            (message) =>
              message.role === "tool" && message.name === "files__read_file"
          );

          const content = done ? "Done" : "";

          const toolCalls: ToolCall[] = done
            ? []
            : [
                {
                  arguments: discovered ? {} : { query: "read files" },
                  id: `call_${snapshots.length}`,
                  name: discovered ? "files__read_file" : "find_tools",
                },
              ];

          return {
            assistantMessage: { content, role: "assistant", toolCalls },
            content,
            toolCalls,
          };
        },
        generateText: async () => ({ content: "unused" }),
        name: "openai",
        async streamChat(input, handlers) {
          const result = await this.generateChat(input);
          handlers.onChunk(result.content);

          return result;
        },
      };

      const agent = new AgentService(null, null, db);
      agent.setMcpService(mcp);
      Object.assign(agent, { createHarnessForProfile: () => ({ provider }) });

      if (mode === "shared" || mode === "unpublished") {
        Object.assign(agent, {
          resolveSharedAgentProfile: async () =>
            published
              ? { ...profile, assignedMcpServers: [server], assignedTools: [] }
              : null,
        });
      }

      const sessionId = await agent.createSession(
        TEST_ORG_ID,
        "web",
        profile.id,
        null,
        { orgRole: "member" }
      );

      const session = (await agent.resolveSession(sessionId, TEST_ORG_ID))!;
      await session.send("Read a file");

      expect(snapshots[0]).not.toContain("other__read_file");
      expect(snapshots[0]).not.toContain("disabled__read_file");

      if (mode === "eager") {
        expect(snapshots[0]).toContain("files__read_file");
      } else {
        expect(snapshots[0]).not.toContain("files__read_file");
        expect(snapshots[0]).toContain("find_tools");

        if (mode === "search_revoked") {
          expect(snapshots[1]).not.toContain("files__read_file");
        } else {
          expect(snapshots[1]).toContain("files__read_file");
        }
      }

      const allowed = mode === "eager" || mode === "lazy" || mode === "shared";
      expect(calls).toEqual(allowed ? [`${TEST_ORG_ID}:${profile.id}`] : []);

      const result = session
        .getHistory()
        .find(
          (message) =>
            message.role === "tool" && message.name === "files__read_file"
        );

      expect(JSON.parse(String(result?.content))).toEqual(
        allowed ? { ok: true } : { error: expect.any(String) }
      );
    }
  );
});

describe("provider model publication removal", () => {
  setupTestConfigDir("nakama-provider-publication-removal-");
  const keptModel = { id: "gpt-4o-mini", name: "Kept" };
  const removedModel = { id: "retired-custom", name: "Removed" };

  async function setup(customModels?: ProviderInstance["customModels"]) {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    const config = {
      defaultProviderId: "provider-one",
      providers: ["provider-one", "provider-one-extra", "provider-two"].map(
        (id) => ({
          apiKey: "private-provider-key",
          createdAt: now,
          id,
          label: id,
          ...(customModels
            ? {
                baseUrl: "https://provider.example.invalid/v1",
                customModels,
                type: "openai_compatible" as const,
              }
            : { type: "openai" as const }),
        })
      ),
    };

    await saveUserConfig(config);
    await db.createUser({
      createdAt: now,
      email: "provider-admin@example.com",
      id: "admin",
      passwordHash: "test",
      updatedAt: now,
    });

    for (const id of ["root", "archived", "other"]) {
      await db.upsertOrganization({
        archivedAt: null,
        createdAt: now,
        id,
        name: id,
        slug: id,
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId: id,
        role: "admin",
        userId: "admin",
      });

      for (const [kind, resourceId] of [
        ["model", "provider-one::gpt-4o-mini"],
        ["model", "provider-two::gpt-4o-mini"],
        ["model", "provider-one-extra::gpt-4o-mini"],
        ["knowledge", "provider-one::gpt-4o-mini"],
      ] as const) {
        await db.publishOrgSharedResource({
          createdAt: now,
          id: `${id}_${kind}_${resourceId}`,
          orgId: id,
          resourceId,
          resourceKind: kind,
          updatedAt: now,
        });
      }

      if (customModels) {
        for (const providerId of ["provider-one", "provider-two"]) {
          await db.publishOrgSharedResource({
            createdAt: now,
            id: `${id}_${providerId}_removed`,
            orgId: id,
            resourceId: `${providerId}::${removedModel.id}`,
            resourceKind: "model",
            updatedAt: now,
          });
        }
      }

      if (id === "archived") {
        await db.upsertOrganization({
          archivedAt: now,
          createdAt: now,
          id,
          name: id,
          slug: id,
          updatedAt: now,
        });
      }
    }

    return {
      config,
      db,
      orgService: new OrgService(db, new AuthService()),
      service: new AgentService(config, null, db),
    };
  }

  test("deletion revokes every organization reference but preserves other providers and resource kinds", async () => {
    const { db, service } = await setup();
    expect(await service.deleteProvider("provider-one")).toEqual({
      defaultProviderId: "provider-one-extra",
    });

    for (const id of ["root", "archived", "other"]) {
      const publications = await db.listOrgSharedResources(id);
      expect(publications).toHaveLength(3);
      expect(
        publications.some(
          (entry) =>
            entry.resourceKind === "model" &&
            entry.resourceId === "provider-one::gpt-4o-mini"
        )
      ).toBe(false);
      expect(
        publications.some(
          (entry) =>
            entry.resourceKind === "knowledge" &&
            entry.resourceId === "provider-one::gpt-4o-mini"
        )
      ).toBe(true);
    }

    expect(
      (await loadUserConfig())?.providers.map((entry) => entry.id)
    ).toEqual(["provider-one-extra", "provider-two"]);
    expect(
      (await service.getModels()).providers.map((entry) => entry.id)
    ).toEqual(["provider-one-extra", "provider-two"]);
    await service.deleteProvider("provider-one-extra");
    expect(await service.deleteProvider("provider-two")).toEqual({
      defaultProviderId: null,
    });
    expect((await loadUserConfig())?.providers).toEqual([]);
    expect((await service.listProviders()).providers).toEqual([]);
  });

  test("a deletion retry revokes references after a database failure", async () => {
    const { db, service } = await setup();

    const failure = spyOn(db, "deleteOrgSharedResource").mockRejectedValueOnce(
      new Error("database unavailable")
    );

    try {
      await expect(service.deleteProvider("provider-one")).rejects.toThrow();
      expect(
        (await loadUserConfig())?.providers.some(
          (entry) => entry.id === "provider-one"
        )
      ).toBe(false);
      expect(
        (await service.listProviders()).providers.some(
          (entry) => entry.id === "provider-one"
        )
      ).toBe(false);
    } finally {
      failure.mockRestore();
    }

    await expect(service.deleteProvider("provider-one")).rejects.toThrow();

    for (const org of await db.listOrganizations()) {
      expect(
        (await db.listOrgSharedResources(org.id)).filter(
          (entry) =>
            entry.resourceKind === "model" &&
            entry.resourceId.startsWith("provider-one::")
        )
      ).toEqual([]);
    }
  });

  test("a failed configuration write preserves cached providers and publications", async () => {
    const { config, db, service } = await setup();
    const before = await db.listOrgSharedResources("root");
    const configPath = getUserConfigPath();
    await rm(configPath);
    await mkdir(configPath);

    try {
      await expect(service.deleteProvider("provider-one")).rejects.toThrow();
      expect(
        (await service.listProviders()).providers.map((entry) => entry.id)
      ).toEqual(config.providers.map((entry) => entry.id));
      expect(await db.listOrgSharedResources("root")).toEqual(before);
    } finally {
      await rm(configPath, { recursive: true });
      await saveUserConfig(config);
    }

    await expect(service.deleteProvider("provider-one")).resolves.toMatchObject(
      { defaultProviderId: "provider-one-extra" }
    );
  });

  test("provider deletion waits for publication insertion and then revokes it", async () => {
    const { db, orgService, service } = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const publish = db.publishOrgSharedResource.bind(db);

    const pending = spyOn(db, "publishOrgSharedResource").mockImplementation(
      async (record) => {
        entered.resolve();
        await release.promise;

        return publish(record);
      }
    );

    const publishing = orgService.publishSharedResource(
      "root",
      { resourceId: "provider-one::gpt-4o-mini", resourceKind: "model" },
      "admin"
    );

    await entered.promise;
    const deleting = service.deleteProvider("provider-one");

    try {
      expect(
        await Promise.race([
          deleting.then(() => true),
          Bun.sleep(20).then(() => false),
        ])
      ).toBe(false);
    } finally {
      release.resolve();
      await Promise.allSettled([publishing, deleting]);
      pending.mockRestore();
    }

    await expect(publishing).resolves.toMatchObject({
      resourceId: "provider-one::gpt-4o-mini",
    });
    await expect(deleting).resolves.toMatchObject({
      defaultProviderId: "provider-one-extra",
    });
    expect(
      (await db.listOrgSharedResources("root")).filter(
        (entry) =>
          entry.resourceKind === "model" &&
          entry.resourceId.startsWith("provider-one::")
      )
    ).toEqual([]);
  });

  test("provider updates remove only invalid model references and never republish restored models", async () => {
    const { db, service } = await setup([keptModel, removedModel]);

    const before = new Map(
      await Promise.all(
        (await db.listOrganizations()).map(
          async (org) =>
            [org.id, await db.listOrgSharedResources(org.id)] as const
        )
      )
    );

    await service.updateProvider("provider-one", { label: "Updated provider" });

    for (const [id, publications] of before) {
      expect(await db.listOrgSharedResources(id)).toEqual(publications);
    }

    const updated = await service.updateProvider("provider-one", {
      customModels: [keptModel],
    });

    expect(updated.provider).toMatchObject({
      id: "provider-one",
      label: "Updated provider",
      modelCount: 1,
    });
    expect(JSON.stringify(updated)).not.toContain("private-provider-key");

    for (const [id, publications] of before) {
      expect(await db.listOrgSharedResources(id)).toEqual(
        publications.filter(
          (entry) => entry.resourceId !== `provider-one::${removedModel.id}`
        )
      );
    }

    await service.updateProvider("provider-one", {
      customModels: [keptModel, removedModel],
    });
    expect(
      (await service.getModels()).models.some(
        (model) => model.id === removedModel.id
      )
    ).toBe(true);
    expect(
      (await db.listOrgSharedResources("root")).some(
        (entry) => entry.resourceId === `provider-one::${removedModel.id}`
      )
    ).toBe(false);
  });

  test("provider shortlist updates preserve other global provider access and publications", async () => {
    const { config, db } = await setup();

    const instance: ProviderInstance = {
      ...config.providers[0]!,
      customModels: [keptModel, removedModel],
    };

    const configured = {
      ...config,
      providers: [instance, ...config.providers.slice(1)],
    };

    await saveUserConfig(configured);
    const service = new AgentService(configured, null, db);
    const before = await db.listOrgSharedResources("root");
    await service.updateProvider("provider-one", {
      customModels: [removedModel],
    });
    expect(await db.listOrgSharedResources("root")).toEqual(
      before.filter(
        (entry) =>
          !(
            entry.resourceKind === "model" &&
            entry.resourceId === "provider-one::gpt-4o-mini"
          )
      )
    );
    expect(
      (await service.getModels()).models.some(
        (model) => model.id === keptModel.id
      )
    ).toBe(true);
    expect((await loadUserConfig())?.providers[0]?.customModels).toEqual([
      removedModel,
    ]);
  });

  test("invalid provider updates and failed file writes retain valid publication records", async () => {
    const { config, db, service } = await setup([keptModel, removedModel]);
    const before = await db.listOrgSharedResources("root");
    await expect(
      service.updateProvider("provider-one", { customModels: [] })
    ).rejects.toThrow();
    expect(await db.listOrgSharedResources("root")).toEqual(before);
    expect((await loadUserConfig())?.providers[0]?.customModels).toEqual([
      keptModel,
      removedModel,
    ]);
    const configPath = getUserConfigPath();
    await rm(configPath);
    await mkdir(configPath);

    try {
      await expect(
        service.updateProvider("provider-one", { customModels: [keptModel] })
      ).rejects.toThrow();
      expect((await service.listProviders()).providers[0]?.modelCount).toBe(2);
      expect(await db.listOrgSharedResources("root")).toEqual(before);
    } finally {
      await rm(configPath, { recursive: true });
      await saveUserConfig(config);
    }
  });

  test("an update retry removes stale references before restoring the model", async () => {
    const { db, service } = await setup([keptModel, removedModel]);

    const failure = spyOn(db, "deleteOrgSharedResource").mockRejectedValueOnce(
      new Error("database unavailable")
    );

    try {
      await expect(
        service.updateProvider("provider-one", { customModels: [keptModel] })
      ).rejects.toThrow();
      expect((await loadUserConfig())?.providers[0]?.customModels).toEqual([
        keptModel,
      ]);
      expect(
        (await db.listOrgSharedResources("root")).some(
          (entry) => entry.resourceId === `provider-one::${removedModel.id}`
        )
      ).toBe(true);
    } finally {
      failure.mockRestore();
    }

    await service.updateProvider("provider-one", {
      customModels: [keptModel, removedModel],
    });

    for (const org of await db.listOrganizations()) {
      expect(
        (await db.listOrgSharedResources(org.id)).some(
          (entry) => entry.resourceId === `provider-one::${removedModel.id}`
        )
      ).toBe(false);
    }
  });

  test("a pending provider update blocks publication of a removed model", async () => {
    const { db, orgService, service } = await setup([keptModel, removedModel]);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const remove = db.deleteOrgSharedResource.bind(db);

    const pending = spyOn(db, "deleteOrgSharedResource").mockImplementation(
      async (orgId, id) => {
        entered.resolve();
        await release.promise;

        return remove(orgId, id);
      }
    );

    const updating = service.updateProvider("provider-one", {
      customModels: [keptModel],
    });

    await entered.promise;
    let publicationFinished = false;

    const publishing = orgService.publishSharedResource(
      "root",
      { resourceId: `provider-one::${removedModel.id}`, resourceKind: "model" },
      "admin"
    );

    const observed = publishing.then(
      () => {
        publicationFinished = true;
      },
      () => {
        publicationFinished = true;
      }
    );

    try {
      await Bun.sleep(20);
      expect(publicationFinished).toBe(false);
    } finally {
      release.resolve();
      await Promise.allSettled([updating, observed]);
      pending.mockRestore();
    }

    await expect(updating).resolves.toMatchObject({
      provider: { id: "provider-one", modelCount: 1 },
    });
    await expect(publishing).rejects.toMatchObject({ status: 400 });
    expect(
      (await db.listOrgSharedResources("root")).some(
        (entry) => entry.resourceId === `provider-one::${removedModel.id}`
      )
    ).toBe(false);
  });
});

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

import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";

interface AgentServiceSuperBotToolsAccess {
  superBotTools: ToolDefinition[];
}

interface AgentServiceCodingContextAccess {
  formatCodingDelegationContext(
    orgId: string,
    profileId: string
  ): Promise<string>;
}

interface AgentServiceProfileToolsAccess {
  resolveProfileTools(
    profile: StoredProfileRecord,
    options?: {
      includeAutomationTools?: boolean;
      includeQuestionTools?: boolean;
      includeSkillManageTools?: boolean;
      includeTodoTools?: boolean;
    }
  ): Promise<Array<{ name: string }>>;
}

interface AgentServiceHarnessAccess {
  createHarness(options: {
    orgId: string;
    provider: ProviderClient;
    providerInstance: ProviderInstance;
    modelId: string;
    thinking: { enabled: boolean; effort: "medium" };
  }): { provider: ProviderClient };
}

interface AgentServiceProviderOptionsAccess {
  resolveChatProviderOptions: (
    providerInstance: ProviderInstance,
    thinkingSettings: { enabled: boolean; effort: "low" | "medium" | "high" }
  ) => { thinking?: { enabled: boolean; effort: string } } | undefined;
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("Super Bot provider inheritance", () => {
  setupTestConfigDir("nakama-inherited-provider-");

  test.each(["server default", "profile", "session"] as const)(
    "persists the resolved %s selection on the new profile",
    async (source) => {
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
      const tool = privateServiceAccess<AgentServiceSuperBotToolsAccess>(
        service
      ).superBotTools.find((entry) => entry.name === "create_profile");

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
  );
});

describe("AgentService sub-agent roles", () => {
  setupTestConfigDir("nakama-sub-agent-role-");

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

describe("AgentService branching", () => {
  test("reopens a saved session with a retired ChatGPT model", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());

    const sessionId = await new AgentService(null, null, db).createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.updateSessionModel(sessionId, "chatgpt-1::gpt-5.4-mini");

    const service = new AgentService(
      {
        defaultProviderId: "chatgpt-1",
        providers: [
          {
            apiKey: "",
            createdAt: "2026-09-16T00:00:00.000Z",
            id: "chatgpt-1",
            label: "ChatGPT",
            type: "chatgpt",
          },
        ],
      },
      null,
      db
    );

    expect((await service.getSessionMessages(sessionId, ORG_ID))?.model).toBe(
      "chatgpt-1::gpt-5.4-mini"
    );
    expect((await db.getSession(sessionId))?.model).toBe(
      "chatgpt-1::gpt-5.4-mini"
    );
  });

  test("keeps model selection scoped to the chat session", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      model: "provider-1::profile-default",
    });

    const service = new AgentService(
      {
        defaultProviderId: "provider-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "profile-default" },
              { id: "chat-model" },
              { id: "next-chat-model" },
            ],
            id: "provider-1",
            label: "Test provider",
            type: "openai_compatible",
          },
        ],
      },
      null,
      db
    );

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { model: "provider-1::chat-model" }
    );

    expect((await db.getProfile("profile_default"))?.model).toBe(
      "provider-1::profile-default"
    );
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::chat-model"
    );
    expect((await service.getSessionMessages(sessionId, ORG_ID))?.model).toBe(
      "provider-1::chat-model"
    );

    sessionTurnRegistry.beginTurn(sessionId);
    await expect(
      service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).rejects.toThrow("Wait for the current response");
    sessionTurnRegistry.cancelTurn(sessionId);
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::chat-model"
    );

    expect(
      await service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).toBe(true);
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );
    await expect(
      service.updateSessionModel(sessionId, ORG_ID, "provider-1::unknown")
    ).rejects.toThrow("Select a configured model");
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );
    await db.replaceMessagesForSession(sessionId, [
      {
        createdAt: "2026-08-25T00:00:00.000Z",
        id: "msg_session_model",
        payload: { content: "Keep the chat model", role: "user" },
        seq: 0,
        sessionId,
      },
    ]);

    const branch = await service.branchSession(sessionId, 0, ORG_ID);
    expect(branch).not.toBeNull();
    expect((await db.getSession(branch!.sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );

    expect(await service.updateSessionModel(sessionId, ORG_ID, null)).toBe(
      true
    );
    expect((await db.getSession(sessionId))?.model).toBeNull();
  });

  test("branches a new session from the selected message index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.replaceMessagesForSession(sourceSessionId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_1",
        payload: { content: "Hello", role: "user" },
        seq: 0,
        sessionId: sourceSessionId,
      },
      {
        createdAt: "2026-06-14T10:00:01.000Z",
        id: "msg_2",
        payload: { content: "Hi there", role: "assistant" },
        seq: 1,
        sessionId: sourceSessionId,
      },
      {
        createdAt: "2026-06-14T10:00:02.000Z",
        id: "msg_3",
        payload: { content: "Second turn", role: "user" },
        seq: 2,
        sessionId: sourceSessionId,
      },
    ]);
    await db.updateSessionTitle(sourceSessionId, "Original chat");
    await db.updateSessionTodos(sourceSessionId, [
      {
        content: "Keep this out of the branch",
        id: "todo_1",
        status: "pending",
      },
    ]);
    await db.updateSessionQuestionnaire(sourceSessionId, {
      id: "q_1",
      questions: [
        {
          allowCustomAnswer: true,
          choices: [],
          id: "timeline",
          prompt: "When?",
        },
      ],
      title: "Need input",
    });

    const result = await service.branchSession(sourceSessionId, 1, ORG_ID);

    expect(result).not.toBeNull();
    const branchSessionId = result!.sessionId;

    const branchMessages = await service.getSessionMessages(
      branchSessionId,
      ORG_ID
    );

    expect(branchMessages?.messages).toEqual([
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ]);
    expect(branchMessages?.messageMeta).toHaveLength(2);
    expect(
      branchMessages?.messageMeta.map((message) => message.createdAt)
    ).toEqual(["2026-06-14T10:00:00.000Z", "2026-06-14T10:00:01.000Z"]);

    const branchTodos = await service.getSessionTodos(branchSessionId, ORG_ID);
    expect(branchTodos).toEqual([]);
    expect(
      await service.getSessionQuestionnaire(branchSessionId, ORG_ID)
    ).toBeNull();

    const branchRecord = await db.getSession(branchSessionId);
    expect(branchRecord?.profileId).toBe("profile_default");
    expect(branchRecord?.channel).toBe("web");
    expect(branchRecord?.title).toBe("Original chat (Branch)");

    const sourceMessages = await service.getSessionMessages(
      sourceSessionId,
      ORG_ID
    );

    expect(sourceMessages?.messages).toHaveLength(3);
  });

  test("rejects an out-of-range branch index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.replaceMessagesForSession(sourceSessionId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_1",
        payload: { content: "Hello", role: "user" },
        seq: 0,
        sessionId: sourceSessionId,
      },
    ]);

    await expect(
      service.branchSession(sourceSessionId, 3, ORG_ID)
    ).rejects.toThrow("messageIndex is out of bounds.");
  });

  test("falls back to org default only when no profile is requested", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const now = new Date().toISOString();

    try {
      await db.upsertOrganization({
        createdAt: now,
        id: ORG_ID,
        name: "Test Org",
        slug: "test-org",
        updatedAt: now,
      });

      await db.upsertProfile({
        createdAt: now,
        id: "profile_custom",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Custom",
        orgId: ORG_ID,
        systemPrompt: "You are helpful.",
        updatedAt: now,
      });

      const service = new AgentService(null, null, db);
      await expect(
        service.createSession(ORG_ID, "web", "missing_profile")
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.listSessions()).toEqual([]);

      const sessionId = await service.createSession(ORG_ID, "web");
      const session = await db.getSession(sessionId);

      expect(session?.profileId).toBe("profile_custom");
    } finally {
      database.close();
    }
  });
});

describe("AgentService session org scope", () => {
  test("by-id reads return null for a session in another org", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: "profile_other",
      isDefault: false,
      name: "Other",
      orgId: "org_other",
    });
    const service = new AgentService(null, null, db);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    expect(await service.getSessionMessages(sessionId, "org_other")).toBeNull();
    expect(await service.resolveSession(sessionId, "org_other")).toBeNull();
    expect(await service.purgeSession(sessionId, "org_other")).toBe(false);
    expect(await db.getSession(sessionId)).not.toBeNull();
  });
});

describe("AgentService thinking provider options", () => {
  test("keeps thinking enabled for openai-compatible providers", () => {
    const db = createInMemoryDatabaseAdapter();

    const service = new AgentService(
      {
        defaultProviderId: "compat-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "qwen3.6-35b", supportsThinking: true },
            ],
            id: "compat-1",
            label: "NetraRuntime",
            type: "openai_compatible",
          },
        ],
        thinkingEffort: "high",
        thinkingEnabled: true,
      },
      null,
      db
    );

    // SAFETY: The test supplies valid provider and thinking values below.
    const options = privateServiceAccess<AgentServiceProviderOptionsAccess>(
      service
    ).resolveChatProviderOptions(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        createdAt: new Date().toISOString(),
        id: "compat-1",
        label: "NetraRuntime",
        type: "openai_compatible",
      },
      { effort: "high", enabled: true }
    );

    expect(options?.thinking).toEqual({ effort: "high", enabled: true });
  });
});

test("rejects a Netra provider when the model endpoint rejects its API key", async () => {
  using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    asTestFetch(async () => new Response("invalid key", { status: 401 }))
  );

  const service = new AgentService(null, null, createInMemoryDatabaseAdapter());

  await expect(
    service.createProvider({
      apiKey: "invalid-key",
      model: NETRA_AGENT_MODEL_ID,
      type: "netra",
    })
  ).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).toHaveBeenCalled();
});

test("discovers the supported Netra model without a custom base URL", async () => {
  using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    asTestFetch(async () =>
      Response.json({ data: [{ id: NETRA_AGENT_MODEL_ID }] })
    )
  );

  const service = new AgentService(null, null, createInMemoryDatabaseAdapter());

  const result = await service.discoverModels({
    apiKey: "test-key",
    provider: "netra",
  });

  expect(result.provider).toBe("netra");
  expect(result.models.map((model) => model.id)).toEqual([
    NETRA_AGENT_MODEL_ID,
  ]);
  expect(fetchMock).toHaveBeenCalled();
});

describe("AgentService usage pricing context", () => {
  setupTestConfigDir("nakama-usage-context-");

  test("retains each harness's rates when another provider completes during a stream", async () => {
    const db = createInMemoryDatabaseAdapter();
    const tracker = new LlmUsageTracker(db);

    const service = new AgentService(null, null, db, tracker);

    // SAFETY: The test builds the harness with the options shown below.
    const createHarness =
      privateServiceAccess<AgentServiceHarnessAccess>(
        service
      ).createHarness.bind(service);

    const result: ChatCompletionResult = {
      assistantMessage: { content: "ok", role: "assistant" },
      content: "ok",
      toolCalls: [],
      usage: {
        inputTokens: 100_000,
        outputTokens: 20_000,
        totalTokens: 120_000,
      },
    };

    const stream = Promise.withResolvers<ChatCompletionResult>();

    const provider: ProviderClient = {
      generateChat: () => Promise.resolve(result),
      generateText: () => Promise.resolve({ content: "unused" }),
      name: "openai",
      streamChat: () => stream.promise,
    };

    const options = {
      modelId: "gpt-5.5",
      orgId: ORG_ID,
      provider,
      providerInstance: {
        apiKey: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "api",
        label: "API",
        type: "openai" as const,
      },
      thinking: { effort: "medium" as const, enabled: false },
    };

    const api = createHarness.call(service, options).provider;

    const input = {
      messages: [{ content: "hi", role: "user" as const }],
      system: "s",
    };

    const pending = api.streamChat(input, { onChunk: () => undefined });

    const subscription = createHarness.call(service, {
      ...options,
      providerInstance: {
        ...options.providerInstance,
        id: "subscription",
        type: "chatgpt",
      },
    }).provider;

    expect((await subscription.generateChat(input)).usage?.costUsd).toBe(0);
    stream.resolve(result);
    expect((await pending).usage?.costUsd).toBeCloseTo(1.1);
    // Cached harnesses keep their own rates after another harness is built.
    expect((await api.generateChat(input)).usage?.costUsd).toBeCloseTo(1.1);
    expect((await tracker.getStats(ORG_ID)).estimatedCostUsd).toBeCloseTo(2.2);
    expect((await tracker.getStats(ORG_ID)).requestCount).toBe(3);
  });

  test("prices OpenAI image parsing independently of a DeepSeek primary", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      model: "primary::deepseek-v4-flash",
    };

    await db.upsertProfile(profile);
    const tracker = new LlmUsageTracker(db);

    const service = new AgentService(
      {
        defaultProviderId: "primary",
        providers: [
          {
            apiKey: "test",
            createdAt: profile.createdAt,
            id: "primary",
            label: "Primary",
            type: "deepseek",
          },
          {
            apiKey: "test",
            createdAt: profile.createdAt,
            id: "vision",
            label: "Vision",
            type: "openai",
          },
        ],
        visionModel: "vision::gpt-4o-mini",
      },
      null,
      db,
      tracker
    );

    using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch(async (...args: Parameters<typeof fetch>) => {
        const init = args[1];
        const body = JSON.parse(String(init?.body));

        if (body.model === "gpt-4o-mini") {
          return Response.json({
            choices: [{ message: { content: "A small image." } }],
            usage: { completion_tokens: 20_000, prompt_tokens: 100_000 },
          });
        }

        expect(body.model).toBe("deepseek-v4-flash");

        return Response.json({
          choices: [{ message: { content: "ok" } }],
          usage: { completion_tokens: 20_000, prompt_tokens: 100_000 },
        });
      })
    );

    const id = await service.createSession(ORG_ID, "web", profile.id);
    const session = await service.resolveSession(id, ORG_ID);
    await session!.send({
      images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
      message: "Describe the image",
    });
    const byModel = await tracker.getStatsByModel(ORG_ID);
    expect(
      byModel.find((row) => row.modelId === "gpt-4o-mini")?.estimatedCostUsd
    ).toBeCloseTo(0.027, 6);
    expect(
      byModel.find((row) => row.modelId === "deepseek-v4-flash")
        ?.estimatedCostUsd
    ).toBeCloseTo(0.054, 6);
    expect((await tracker.getStats(ORG_ID)).estimatedCostUsd).toBeCloseTo(
      0.081,
      6
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("AgentService vision settings", () => {
  setupTestConfigDir("nakama-vision-settings-");

  test.each(["primary", "vision"] as const)(
    "handles missing %s credentials without a provider call",
    async (missing) => {
      const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
      const originalOpenaiKey = process.env.OPENAI_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.OPENAI_API_KEY;

      using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
        asTestFetch(async () => {
          throw new Error("Unexpected provider call");
        })
      );

      try {
        const db = createInMemoryDatabaseAdapter();

        const profile = {
          ...createDefaultProfile(),
          model: "primary::deepseek-v4-flash",
        };

        await db.upsertProfile(profile);
        const tracker = new LlmUsageTracker(db);

        const service = new AgentService(
          {
            defaultProviderId: "primary",
            providers: [
              {
                apiKey: missing === "primary" ? "" : "test",
                createdAt: profile.createdAt,
                id: "primary",
                label: "Primary",
                type: "deepseek",
              },
              {
                apiKey: "",
                createdAt: profile.createdAt,
                id: "vision",
                label: "Vision",
                type: "openai",
              },
            ],
            visionModel: "vision::gpt-4o-mini",
          },
          null,
          db,
          tracker
        );

        const id = await service.createSession(ORG_ID, "web", profile.id);
        const session = await service.resolveSession(id, ORG_ID);
        expect(session).not.toBeNull();

        if (missing === "primary") {
          await session!.send("Hello");
          expect(session!.getHistory().map((message) => message.role)).toEqual([
            "user",
            "assistant",
          ]);
        } else {
          await expect(
            session!.send({
              images: [{ data: "aGVsbG8=", mediaType: "image/png" }],
              message: "Describe",
            })
          ).rejects.toMatchObject({ status: 400 });
          expect(session!.getHistory()).toEqual([]);
        }

        expect(fetchMock).not.toHaveBeenCalled();
        expect((await tracker.getStats(ORG_ID)).requestCount).toBe(0);
      } finally {
        if (originalDeepseekKey === undefined) {
          delete process.env.DEEPSEEK_API_KEY;
        } else {
          process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
        }

        if (originalOpenaiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalOpenaiKey;
        }
      }
    }
  );

  test("persists vision model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();

    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    const saved = await service.setVisionSettings({
      model: "p-openai-1::gpt-4o-mini",
    });

    expect(saved).toEqual({ vision: { model: "p-openai-1::gpt-4o-mini" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: null,
      visionModel: "p-openai-1::gpt-4o-mini",
    });
    expect(await service.getVisionSettings()).toEqual({
      vision: { model: "p-openai-1::gpt-4o-mini" },
    });
  });
});

describe("AgentService transcription settings", () => {
  test("persists transcription model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();

    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
            id: "p-openai-1",
            label: "OpenAI",
            type: "openai",
          },
        ],
      },
      null,
      db
    );

    const saved = await service.setTranscriptionSettings({
      model: "p-openai-1::whisper-1",
    });

    expect(saved).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: "p-openai-1::whisper-1",
    });
    expect(await service.getTranscriptionSettings()).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
  });

  test.each([
    {
      field: "visionModel",
      model: "p-openai-1::gpt-4o-mini",
      save: (service: AgentService) =>
        service.setVisionSettings({ model: "p-openai-1::gpt-4o-mini" }),
    },
    {
      field: "transcriptionModel",
      model: "p-openai-1::whisper-1",
      save: (service: AgentService) =>
        service.setTranscriptionSettings({ model: "p-openai-1::whisper-1" }),
    },
  ] as const)(
    "does not reset coding-agent passthrough when $field is saved",
    async ({ field, model, save }) => {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertWorkspaceSettings(
        mergeWorkspaceSettings(null, {
          codingAgentHarnesses: [],
          codingAgentProviderPassthrough: false,
          id: "workspace-settings",
          imageModel: null,
          selectedCodingAgentHarness: null,
          transcriptionModel: null,
          updatedAt: new Date().toISOString(),
          visionModel: null,
        })
      );

      const service = new AgentService(
        {
          defaultProviderId: "p-openai-1",
          providers: [
            {
              apiKey: "test-key",
              createdAt: new Date().toISOString(),
              id: "p-openai-1",
              label: "OpenAI",
              type: "openai",
            },
          ],
        },
        null,
        db
      );

      await save(service);

      expect(await db.getWorkspaceSettings()).toMatchObject({
        codingAgentProviderPassthrough: false,
        [field]: model,
      });
    }
  );
});

describe("AgentService coding delegation context", () => {
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
  let tempBinDir = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(
      path.join(tmpdir(), "nakama-agent-delegation-bin-")
    );
    process.env.PATH = tempBinDir;
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";
  });

  afterEach(async () => {
    process.env.PATH = originalPath;

    if (originalDisableFixPath === undefined) {
      delete process.env.NAKAMA_DISABLE_FIX_PATH;
    } else {
      process.env.NAKAMA_DISABLE_FIX_PATH = originalDisableFixPath;
    }

    if (tempBinDir) {
      await rm(tempBinDir, { force: true, recursive: true });
      tempBinDir = "";
    }
  });

  test("includes harness command template and backend guidance for bash delegation", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({ ...createDefaultProfile(), id: "profile_test" });
    await installFakeOpenCode(tempBinDir);
    await db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        codingAgentHarnesses: [
          {
            args: [],
            command: "opencode",
            enabled: true,
            id: "coding-harness-opencode",
            kind: "opencode",
            name: "OpenCode",
          },
        ],
        id: WORKSPACE_SETTINGS_ID,
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: new Date().toISOString(),
        visionModel: null,
      })
    );

    const service = new AgentService(null, null, db);

    // SAFETY: This test checks output for the configured coding-agent fixture.
    const context = await privateServiceAccess<AgentServiceCodingContextAccess>(
      service
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("bash");
    expect(context).toContain("opencode run");
    expect(context).not.toContain("delegate_coding_task");
    expect(context).not.toContain("workspace settings");
  });

  test("lists install commands when no coding agent CLI is installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({ ...createDefaultProfile(), id: "profile_test" });
    await db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        codingAgentHarnesses: [],
        id: WORKSPACE_SETTINGS_ID,
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: new Date().toISOString(),
        visionModel: null,
      })
    );

    const service = new AgentService(null, null, db);

    // SAFETY: This test checks output for the configured coding-agent fixture.
    const context = await privateServiceAccess<AgentServiceCodingContextAccess>(
      service
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("No coding agent CLI is installed");
    expect(context).toContain("npm install -g");
    expect(context).toContain("Cursor Agent CLI");
    expect(context).toContain("cannot be auto-installed");
    expect(context).not.toContain("workspace settings");
    expect(context).not.toContain("delegate_coding_task");
  });

  test("asks the user when multiple coding agent CLIs are installed", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({ ...createDefaultProfile(), id: "profile_test" });
    await installFakeOpenCode(tempBinDir);
    await Bun.write(
      path.join(
        tempBinDir,
        process.platform === "win32" ? "claude.cmd" : "claude"
      ),
      process.platform === "win32"
        ? "@echo off\r\necho claude\r\n"
        : "#!/bin/sh\necho claude\n"
    );
    await chmod(
      path.join(
        tempBinDir,
        process.platform === "win32" ? "claude.cmd" : "claude"
      ),
      0o755
    );

    await db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        codingAgentHarnesses: [
          {
            args: [],
            command: "opencode",
            enabled: true,
            id: "coding-harness-opencode",
            kind: "opencode",
            name: "OpenCode",
          },
          {
            args: [],
            command: "claude",
            enabled: true,
            id: "coding-harness-claude-code",
            kind: "claude_code",
            name: "Claude Code",
          },
        ],
        id: WORKSPACE_SETTINGS_ID,
        imageModel: null,
        selectedCodingAgentHarness: "coding-harness-opencode",
        transcriptionModel: null,
        updatedAt: new Date().toISOString(),
        visionModel: null,
      })
    );

    const service = new AgentService(null, null, db);

    // SAFETY: This test checks output for the configured coding-agent fixture.
    const context = await privateServiceAccess<AgentServiceCodingContextAccess>(
      service
    ).formatCodingDelegationContext("org_test", "profile_test");

    expect(context).toContain("Multiple coding agent CLIs are installed");
    expect(context).toContain("Ask the user which one to use");
    expect(context).toContain("OpenCode");
    expect(context).toContain("Claude Code");
    expect(context).not.toContain("opencode run");
  });
});

describe("AgentService skill_manage injection", () => {
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(
      path.join(tmpdir(), "nakama-skill-manage-inject-")
    );
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
  });

  test.each(["manage-skills", "skill-installer"])(
    "injects skill_manage for interactive chat when %s is assigned",
    async (skillName) => {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertProfile(createDefaultProfile());
      // Give the profile at least one own tool so the platform groups (incl.
      // skill_manage) are eligible; the no-tools case is covered separately.
      await db.upsertTool({
        createdAt: new Date().toISOString(),
        description: "Test tool",
        handlerConfig: { modulePath: "test.js" },
        handlerType: "javascript",
        id: "tool_for_skill_manage",
        name: "test_tool",
        updatedAt: new Date().toISOString(),
      });
      await db.assignToolToProfile("profile_default", "tool_for_skill_manage");
      const skills = new SkillsService(db);
      await ensureBundledSkillFiles();
      await skills.syncDiscoveredSkills();

      const manage = (await skills.listSkills()).skills.find(
        (skill) => skill.name === skillName
      );

      expect(manage).toBeDefined();
      await db.assignSkillToProfile("profile_default", manage!.id);

      const service = new AgentService(null, null, db);
      service.setSkillsService(skills);

      type ResolveTools = {
        resolveProfileTools(
          profile: StoredProfileRecord,
          options?: {
            includeAutomationTools?: boolean;
            includeSkillManageTools?: boolean;
          }
        ): Promise<Array<{ name: string }>>;
      };

      // SAFETY: This test checks the profile tool resolver for its fixture.
      const resolve =
        privateServiceAccess<AgentServiceProfileToolsAccess>(
          service
        ).resolveProfileTools.bind(service);

      const profile = createDefaultProfile();

      const webTools = await resolve(profile, {
        includeSkillManageTools: true,
      });

      expect(webTools.some((tool) => tool.name === "skill_manage")).toBe(true);

      const telegramTools = await resolve(profile, {
        includeSkillManageTools: false,
      });

      expect(telegramTools.some((tool) => tool.name === "skill_manage")).toBe(
        false
      );

      const automationTools = await resolve(profile, {
        includeAutomationTools: false,
      });

      expect(automationTools.some((tool) => tool.name === "skill_manage")).toBe(
        false
      );
    }
  );

  test("skips platform tool groups for a profile with no tools", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    type ResolveTools = {
      resolveProfileTools(
        profile: StoredProfileRecord,
        options?: {
          includeAutomationTools?: boolean;
          includeSkillManageTools?: boolean;
          includeTodoTools?: boolean;
          includeQuestionTools?: boolean;
        }
      ): Promise<Array<{ name: string }>>;
    };

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const profile = createDefaultProfile();

    // Profile with zero own tools: no platform groups, no session helpers.
    const tools = await resolve(profile, {
      includeAutomationTools: true,
      includeQuestionTools: true,
      includeSkillManageTools: true,
      includeTodoTools: true,
    });

    expect(tools).toHaveLength(0);

    // Give the profile one own tool; platform groups come back.
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Test tool",
      handlerConfig: { modulePath: "test.js" },
      handlerType: "javascript",
      id: "tool_for_platform_groups",
      name: "test_tool",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile("profile_default", "tool_for_platform_groups");

    const withTools = await resolve(profile, {
      includeAutomationTools: true,
      includeQuestionTools: true,
      includeSkillManageTools: true,
      includeTodoTools: true,
    });

    expect(withTools.some((tool) => tool.name === "test_tool")).toBe(true);
    expect(withTools.some((tool) => tool.name === "ask_user_question")).toBe(
      true
    );
    expect(withTools.some((tool) => tool.name === "todo_write")).toBe(true);
  });

  test("omits automation tools for a disabled profile", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      automationsEnabled: false,
    };

    await db.upsertProfile(profile);
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Test tool",
      handlerConfig: { modulePath: "test.js" },
      handlerType: "javascript",
      id: "tool_for_automation_gate",
      name: "test_tool",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile(profile.id, "tool_for_automation_gate");

    const service = new AgentService(null, null, db);
    service.setAutomationTools([
      // SAFETY: This test controls the fixture shape at this boundary.
      { name: "create_automation" } as ToolDefinition,
    ]);

    type ResolveTools = {
      resolveProfileTools(
        profile: StoredProfileRecord,
        options?: { includeAutomationTools?: boolean }
      ): Promise<Array<{ name: string }>>;
    };

    // SAFETY: This test checks the profile tool resolver for its fixture.
    const resolve =
      privateServiceAccess<AgentServiceProfileToolsAccess>(
        service
      ).resolveProfileTools.bind(service);

    const tools = await resolve(profile, { includeAutomationTools: true });
    expect(tools.some((tool) => tool.name === "create_automation")).toBe(false);
  });

  test("keeps raw /learn in history on web when manage-skills is assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    expect(manage).toBeDefined();
    await db.assignSkillToProfile("profile_default", manage!.id);

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { orgRole: "admin" }
    );

    const session = await service.resolveSession(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    const typed = "/learn filing an expense: open portal, submit receipt";
    await session!.send({ message: typed });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe(typed);
  });

  test("does not expand /learn on telegram even with manage-skills assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    expect(manage).toBeDefined();
    await db.assignSkillToProfile("profile_default", manage!.id);

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    const sessionId = await service.createSession(
      ORG_ID,
      "telegram",
      "profile_default",
      null,
      { orgRole: "admin" }
    );

    const session = await service.resolveSession(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    await session!.send({
      message: "/learn filing an expense",
    });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe("/learn filing an expense");
  });

  test("keeps bare /learn raw in history on cli", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    expect(manage).toBeDefined();
    await db.assignSkillToProfile("profile_default", manage!.id);

    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);

    const sessionId = await service.createSession(
      ORG_ID,
      "cli",
      "profile_default",
      null,
      { orgRole: "admin" }
    );

    const session = await service.resolveSession(sessionId, ORG_ID);
    expect(session).not.toBeNull();

    await session!.send({ message: "/learn" });

    const stored = await service.getSessionMessages(sessionId, ORG_ID);

    const userMessage = stored?.messages.find(
      (message) => message.role === "user"
    );

    expect(userMessage?.content).toBe("/learn");
  });
});

describe("AgentService bot token validation", () => {
  const originalFetch = globalThis.fetch;
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-bot-token-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  });

  test("rejects and does not persist a Telegram token rejected by Telegram", async () => {
    const botToken = "123456:QA-fake-token-xyz";
    let requestCount = 0;
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      requestCount += 1;

      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    });

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const error = await captureError(() =>
      service.setTelegramSettings(TEST_ORG_ID, { botToken })
    );

    const configured = (await service.getTelegramSettings(TEST_ORG_ID))
      .configured;

    expect({ configured, rejected: error !== null, requestCount }).toEqual({
      configured: false,
      rejected: true,
      requestCount: 1,
    });
    expect(error?.message).not.toContain(botToken);
    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toBeNull();
  });

  test("persists a Telegram token accepted by Telegram", async () => {
    let requestUrl = "";
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);

      return new Response(
        JSON.stringify({ ok: true, result: { id: 123_456, is_bot: true } }),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      );
    }) as typeof fetch;

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const saved = await service.setTelegramSettings(TEST_ORG_ID, {
      botToken: "123456:valid-token",
    });

    expect(saved.configured).toBe(true);
    expect(new URL(requestUrl).pathname).toBe("/bot123456%3Avalid-token/getMe");
    expect((await service.getTelegramSettings(TEST_ORG_ID)).configured).toBe(
      true
    );
  });

  test("rejects and does not persist a Discord token rejected by Discord", async () => {
    const botToken = "123456:QA-fake-token-xyz";
    let requestCount = 0;
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      requestCount += 1;

      return new Response(null, { status: 401 });
    });

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const error = await captureError(() =>
      service.setDiscordSettings({ botToken })
    );

    const configured = (await service.getDiscordSettings()).configured;

    expect({ configured, rejected: error !== null, requestCount }).toEqual({
      configured: false,
      rejected: true,
      requestCount: 1,
    });
    expect(error?.message).not.toContain(botToken);
    expect(await loadDiscordConfigFile()).toBeNull();
  });

  test("persists a Discord token accepted by Discord", async () => {
    let authorization = "";
    let requestCount = 0;
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = (async (_input, init) => {
      requestCount += 1;
      authorization = new Headers(init?.headers).get("Authorization") ?? "";

      return new Response(JSON.stringify({ id: "1525937133096013954" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    const saved = await service.setDiscordSettings({
      botToken: "valid-discord-token",
    });

    expect(saved.configured).toBe(true);
    expect(authorization).toBe("Bot valid-discord-token");
    expect((await service.getDiscordSettings()).configured).toBe(true);
    expect(requestCount).toBe(1);
  });

  test("preserves Telegram config after a rejected replacement and on token-less edits", async () => {
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () =>
        new Response(
          JSON.stringify({ ok: true, result: { id: 123_456, is_bot: true } }),
          { status: 200 }
        )
    );

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    await service.setTelegramSettings(TEST_ORG_ID, {
      allowedUserIds: "42",
      botToken: "123456:original-token",
      profileId: "original",
    });
    const beforeReplacement = await loadTelegramConfigFile(TEST_ORG_ID);

    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () => new Response(null, { status: 401 })
    );
    await expect(
      service.setTelegramSettings(TEST_ORG_ID, {
        allowedUserIds: "43",
        botToken: "123456:rejected-token",
        profileId: "replacement",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toEqual(
      beforeReplacement
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      throw new Error("Token-less Telegram edits must not call the provider.");
    });
    await service.setTelegramSettings(TEST_ORG_ID, {
      allowedUserIds: "43",
      profileId: "edited",
    });
    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toMatchObject({
      allowedUserIds: [43],
      botToken: "123456:original-token",
      profileId: "edited",
    });
  });

  test("revalidates a cached Discord token and preserves config when rejected", async () => {
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () =>
        new Response(JSON.stringify({ id: "1525937133096013954" }), {
          status: 200,
        })
    );

    const service = new AgentService(
      null,
      null,
      createInMemoryDatabaseAdapter()
    );

    await service.setDiscordSettings({
      allowedUserIds: "123456789012345678",
      botToken: "cached-discord-token",
      profileId: "original",
    });
    const beforeReplacement = await loadDiscordConfigFile();
    let rejectedRequestCount = 0;

    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(async () => {
      rejectedRequestCount += 1;

      return new Response(null, { status: 401 });
    });
    await expect(
      service.setDiscordSettings({
        allowedUserIds: "987654321098765432",
        botToken: "cached-discord-token",
        profileId: "replacement",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(rejectedRequestCount).toBe(1);
    expect(await loadDiscordConfigFile()).toEqual(beforeReplacement);

    await service.setDiscordSettings({
      allowedUserIds: "987654321098765432",
      profileId: "edited",
    });
    expect(await loadDiscordConfigFile()).toMatchObject({
      allowedUserIds: ["987654321098765432"],
      botToken: "cached-discord-token",
      profileId: "edited",
    });
  });

  test("returns credential-safe HTTP errors without creating channel configs", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const service = new AgentService(null, null, databaseAdapter);
    const { app } = createMinimalHonoApp({ agent: service, databaseAdapter });
    const session = await setupFreshInstallSession(app, databaseAdapter);
    // SAFETY: This test controls the fixture shape at this boundary.
    globalThis.fetch = asTestFetch(
      async () => new Response(null, { status: 401 })
    );

    for (const channel of ["telegram", "discord"] as const) {
      const botToken = `rejected-${channel}-token`;

      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/settings/${channel}`, {
          body: JSON.stringify({ botToken }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "PUT",
        })
      );

      // SAFETY: This test controls the fixture shape at this boundary.
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).not.toContain(botToken);
    }

    expect(await loadTelegramConfigFile(TEST_ORG_ID)).toBeNull();
    expect(await loadDiscordConfigFile()).toBeNull();
  });
});

describe("AgentService WhatsApp allowed phones", () => {
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-wa-allowed-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { force: true, recursive: true });
  });

  async function createWhatsAppService() {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: "well-test-report-validator",
    });

    return new AgentService(null, null, db);
  }

  test("writes allowed phones to WhatsApp config", async () => {
    const service = await createWhatsAppService();

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      allowedPhones: "+62 813-5231-1912",
      profileId: "well-test-report-validator",
    });

    expect(saved.allowedPhones).toEqual(["6281352311912"]);
    expect((await service.getWhatsAppSettings(ORG_ID)).allowedPhones).toEqual([
      "6281352311912",
    ]);
    expect((await loadWhatsAppConfigFile(ORG_ID))?.allowedPhones).toEqual([
      "6281352311912",
    ]);
  });

  test("keeps allowed phones when only the profile is saved", async () => {
    const service = await createWhatsAppService();
    await service.setWhatsAppSettings(ORG_ID, {
      allowedPhones: "6281352311912",
      profileId: "well-test-report-validator",
    });

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      profileId: "well-test-report-validator",
    });

    expect(saved.allowedPhones).toEqual(["6281352311912"]);
    expect((await loadWhatsAppConfigFile(ORG_ID))?.allowedPhones).toEqual([
      "6281352311912",
    ]);
  });

  test("writes requireGroupMention to WhatsApp config", async () => {
    const service = await createWhatsAppService();

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      profileId: "default",
      requireGroupMention: false,
    });

    expect(saved.requireGroupMention).toBe(false);
    expect(
      (await service.getWhatsAppSettings(ORG_ID)).requireGroupMention
    ).toBe(false);
    expect((await loadWhatsAppConfigFile(ORG_ID))?.requireGroupMention).toBe(
      false
    );
  });

  test("writes allowUnpairedGroupMembers to WhatsApp config", async () => {
    const service = await createWhatsAppService();

    const saved = await service.setWhatsAppSettings(ORG_ID, {
      allowUnpairedGroupMembers: true,
      profileId: "default",
    });

    expect(saved.allowUnpairedGroupMembers).toBe(true);
    expect(
      (await service.getWhatsAppSettings(ORG_ID)).allowUnpairedGroupMembers
    ).toBe(true);
    expect(
      (await loadWhatsAppConfigFile(ORG_ID))?.allowUnpairedGroupMembers
    ).toBe(true);
  });
});

describe("AgentService organization knowledge base", () => {
  setupTestConfigDir("nakama-org-knowledge-base-");

  test("serves organization documents through the profile service", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(null, null, db);

    const uploaded = await service.uploadOrganizationKnowledgeBaseDocument(
      ORG_ID,
      {
        data: Buffer.from("shared organization fact", "utf8").toString(
          "base64"
        ),
        filename: "shared.txt",
        mediaType: "text/plain",
      }
    );

    expect(uploaded.outcome).toBe("created");
    expect(uploaded.document.scope).toBe("organization");

    const listed = await service.listOrganizationKnowledgeBase(ORG_ID);
    expect(listed.documents.map((document) => document.id)).toEqual([
      uploaded.document.id,
    ]);

    const read = await service.readOrganizationKnowledgeBaseDocument(
      ORG_ID,
      uploaded.document.id
    );

    expect(read.filename).toBe("shared.txt");

    const deleted = await service.deleteOrganizationKnowledgeBaseDocument(
      ORG_ID,
      uploaded.document.id
    );

    expect(deleted.deleted).toBe(true);
    expect(deleted.documentId).toBe(uploaded.document.id);
  });
});

async function captureError<T>(run: () => Promise<T>): Promise<Error | null> {
  try {
    await run();

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function installFakeOpenCode(binDir: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(
      path.join(binDir, "opencode.cmd"),
      "@echo off\r\necho fake opencode\r\n"
    );

    return;
  }

  const scriptPath = path.join(binDir, "opencode");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      '  echo "fake opencode"',
      "  exit 0",
      "fi",
      "printf '%s' \"$*\"",
    ].join("\n")
  );
  await chmod(scriptPath, 0o755);
}

describe("AgentService automation resume", () => {
  setupTestConfigDir("nakama-automation-resume-");

  async function setup() {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertProfile(createDefaultProfile());
    await db.upsertAutomation({
      createdAt: now,
      definition: { trigger: { type: "manual" } },
      enabled: true,
      id: "auto_resume",
      name: "Resume",
      profileId: "profile_default",
      updatedAt: now,
      version: 1,
    });
    await db.insertAutomationRun({
      automationId: "auto_resume",
      completedAt: null,
      error: null,
      id: "run_resume",
      output: null,
      startedAt: now,
      status: "running",
    });
    const calls: string[] = [];
    const received: GenerateChatInput["messages"][] = [];

    const tool = (name: string, parallelSafe: boolean): ToolDefinition => ({
      description: name,
      name,
      parallelSafe,
      parameters: { properties: {}, type: "object" },
      run() {
        calls.push(name);

        return Promise.resolve({ ran: name });
      },
    });

    const tools = [
      tool("read_file", true),
      tool("writes", false),
      tool("sub_agent", true),
      tool("custom_write", true),
    ];

    const service = new AgentService(null, null, db);
    Object.assign(service, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat(input: GenerateChatInput) {
            received.push(input.messages);

            return Promise.resolve({
              assistantMessage: { content: "Finished", role: "assistant" },
              content: "Finished",
              toolCalls: [],
            });
          },
        },
      }),
      resolveProfileSystemPrompt: () =>
        Promise.resolve({ soulActive: false, systemPrompt: "Test" }),
      resolveProfileTools: () => Promise.resolve(tools),
    });

    const step = (
      position: number,
      toolCallId: string,
      toolName: string,
      done: boolean
    ) => ({
      args: "{}",
      completedAt: done ? now : null,
      position,
      result: done ? '{"ran":"earlier"}' : null,
      runId: "run_resume",
      startedAt: now,
      status: done ? ("completed" as const) : ("running" as const),
      toolCallId,
      toolGroupId: "group_1",
      toolName,
    });

    return { calls, db, received, service, step };
  }

  test("continues from saved steps and repeats only read-only tools", async () => {
    const { calls, db, received, service, step } = await setup();
    await db.insertAutomationRunStep(step(0, "call_done", "writes", true));
    await db.insertAutomationRunStep(step(1, "call_read", "read_file", false));
    await db.insertAutomationRunStep(step(2, "call_write", "writes", false));
    await db.insertAutomationRunStep(step(3, "call_sub", "sub_agent", false));
    await db.insertAutomationRunStep(
      step(4, "call_custom", "custom_write", false)
    );

    const output = await service.runAutomationPrompt(
      ORG_ID,
      "profile_default",
      "Do the job",
      "auto_resume",
      "run_resume",
      undefined,
      true
    );

    expect(output).toBe("Finished");
    // The cut read-only call runs again; neither write runs a second time.
    expect(calls).toEqual(["read_file"]);
    const toolMessages = received[0]?.filter((m) => m.role === "tool") ?? [];
    expect(toolMessages.map((m) => m.toolCallId)).toEqual([
      "call_done",
      "call_read",
      "call_write",
      "call_sub",
      "call_custom",
    ]);
    expect(toolMessages[1]?.content).toContain("read_file");
    expect(toolMessages[2]?.content).toContain("error");
    expect(toolMessages[3]?.content).toContain("error");
    expect(toolMessages[4]?.content).toContain("error");

    const steps = await db.listAutomationRunSteps("run_resume");
    expect(steps.every((item) => item.status === "completed")).toBe(true);
  });

  test("saves each tool call of a fresh run", async () => {
    const { db, service } = await setup();
    Object.assign(service, {
      createHarnessForProfile: () => ({
        provider: {
          name: "openai",
          streamChat(input: GenerateChatInput) {
            const done = input.messages.at(-1)?.role === "tool";

            const toolCalls = done
              ? []
              : [{ arguments: { q: 1 }, id: "call_new", name: "read_file" }];

            return Promise.resolve({
              assistantMessage: {
                content: done ? "Done" : "",
                role: "assistant",
                toolCalls,
              },
              content: done ? "Done" : "",
              toolCalls,
            });
          },
        },
      }),
    });

    await service.runAutomationPrompt(
      ORG_ID,
      "profile_default",
      "Do the job",
      "auto_resume",
      "run_resume",
      { onChunk() {} }
    );

    const steps = await db.listAutomationRunSteps("run_resume");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("completed");
    expect(steps[0]?.args).toBe('{"q":1}');
  });
});
