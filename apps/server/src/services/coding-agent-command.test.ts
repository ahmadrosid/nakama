import { describe, expect, test } from "bun:test";
import {
  buildCodingAgentCommandTemplate,
  formatCodingAgentCommandContext,
} from "./coding-agent-command";

describe("buildCodingAgentCommandTemplate", () => {
  test("builds Claude Code print-mode command", () => {
    const template = buildCodingAgentCommandTemplate(
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

  test("builds Codex exec command", () => {
    const template = buildCodingAgentCommandTemplate(
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

  test("builds OpenCode run command with workspace dir", () => {
    const template = buildCodingAgentCommandTemplate(
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

  test("reflects custom harness command from workspace settings", () => {
    const template = buildCodingAgentCommandTemplate(
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
  test("formats harness context for bash delegation", () => {
    const context = formatCodingAgentCommandContext(
      buildCodingAgentCommandTemplate(
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
});
