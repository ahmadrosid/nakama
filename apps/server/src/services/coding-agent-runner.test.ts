import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKSPACE_SETTINGS_ID, createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { runCodingAgentTask } from "./coding-agent-runner";

describe("runCodingAgentTask", () => {
  const originalPath = process.env.PATH ?? "";
  let tempBinDir = "";
  let workspaceRoot = "";

  beforeEach(async () => {
    tempBinDir = await mkdtemp(path.join(tmpdir(), "tinyclaw-coding-agent-bin-"));
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "tinyclaw-coding-agent-workspace-"));
    process.env.PATH = tempBinDir;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    if (tempBinDir) {
      await rm(tempBinDir, { recursive: true, force: true });
    }
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("runs delegated task with an installed selected harness", async () => {
    const db = createInMemoryDatabaseAdapter();

    await installFakeClaude(tempBinDir);
    await db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
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

    const result = await runCodingAgentTask(
      db,
      { task: "Create a concise summary file for this repo." },
      {
        orgId: "org_test",
        profileId: "profile_test",
        workspaceRoot,
      },
    );

    expect(result.success).toBe(true);
    expect(result.backend).toBe("claude_code");
    expect(result.stdout).toContain("Create a concise summary file for this repo.");
    expect(result.stdout).toContain("When delegating:");
    expect(result.stdout).toContain("delegated run for Claude Code");
    expect(result.stdout).not.toContain("delegated run for OpenCode");
  });

  test("fails when no supported harness is installed", async () => {
    const db = createInMemoryDatabaseAdapter();

    await expect(
      runCodingAgentTask(
        db,
        { task: "Touch README.md" },
        {
          orgId: "org_test",
          profileId: "profile_test",
          workspaceRoot,
        },
      ),
    ).rejects.toThrow("No supported coding agent is installed");
  });
});

async function installFakeClaude(binDir: string): Promise<void> {
  const scriptPath = path.join(binDir, "claude");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"fake claude\"",
      "  exit 0",
      "fi",
      "printf '%s' \"$*\"",
    ].join("\n"),
  );
  await chmod(scriptPath, 0o755);
}
