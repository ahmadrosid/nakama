import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import type { CodingAgentHarnessStatus } from "./coding-agent-harness-service";
import {
  buildSpawnEnvForHarness,
  type CodingAgentSpawnEnvOptions,
} from "./coding-agent-spawn-env";

export interface CodingAgentCommandTemplate {
  backend: StoredCodingAgentHarnessKind;
  harnessName: string;
  command: string;
  spawnEnv: Record<string, string>;
  notes: string[];
}

export function buildCodingAgentCommandTemplate(
  harness: Pick<CodingAgentHarnessStatus, "kind" | "name" | "command" | "args">,
  taskPrompt: string,
  cwd: string,
  spawnEnvOptions: CodingAgentSpawnEnvOptions = {},
): CodingAgentCommandTemplate {
  const escapedTask = shellEscape(taskPrompt.trim());
  const baseCommand = [harness.command, ...harness.args].join(" ");
  const spawnEnv = buildSpawnEnvForHarness(harness.kind, spawnEnvOptions);
  const shared = {
    backend: harness.kind,
    harnessName: harness.name,
    spawnEnv,
  };

  if (harness.kind === "codex") {
    return {
      ...shared,
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
      ...shared,
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
    ...shared,
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
    "Run the coding agent via the `bash` tool. Set `codingAgent: true` so Nakama merges spawn env for this harness, or rely on auto-detection when the command starts with the harness binary.",
    "",
    "```bash",
    template.command,
    "```",
  ];

  if (Object.keys(template.spawnEnv).length > 0) {
    lines.push(
      "",
      "When the inference gateway is enabled, Nakama injects these env vars at spawn time:",
      "",
      "```json",
      JSON.stringify(template.spawnEnv, null, 2),
      "```",
    );
  }

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
