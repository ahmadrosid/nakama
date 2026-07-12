import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  buildCodingAgentLaunchPlan,
  prepareCodingAgentLaunch,
  resolveCodingAgentKindAlias,
  resolveCodingAgentLaunchProfileId,
} from "./coding-agent-launcher";

describe("coding-agent launcher", () => {
  test("resolves harness kind aliases", () => {
    expect(resolveCodingAgentKindAlias("claude")).toBe("claude_code");
    expect(resolveCodingAgentKindAlias("claude-code")).toBe("claude_code");
    expect(resolveCodingAgentKindAlias("codex")).toBe("codex");
    expect(resolveCodingAgentKindAlias("unknown")).toBeNull();
  });

  test("builds interactive launch argv with passthrough args", () => {
    const plan = buildCodingAgentLaunchPlan({
      harness: {
        id: "coding-harness-claude-code",
        kind: "claude_code",
        name: "Claude Code",
        command: "claude",
        args: [],
      },
      cwd: "/tmp/workspace",
      model: "claude-sonnet-4-6",
      spawnEnv: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4310",
      },
      passthroughArgs: ["--print", "fix tests"],
    });

    expect(plan.command).toBe("claude");
    expect(plan.args).toEqual(["--print", "fix tests"]);
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4310");
    expect(plan.cwd).toBe("/tmp/workspace");
  });

  test("resolves super_bot alias to the org super profile", async () => {
    const db = createInMemoryDatabaseAdapter();
    const orgId = "org_test";
    await db.upsertProfile({
      id: "profile_default",
      orgId,
      name: "Default Bot",
      systemPrompt: "",
      model: null,
      isDefault: true,
      isSuper: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.upsertProfile({
      id: "profile_super_xyz",
      orgId,
      name: "Super Bot",
      systemPrompt: "",
      model: "anthropic:claude-sonnet-4-6",
      isDefault: false,
      isSuper: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const resolved = await resolveCodingAgentLaunchProfileId(db, orgId, "super_bot");
    expect(resolved).toBe("profile_super_xyz");
  });

  test("prepares launch plan for an installed harness", async () => {
    const db = createInMemoryDatabaseAdapter();
    const orgId = "org_test";
    await db.upsertProfile({
      id: "profile_test",
      orgId,
      name: "Default",
      systemPrompt: "",
      model: "anthropic:claude-sonnet-4-6",
      isDefault: true,
      isSuper: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
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

    const plan = await prepareCodingAgentLaunch(db, {
      orgId,
      profileId: "profile_test",
      backend: "claude",
      passthroughArgs: ["hello"],
    });

    expect(plan.harnessKind).toBe("claude_code");
    expect(plan.command).toBe("echo");
    expect(plan.args).toEqual(["hello"]);
    expect(plan.model).toBe("claude-sonnet-4-6");
  });
});
