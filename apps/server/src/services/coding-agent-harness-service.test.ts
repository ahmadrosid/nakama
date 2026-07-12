import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  buildCodingHarnessInstallPlan,
  isCodingAgentCommand,
  resolveCodingAgentHarness,
} from "./coding-agent-harness-service";

describe("coding-agent harness resolution", () => {
  test("detects harness-shaped bash commands", () => {
    const harnesses = [
      { command: "claude", enabled: true },
      { command: "codex", enabled: true },
    ];

    expect(isCodingAgentCommand("claude --print 'task'", harnesses)).toBe(true);
    expect(isCodingAgentCommand("claude --print 'task'", [{ command: "claude", enabled: false }])).toBe(
      false,
    );
  });

  test("buildCodingHarnessInstallPlan can use bun when npm is unavailable", () => {
    expect(buildCodingHarnessInstallPlan("opencode", "bun")).toEqual({
      command: "bun",
      args: ["install", "-g", "--trust", "opencode-ai"],
      displayCommand: "bun install -g --trust opencode-ai",
    });
  });

  test("auto-selects the only ready harness when none is selected", async () => {
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
          command: "__missing_claude__",
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
        {
          id: "coding-harness-opencode",
          kind: "opencode",
          name: "OpenCode",
          command: "__missing_opencode__",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: null,
      updatedAt: new Date().toISOString(),
    });

    const harness = await resolveCodingAgentHarness(db);

    expect(harness.kind).toBe("codex");
    expect(harness.ready).toBe(true);
  });
});
