import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  getProfileSoulDir,
  type ToolDefinition,
  writeRuntimeServerUrl,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import * as acpMcpTools from "../providers/acp/acp-mcp-tools";
import {
  acpMcpRequestSchema,
  handleAcpMcpRequest,
} from "../providers/acp/acp-mcp-tools";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

const FAKE_AGENT = fileURLToPath(
  new URL("../testing/acp-fake-agent.ts", import.meta.url)
);

const tool = (name: string): ToolDefinition => ({
  description: name,
  name,
  parameters: { properties: {}, type: "object" },
  run: () => Promise.resolve({ ran: name }),
});

const servers: Array<{ stop(): void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

/** The server's /v1/acp-mcp route, reduced to what the agent calls. */
function serveAcpMcp(tokens: string[]): string {
  const server = Bun.serve({
    fetch: async (request) => {
      const token = new URL(request.url).pathname.split("/").pop() ?? "";
      const parsed = acpMcpRequestSchema.safeParse(await request.json());
      tokens.push(token);

      if (!parsed.success) {
        return new Response(null, { status: 400 });
      }

      const reply = await handleAcpMcpRequest(token, parsed.data);

      return reply.kind === "reply"
        ? Response.json(reply.body)
        : Response.json({ error: "Unknown ACP session." }, { status: 404 });
    },
    port: 0,
  });

  servers.push(server);

  return `http://127.0.0.1:${server.port}`;
}

describe("ACP profile in an automation run", () => {
  setupTestConfigDir("nakama-acp-automation-");

  // An endpoint with no tools registered answered "Unknown ACP session", and
  // the agent's MCP client waited on that until its 30 second connect timeout.
  test("the agent lists the run's tools, web tools included, and they go when the run ends", async () => {
    const tokens: string[] = [];
    writeRuntimeServerUrl(serveAcpMcp(tokens));

    // The agent runs in the profile folder, so it has to exist.
    await mkdir(getProfileSoulDir("org_test", "profile_default"), {
      recursive: true,
    });

    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      acpAgent: { args: [FAKE_AGENT], command: "bun" },
    });

    const service = new AgentService(null, null, db);
    Object.assign(service, {
      _providerConfigured: true,
      resolveProfileSystemPrompt: () =>
        Promise.resolve({ soulActive: false, systemPrompt: "Test" }),
      resolveProfileTools: () =>
        Promise.resolve([
          tool("plugin_x__status"),
          tool("web_search"),
          tool("web_fetch"),
          tool("read_file"),
        ]),
    });

    const output = await service.runAutomationPrompt(
      "org_test",
      "profile_default",
      "mcp-tools"
    );

    // read_file stays hidden: the agent reads files itself. Its own web tools
    // are refused by the permission handler, so Nakama's must stay listed.
    expect(output).toBe("mcp tools: plugin_x__status,web_search,web_fetch");

    const afterRun = await handleAcpMcpRequest(tokens[0] ?? "", {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/list",
    });

    expect(afterRun).toEqual({ kind: "unknown" });
  });

  test("a sub-agent run that fails before it sends leaves no tool access", async () => {
    await mkdir(getProfileSoulDir("org_test", "profile_default"), {
      recursive: true,
    });

    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      acpAgent: { args: [FAKE_AGENT], command: "bun" },
    });

    const service = new AgentService(null, null, db);
    Object.assign(service, {
      _providerConfigured: true,
      resolveProfileSystemPrompt: () =>
        Promise.resolve({ soulActive: false, systemPrompt: "Test" }),
      resolveProfileTools: () => Promise.resolve([tool("plugin_x__status")]),
    });

    using registered = spyOn(acpMcpTools, "setAcpToolAccess");
    const failure = new Error("activity listener failed");

    await expect(
      service.runSubAgentPrompt({
        onActivity: () => {
          throw failure;
        },
        orgId: "org_test",
        profileId: "profile_default",
        task: "Do it",
      })
    ).rejects.toBe(failure);

    const sessionKey = registered.mock.calls[0]?.[0] ?? "";
    expect(sessionKey).not.toBe("");

    // A key still registered keeps its token; a cleared one gets a new token
    // that nothing answers for.
    const url = acpMcpTools.acpMcpServerFor(sessionKey).env?.[0]?.value ?? "";
    const token = url.split("/").pop() ?? "";

    expect(
      await acpMcpTools.handleAcpMcpRequest(token, {
        id: 1,
        jsonrpc: "2.0",
        method: "tools/list",
      })
    ).toEqual({ kind: "unknown" });

    acpMcpTools.clearAcpToolAccess(sessionKey);
  });
});
