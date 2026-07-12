import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import type { CodingAgentHarnessStatus } from "./coding-agent-harness-service";

export interface CodingAgentCommandTemplate {
  backend: StoredCodingAgentHarnessKind;
  harnessName: string;
  command: string;
  notes: string[];
}

export function buildCodingAgentCommandTemplate(
  harness: Pick<CodingAgentHarnessStatus, "kind" | "name" | "command" | "args">,
  taskPrompt: string,
  cwd: string,
): CodingAgentCommandTemplate {
  const escapedTask = shellEscape(taskPrompt.trim());
  const baseCommand = [harness.command, ...harness.args].join(" ");

  if (harness.kind === "codex") {
    return {
      backend: harness.kind,
      harnessName: harness.name,
      command: [
        baseCommand,
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "--color",
        "never",
        escapedTask,
      ].join(" "),
      notes: [
        "Codex may require a git repository. If the workspace is not a repo, initialize one in a temp dir or use the sandbox flags from the backend skill.",
        "Prefer capturing the final message from stdout; Codex may also write a last-message file when using --output-last-message.",
      ],
    };
  }

  if (harness.kind === "claude_code") {
    return {
      backend: harness.kind,
      harnessName: harness.name,
      command: [
        baseCommand,
        "--print",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "text",
        escapedTask,
      ].join(" "),
      notes: [
        "Print mode is non-interactive and preferred for one-shot coding agent runs.",
        "Run from the profile workspace cwd unless the user specifies another path inside it.",
      ],
    };
  }

  return {
    backend: harness.kind,
    harnessName: harness.name,
    command: [
      baseCommand,
      "run",
      "--dir",
      shellEscape(cwd),
      "--format",
      "default",
      "--dangerously-skip-permissions",
      escapedTask,
    ].join(" "),
    notes: [
      "OpenCode runs against the workspace directory via --dir.",
      "Use a longer bash timeout for multi-step coding runs.",
    ],
  };
}

export function formatCodingAgentCommandContext(
  template: CodingAgentCommandTemplate,
): string {
  const lines = [
    "# Coding Agent Harness",
    `Selected backend: ${template.harnessName} (${template.backend}).`,
    "Run the coding agent via the `bash` tool using a command shaped like:",
    "",
    "```bash",
    template.command,
    "```",
  ];

  if (template.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of template.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

function getBackendSkillName(
  backend: StoredCodingAgentHarnessKind,
): "coding-backend-codex" | "coding-backend-claude-code" | "coding-backend-opencode" {
  if (backend === "codex") {
    return "coding-backend-codex";
  }

  if (backend === "claude_code") {
    return "coding-backend-claude-code";
  }

  return "coding-backend-opencode";
}

export { getBackendSkillName };

function shellEscape(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
