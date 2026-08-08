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
    expect(
      isCodingAgentCommand("claude --print 'task'", [
        { command: "claude", enabled: false },
      ])
    ).toBe(false);
  });

  test("infers harness kind from argv0", () => {
    const harnesses = [
      { command: "claude", enabled: true, kind: "claude_code" as const },
      { command: "codex", enabled: true, kind: "codex" as const },
      { command: "agent", enabled: true, kind: "cursor_agent" as const },
    ];

    expect(inferCodingAgentHarnessKind("codex exec 'task'", harnesses)).toBe(
      "codex"
    );
    expect(inferCodingAgentHarnessKind("claude -p 'task'", harnesses)).toBe(
      "claude_code"
    );
    expect(
      inferCodingAgentHarnessKind("agent -p 'task' --yolo", harnesses)
    ).toBe("cursor_agent");
    expect(
      inferCodingAgentHarnessKind("npm install -g @openai/codex", harnesses)
    ).toBeNull();
  });

  test("buildCodingHarnessInstallPlan can use bun when npm is unavailable", () => {
    expect(buildCodingHarnessInstallPlan("opencode", "bun")).toEqual({
      args: ["install", "-g", "--trust", "opencode-ai"],
      command: "bun",
      displayCommand: "bun install -g --trust opencode-ai",
    });
  });

  test("refuses auto-install plan for Cursor Agent", () => {
    expect(() => buildCodingHarnessInstallPlan("cursor_agent", "npm")).toThrow(
      /cannot be auto-installed/i
    );
  });

  test("marks Cursor Agent ready when installed without provider passthrough", async () => {
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

    const statuses = await listCodingAgentHarnessStatuses(db);
    const cursor = statuses.find(
      (harness) => harness.id === "coding-harness-cursor-agent"
    );
    expect(cursor?.installed).toBe(true);
    expect(cursor?.ready).toBe(true);
    expect(cursor?.statusMessage).toMatch(/host Cursor auth/i);
  });

  test("refreshCodingAgentHarnessProbe persists cached readiness", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      codingAgentHarnesses: [
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
      selectedCodingAgentHarness: "coding-harness-codex",
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });

    const probed = await refreshCodingAgentHarnessProbe(
      db,
      "coding-harness-codex"
    );
    expect(probed.ready).toBe(true);

    const cached = await listCodingAgentHarnessStatuses(db);
    expect(
      cached.find((harness) => harness.id === "coding-harness-codex")?.ready
    ).toBe(true);
  });
});
