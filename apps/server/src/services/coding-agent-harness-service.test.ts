import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  buildCodingHarnessInstallPlan,
  inferCodingAgentHarnessKind,
  isCodingAgentCommand,
  listCodingAgentHarnessStatuses,
  refreshCodingAgentHarnessProbe,
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

  test("infers harness kind from argv0", () => {
    const harnesses = [
      { kind: "claude_code" as const, command: "claude", enabled: true },
      { kind: "codex" as const, command: "codex", enabled: true },
    ];

    expect(inferCodingAgentHarnessKind("codex exec 'task'", harnesses)).toBe("codex");
    expect(inferCodingAgentHarnessKind("claude -p 'task'", harnesses)).toBe("claude_code");
    expect(inferCodingAgentHarnessKind("npm install -g @openai/codex", harnesses)).toBeNull();
  });

  test("buildCodingHarnessInstallPlan can use bun when npm is unavailable", () => {
    expect(buildCodingHarnessInstallPlan("opencode", "bun")).toEqual({
      command: "bun",
      args: ["install", "-g", "--trust", "opencode-ai"],
      displayCommand: "bun install -g --trust opencode-ai",
    });
  });

  test("refreshCodingAgentHarnessProbe persists cached readiness", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      id: "workspace-settings",
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [
        {
          id: "coding-harness-codex",
          kind: "codex",
          name: "Codex",
          command: "echo",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: "coding-harness-codex",
      updatedAt: new Date().toISOString(),
    });

    const probed = await refreshCodingAgentHarnessProbe(db, "coding-harness-codex");
    expect(probed.ready).toBe(true);

    const cached = await listCodingAgentHarnessStatuses(db);
    expect(cached.find((harness) => harness.id === "coding-harness-codex")?.ready).toBe(true);
  });
});
