import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getProfileSoulDir, type ToolDefinition } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { handleAcpMcpRequest } from "../providers/acp/acp-mcp-tools";
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

describe("ACP profile in an automation run", () => {
  setupTestConfigDir("nakama-acp-automation-");

  // The agent connects to the MCP endpoint it was given when its session
  // starts. An endpoint with no tools registered answers "Unknown ACP session",
  // which the agent's MCP client waits on until its 30 second connect timeout.
  test("the agent's MCP endpoint serves the run's tools, web tools included", async () => {
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
          tool("plugin_watchlist__status"),
          tool("web_search"),
          tool("web_fetch"),
          tool("read_file"),
        ]),
    });

    const output = await service.runAutomationPrompt(
      "org_test",
      "profile_default",
      "mcp-url"
    );

    const token = output.split("/").pop()?.trim() ?? "";

    const reply = await handleAcpMcpRequest(token, {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
    });

    expect(reply.kind).toBe("reply");

    // SAFETY: A "reply" to tools/list carries { result: { tools } }.
    const names = (
      reply as { body: { result: { tools: { name: string }[] } } }
    ).body.result.tools.map((listed) => listed.name);

    // read_file stays hidden: the agent reads files itself. Its own web tools
    // are refused by the permission handler, so Nakama's must stay listed.
    expect(names).toContain("plugin_watchlist__status");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
    expect(names).not.toContain("read_file");
  });
});
