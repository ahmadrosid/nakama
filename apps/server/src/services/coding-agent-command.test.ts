import { describe, expect, test } from "bun:test";
import {
  buildCodingAgentCommandTemplate,
  formatCodingAgentCommandContext,
} from "./coding-agent-command";
import { makeAnthropicProvider } from "./coding-agent-fixtures";

const anthropicUserConfig = {
  providers: [makeAnthropicProvider()],
  defaultProviderId: "prov_anthropic",
};

describe("buildCodingAgentCommandTemplate", () => {
  test("builds Claude Code print-mode command", async () => {
    const template = await buildCodingAgentCommandTemplate(
      {
        kind: "claude_code",
        name: "Claude Code",
        command: "claude",
        args: [],
      },
      "Add tests for auth",
      "/tmp/workspace",
    );

    expect(template.command).toContain("claude");
    expect(template.command).toContain("--print");
    expect(template.command).toContain("--permission-mode");
    expect(template.command).toContain("bypassPermissions");
    expect(template.command).toContain("'Add tests for auth'");
  });

  test("builds Codex exec command", async () => {
    const template = await buildCodingAgentCommandTemplate(
      {
        kind: "codex",
        name: "Codex",
        command: "codex",
        args: [],
      },
      "Refactor auth module",
      "/tmp/workspace",
    );

    expect(template.command).toContain("codex exec");
    expect(template.command).toContain("--skip-git-repo-check");
    expect(template.command).toContain("'Refactor auth module'");
  });

  test("builds pi.dev command and spawn env", async () => {
    const template = await buildCodingAgentCommandTemplate(
      {
        kind: "pi",
        name: "pi.dev",
        command: "pi",
        args: [],
      },
      "Fix bugs",
      "/workspace",
      {
        userConfig: anthropicUserConfig,
        profileModel: "claude-sonnet-4-6",
      },
    );
    expect(template.backend).toBe("pi");
    expect(template.command).toContain("pi");
    expect(template.command).toContain("--provider");
    expect(template.command).toContain("anthropic");
    expect(template.command).toContain("--model");
    expect(template.command).toContain("-p");
  });

  test("builds OpenCode run command with workspace dir", async () => {
    const template = await buildCodingAgentCommandTemplate(
      {
        kind: "opencode",
        name: "OpenCode",
        command: "opencode",
        args: [],
      },
      "Fix lint errors",
      "/tmp/workspace",
    );

    expect(template.command).toContain("opencode run");
    expect(template.command).toContain("--dir");
    expect(template.command).toContain("'/tmp/workspace'");
    expect(template.command).toContain("--dangerously-skip-permissions");
    expect(template.command).toContain("'Fix lint errors'");
  });

  test("builds Cursor Agent print command with text output and yolo", async () => {
    const template = await buildCodingAgentCommandTemplate(
      {
        kind: "cursor_agent",
        name: "Cursor Agent",
        command: "agent",
        args: [],
      },
      "Where are the built-in skills",
      "/tmp/workspace",
      {
        userConfig: anthropicUserConfig,
        profileModel: "claude-sonnet-4-6",
      },
    );

    expect(template.backend).toBe("cursor_agent");
    expect(template.command).toContain("agent");
    expect(template.command).toContain("-p");
    expect(template.command).toContain("--output-format");
    expect(template.command).toContain("text");
    expect(template.command).not.toContain("stream-json");
    expect(template.command).toContain("--yolo");
    expect(template.command).toContain("'Where are the built-in skills'");
    expect(template.spawnEnv).toEqual({});
  });

  test("reflects custom harness command from workspace settings", async () => {
    const template = await buildCodingAgentCommandTemplate(
      {
        kind: "claude_code",
        name: "Custom Claude",
        command: "/opt/bin/claude",
        args: ["--model", "sonnet"],
      },
      "Touch README",
      "/tmp/workspace",
    );

    expect(template.command.startsWith("/opt/bin/claude --model sonnet")).toBe(true);
  });
});

describe("formatCodingAgentCommandContext", () => {
  test("formats harness context for bash delegation", async () => {
    const context = formatCodingAgentCommandContext(
      await buildCodingAgentCommandTemplate(
        {
          kind: "opencode",
          name: "OpenCode",
          command: "opencode",
          args: [],
        },
        "Ship feature",
        "/tmp/workspace",
      ),
    );

    expect(context).toContain("bash");
    expect(context).toContain("opencode run");
  });

  test("redacts API keys from prompt context", async () => {
    const context = formatCodingAgentCommandContext(
      await buildCodingAgentCommandTemplate(
        {
          kind: "claude_code",
          name: "Claude Code",
          command: "claude",
          args: [],
        },
        "Ship feature",
        "/tmp/workspace",
        {
          userConfig: anthropicUserConfig,
          profileModel: "claude-sonnet-4-6",
        },
      ),
    );

    expect(context).toContain("Nakama provider passthrough");
    expect(context).not.toContain("sk-ant-test");
    expect(context).toContain('"***"');
  });

  test("does not claim provider passthrough for Cursor Agent", async () => {
    const context = formatCodingAgentCommandContext(
      await buildCodingAgentCommandTemplate(
        {
          kind: "cursor_agent",
          name: "Cursor Agent",
          command: "agent",
          args: [],
        },
        "Ship feature",
        "/tmp/workspace",
        {
          userConfig: anthropicUserConfig,
          profileModel: "claude-sonnet-4-6",
        },
      ),
    );

    expect(context).toContain("host auth");
    expect(context).toContain("cwd");
    expect(context).not.toContain("When Nakama provider passthrough is active");
    expect(context).toContain("--yolo");
    expect(context).toContain("--output-format text");
  });
});
