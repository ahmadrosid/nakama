import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  buildCodingHarnessInstallPlan,
  isCodingAgentCommand,
  listCodingAgentHarnessStatuses,
  refreshCodingAgentHarnessProbe,
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

  test("listCodingAgentHarnessStatuses skips readiness probes by default", async () => {
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
          command: "__missing_codex__",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: null,
      updatedAt: new Date().toISOString(),
    });

    const statuses = await listCodingAgentHarnessStatuses(db);

    expect(statuses).toHaveLength(3);
    expect(statuses.find((harness) => harness.kind === "codex")?.installed).toBe(false);
    expect(statuses.find((harness) => harness.kind === "codex")?.ready).toBe(false);
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
