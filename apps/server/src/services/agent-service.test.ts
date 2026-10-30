import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ProviderClient, ToolCall } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { McpClientManager } from "./mcp-client-manager";
import { McpService } from "./mcp-service";

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
