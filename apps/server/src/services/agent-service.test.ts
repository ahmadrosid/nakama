import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  ensureBundledSkillFiles,
  type GenerateChatInput,
  type ProviderClient,
  type ToolCall,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { McpClientManager } from "./mcp-client-manager";
import { McpService } from "./mcp-service";
import { SkillsService } from "./skills-service";

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

  test("chat MCP definitions and calls respect current assignment", async () => {
    for (const mode of [
      "eager",
      "lazy",
      "disabled",
      "unassigned",
      "moved",
      "removed",
      "shared",
      "unpublished",
      "search_revoked",
    ]) {
      if (mode === "eager") {
        delete process.env.NAKAMA_MCP_TOOL_DISCOVERY;
      } else {
        process.env.NAKAMA_MCP_TOOL_DISCOVERY = "1";
      }

      const db = createInMemoryDatabaseAdapter();
      const profile = createDefaultProfile();
      await db.upsertProfile(profile);
      await db.createUser({
        createdAt: profile.createdAt,
        email: "member@example.com",
        id: "member",
        passwordHash: "test",
        updatedAt: profile.updatedAt,
      });
      await db.upsertOrgMember({
        createdAt: profile.createdAt,
        orgId: TEST_ORG_ID,
        role: "member",
        userId: "member",
      });

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
        "member",
        { orgRole: "member" }
      );

      const session = (await agent.sessions.get(sessionId, TEST_ORG_ID))!;
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
  });
});

describe("AgentService /skill requests", () => {
  setupTestConfigDir("nakama-explicit-skill-");

  async function systemPromptFor(
    message: string,
    { assignMissingSkill = false } = {}
  ): Promise<string> {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());

    const skills = new SkillsService(db);
    await ensureBundledSkillFiles();
    await skills.syncDiscoveredSkills();

    const manage = (await skills.listSkills()).skills.find(
      (skill) => skill.name === "manage-skills"
    );

    await db.assignSkillToProfile("profile_default", manage!.id);

    if (assignMissingSkill) {
      // Assigned, but its files are gone, so it cannot load.
      const record = await db.getSkillByName("manage-skills");

      await db.upsertSkill({
        ...record!,
        id: "skill_ghost_notes",
        name: "ghost-notes",
        sourcePath: "/missing/ghost-notes",
      });

      await db.assignSkillToProfile("profile_default", "skill_ghost_notes");
    }

    const agent = new AgentService(null, null, db);
    agent.setSkillsService(skills);

    let system = "";

    const answer = {
      assistantMessage: { content: "ok", role: "assistant", toolCalls: [] },
      content: "ok",
      toolCalls: [],
    };

    const record = (input: GenerateChatInput) => {
      system = input.system ?? "";

      return Promise.resolve(answer);
    };

    Object.assign(agent, {
      _providerConfigured: true,
      createHarnessForProfile: () => ({
        provider: { generateChat: record, name: "openai", streamChat: record },
      }),
    });

    const sessionId = await agent.createSession(
      TEST_ORG_ID,
      "web",
      "profile_default",
      null
    );

    const session = await agent.sessions.get(sessionId, TEST_ORG_ID);
    await session?.send({ message });

    return system;
  }

  test("loads an assigned skill", async () => {
    const system = await systemPromptFor("/skill manage-skills list them");

    expect(system).toContain("# Active Skill: manage-skills");
    expect(system).not.toContain('asked for the skill "manage-skills"');
  });

  test("tells the agent when the named skill is not assigned", async () => {
    const system = await systemPromptFor("/skill ghost-notes summarize");

    expect(system).toContain('"ghost-notes"');
    expect(system).not.toContain("# Active Skill: ghost-notes");
  });

  test("ignores 'use skill' in ordinary prose", async () => {
    const system = await systemPromptFor("how do I use skill based routing?");

    expect(system).not.toContain('"based"');
  });

  test("does not tell the user to add a skill that is assigned but did not load", async () => {
    const system = await systemPromptFor("/skill ghost-notes summarize", {
      assignMissingSkill: true,
    });

    expect(system).toContain('"ghost-notes"');
    expect(system).not.toContain("# Active Skill: ghost-notes");
    expect(system).not.toContain("Add skill");
  });
});
