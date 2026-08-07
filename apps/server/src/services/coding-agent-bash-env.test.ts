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

const openaiProvider: ProviderInstance = {
  id: "prov_openai",
  type: "openai",
  label: "OpenAI",
  apiKey: "sk-openai-test",
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
      selectedCodingAgentHarness: null,
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

  test("resolves spawn env from command binary even when another harness is selected", async () => {
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
          command: "claude",
          args: [],
          enabled: true,
        },
        {
          id: "coding-harness-codex",
          kind: "codex",
          name: "Codex",
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
      model: "openai:gpt-4.1",
      isDefault: true,
      isSuper: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const enriched = (await enrichCodingAgentBashInput(
      db,
      { command: "echo exec task" },
      { orgId: "org_test", profileId: "profile_test" },
      {
        providers: [openaiProvider],
        defaultProviderId: openaiProvider.id,
      },
    )) as { env?: Record<string, string> };

    expect(enriched.env?.OPENAI_API_KEY).toBe("sk-openai-test");
    expect(enriched.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("fails closed when codingAgent is set without a known harness binary", async () => {
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
          command: "claude",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: "coding-harness-claude-code",
      updatedAt: new Date().toISOString(),
    });

    await expect(
      enrichCodingAgentBashInput(
        db,
        { command: "ls -la", codingAgent: true },
        { orgId: "org_test", profileId: "profile_test" },
        {
          providers: [anthropicProvider],
          defaultProviderId: anthropicProvider.id,
        },
      ),
    ).rejects.toThrow(/known coding-agent CLI/);
  });

  test("does not merge provider credentials for Cursor Agent when routing is active", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      id: "workspace-settings",
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [
        {
          id: "coding-harness-cursor-agent",
          kind: "cursor_agent",
          name: "Cursor Agent",
          command: "echo",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: null,
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
      { command: "echo -p 'task' --output-format text --yolo", codingAgent: true },
      { orgId: "org_test", profileId: "profile_test" },
      {
        providers: [anthropicProvider],
        defaultProviderId: anthropicProvider.id,
      },
    )) as { env?: Record<string, string>; codingAgent?: boolean };

    expect(enriched.codingAgent).toBe(true);
    expect(enriched.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(enriched.env?.OPENAI_API_KEY).toBeUndefined();
  });
});
