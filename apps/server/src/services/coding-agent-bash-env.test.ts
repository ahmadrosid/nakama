import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import type { ProviderInstance } from "@nakama/core";
import { enrichCodingAgentBashInput } from "./coding-agent-bash-env";

const anthropicProvider: ProviderInstance = {
  id: "prov_anthropic",
  type: "anthropic",
  label: "Anthropic",
  apiKey: "sk-ant-test",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("enrichCodingAgentBashInput", () => {
  test("merges provider passthrough env when coding agent command is detected", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      id: "workspace-settings",
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [
        {
          id: "coding-harness-claude-code",
          kind: "claude_code",
          name: "Claude Code",
          command: "echo",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: "coding-harness-claude-code",
      updatedAt: new Date().toISOString(),
    });
    await db.upsertProfile({
      id: "profile_test",
      orgId: "org_test",
      name: "Test",
      systemPrompt: "test",
      model: "anthropic:claude-sonnet-4-6",
      isDefault: true,
      isSuper: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const enriched = (await enrichCodingAgentBashInput(
      db,
      { command: "echo hello" },
      { orgId: "org_test", profileId: "profile_test" },
      {
        providers: [anthropicProvider],
        defaultProviderId: anthropicProvider.id,
      },
    )) as { env?: Record<string, string> };

    expect(enriched.env?.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(enriched.env?.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
  });
});
