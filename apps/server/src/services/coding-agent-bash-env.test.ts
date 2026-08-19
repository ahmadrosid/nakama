import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { enrichCodingAgentBashInput } from "./coding-agent-bash-env";

const anthropicProvider: ProviderInstance = {
  apiKey: "sk-ant-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "prov_anthropic",
  label: "Anthropic",
  type: "anthropic",
};

const openaiProvider: ProviderInstance = {
  apiKey: "sk-openai-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "prov_openai",
  label: "OpenAI",
  type: "openai",
};

describe("enrichCodingAgentBashInput", () => {
  test("merges provider passthrough env when coding agent command is detected", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [
        {
          args: [],
          command: "echo",
          enabled: true,
          id: "coding-harness-claude-code",
          kind: "claude_code",
          name: "Claude Code",
        },
      ],
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });
    await db.upsertProfile({
      createdAt: new Date().toISOString(),
      id: "profile_test",
      isDefault: true,
      isSuper: false,
      model: "anthropic:claude-sonnet-4-6",
      name: "Test",
      orgId: "org_test",
      systemPrompt: "test",
      updatedAt: new Date().toISOString(),
    });

    const enriched = (await enrichCodingAgentBashInput(
      db,
      { command: "echo hello" },
      { orgId: "org_test", profileId: "profile_test" },
      {
        defaultProviderId: anthropicProvider.id,
        providers: [anthropicProvider],
      }
    )) as { env?: Record<string, string> };

    expect(enriched.env?.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(enriched.env?.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
  });

  test("resolves spawn env from command binary even when another harness is selected", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [
        {
          args: [],
          command: "claude",
          enabled: true,
          id: "coding-harness-claude-code",
          kind: "claude_code",
          name: "Claude Code",
        },
        {
          args: [],
          command: "echo",
          enabled: true,
          id: "coding-harness-codex",
          kind: "codex",
          name: "Codex",
        },
      ],
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: "coding-harness-claude-code",
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });
    await db.upsertProfile({
      createdAt: new Date().toISOString(),
      id: "profile_test",
      isDefault: true,
      isSuper: false,
      model: "openai:gpt-4.1",
      name: "Test",
      orgId: "org_test",
      systemPrompt: "test",
      updatedAt: new Date().toISOString(),
    });

    const enriched = (await enrichCodingAgentBashInput(
      db,
      { command: "echo exec task" },
      { orgId: "org_test", profileId: "profile_test" },
      {
        defaultProviderId: openaiProvider.id,
        providers: [openaiProvider],
      }
    )) as { env?: Record<string, string> };

    expect(enriched.env?.OPENAI_API_KEY).toBe("sk-openai-test");
    expect(enriched.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("fails closed when codingAgent is set without a known harness binary", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [
        {
          args: [],
          command: "claude",
          enabled: true,
          id: "coding-harness-claude-code",
          kind: "claude_code",
          name: "Claude Code",
        },
      ],
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: "coding-harness-claude-code",
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });

    await expect(
      enrichCodingAgentBashInput(
        db,
        { codingAgent: true, command: "ls -la" },
        { orgId: "org_test", profileId: "profile_test" },
        {
          defaultProviderId: anthropicProvider.id,
          providers: [anthropicProvider],
        }
      )
    ).rejects.toThrow(/known coding-agent CLI/);
  });

  test("does not merge provider credentials for Cursor Agent when routing is active", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [
        {
          args: [],
          command: "echo",
          enabled: true,
          id: "coding-harness-cursor-agent",
          kind: "cursor_agent",
          name: "Cursor Agent",
        },
      ],
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });
    await db.upsertProfile({
      createdAt: new Date().toISOString(),
      id: "profile_test",
      isDefault: true,
      isSuper: false,
      model: "anthropic:claude-sonnet-4-6",
      name: "Test",
      orgId: "org_test",
      systemPrompt: "test",
      updatedAt: new Date().toISOString(),
    });

    const enriched = (await enrichCodingAgentBashInput(
      db,
      {
        codingAgent: true,
        command: "echo -p 'task' --output-format text --yolo",
      },
      { orgId: "org_test", profileId: "profile_test" },
      {
        defaultProviderId: anthropicProvider.id,
        providers: [anthropicProvider],
      }
    )) as { env?: Record<string, string>; codingAgent?: boolean };

    expect(enriched.codingAgent).toBe(true);
    expect(enriched.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(enriched.env?.OPENAI_API_KEY).toBeUndefined();
  });

  test("does not merge provider credentials when harness-native login is enabled", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [
        {
          args: [],
          command: "echo",
          enabled: true,
          id: "coding-harness-claude-code",
          kind: "claude_code",
          name: "Claude Code",
        },
      ],
      codingAgentProviderPassthrough: false,
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });
    await db.upsertProfile({
      createdAt: new Date().toISOString(),
      id: "profile_test",
      isDefault: true,
      isSuper: false,
      model: "anthropic:claude-sonnet-4-6",
      name: "Test",
      orgId: "org_test",
      systemPrompt: "test",
      updatedAt: new Date().toISOString(),
    });

    const enriched = (await enrichCodingAgentBashInput(
      db,
      { command: "echo hello" },
      { orgId: "org_test", profileId: "profile_test" },
      {
        defaultProviderId: anthropicProvider.id,
        providers: [anthropicProvider],
      }
    )) as { env?: Record<string, string>; codingAgent?: boolean };

    expect(enriched.codingAgent).toBe(true);
    expect(enriched.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
