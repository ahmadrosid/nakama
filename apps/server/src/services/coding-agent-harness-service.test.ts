import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  buildCodingHarnessInstallPlan,
  inferCodingAgentHarnessKind,
  isCodingAgentCommand,
  listCodingAgentHarnessStatuses,
  listCodingHarnessLoginCommands,
  refreshCodingAgentHarnessProbe,
} from "./coding-agent-harness-service";

describe("coding-agent harness resolution", () => {
  test("login commands follow default harnesses that support vendor login", () => {
    expect(listCodingHarnessLoginCommands()).toEqual([
      { command: "codex login", name: "Codex" },
      { command: "claude auth login", name: "Claude Code" },
      { command: "opencode auth login", name: "OpenCode" },
      { command: "pi login", name: "pi.dev" },
    ]);
  });

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

  test("marks a harness ready without Nakama provider when passthrough is off", async () => {
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
      codingAgentProviderPassthrough: false,
      id: "workspace-settings",
      imageModel: null,
      selectedCodingAgentHarness: null,
      transcriptionModel: null,
      updatedAt: new Date().toISOString(),
      visionModel: null,
    });

    const statuses = await listCodingAgentHarnessStatuses(db);
    const codex = statuses.find(
      (harness) => harness.id === "coding-harness-codex"
    );
    expect(codex?.installed).toBe(true);
    expect(codex?.ready).toBe(true);
    expect(codex?.statusMessage).toMatch(/codex login/i);
    expect(codex?.statusMessage).not.toMatch(/Settings → Provider/);
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

  test("a harness that ignores SIGTERM still resolves the readiness probe", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nakama-stubborn-harness-"));
    const command = path.join(dir, "stubborn");
    // Answers --version so the harness counts as installed, then refuses to die
    // on the real probe run. Without a bounded probe the promise never settles,
    // because `close` only fires once the child actually exits.
    //
    // The spawned process must be the one ignoring SIGTERM, not a shell whose
    // `sleep` child does: kill() signals the direct child only, so a shell
    // wrapper would leave the sleep running for ten minutes after the test.
    await writeFile(
      command,
      [
        `#!${process.execPath}`,
        'if (process.argv[2] === "--version") { console.log("1.0.0"); process.exit(0); }',
        'process.on("SIGTERM", () => {});',
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    try {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertWorkspaceSettings({
        codingAgentHarnesses: [
          {
            args: [],
            command,
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

      const probed = await refreshCodingAgentHarnessProbe(
        db,
        "coding-harness-claude-code"
      );

      expect(probed.installed).toBe(true);
      expect(probed.ready).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }, 45_000);

  test("a harness that traps SIGTERM is killed once the version probe times out", async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "nakama-sigterm-proof-harness-")
    );
    const command = path.join(dir, "stubborn-version");
    const pidFile = path.join(dir, "pid");
    // Hangs on --version and swallows SIGTERM, so only the SIGKILL escalation
    // ends it. It records its own pid because the probe never exposes the child.
    await writeFile(
      command,
      [
        `#!${process.execPath}`,
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'process.on("SIGTERM", () => {});',
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    try {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertWorkspaceSettings({
        codingAgentHarnesses: [
          {
            args: [],
            command,
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

      const statuses = await listCodingAgentHarnessStatuses(db);
      expect(
        statuses.find((harness) => harness.id === "coding-harness-claude-code")
          ?.installed
      ).toBe(false);

      const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      expect(Number.isInteger(pid)).toBe(true);
      expect(await waitForExit(pid, 15_000)).toBe(true);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }, 45_000);

  test("a harness that hangs on --version resolves as not installed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nakama-hanging-harness-"));
    // exec, so SIGTERM reaches sleep itself rather than orphaning it under sh.
    const command = path.join(dir, "hangs");
    await writeFile(command, "#!/bin/sh\nexec sleep 600\n", { mode: 0o755 });

    try {
      const db = createInMemoryDatabaseAdapter();
      await db.upsertWorkspaceSettings({
        codingAgentHarnesses: [
          {
            args: [],
            command,
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

      const probed = await refreshCodingAgentHarnessProbe(
        db,
        "coding-harness-claude-code"
      );

      expect(probed.installed).toBe(false);
      expect(probed.ready).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }, 20_000);
});

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}
