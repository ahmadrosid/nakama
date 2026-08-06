import type { StoredCodingAgentHarnessKind } from "@nakama/db";
import {
  resolveCodingAgentSpawnBundle,
  redactSpawnEnvForPrompt,
} from "./coding-agent-spawn-env";

export interface CodingAgentCommandHarness {
  kind: StoredCodingAgentHarnessKind;
  name: string;
  command: string;
  args: string[];
}

export interface CodingAgentCommandTemplate {
  backend: StoredCodingAgentHarnessKind;
  harnessName: string;
  command: string;
  spawnEnv: Record<string, string>;
  notes: string[];
}

export function buildHarnessNonInteractiveArgs(
  kind: StoredCodingAgentHarnessKind,
  options: { prompt: string; cwd: string; baseArgs?: string[] },
): string[] {
  const baseArgs = [...(options.baseArgs ?? [])];
  const prompt = options.prompt.trim() || "Reply with OK and nothing else.";

  if (kind === "codex") {
    return [
      ...baseArgs,
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--color",
      "never",
      prompt,
    ];
  }

  if (kind === "claude_code") {
    return [
      ...baseArgs,
      "--print",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "text",
      prompt,
    ];
  }

  return [
    ...baseArgs,
    "run",
    "--dir",
    options.cwd,
    "--format",
    "default",
    "--dangerously-skip-permissions",
    prompt,
  ];
}

export async function buildCodingAgentCommandTemplate(
  harness: CodingAgentCommandHarness,
  taskPrompt: string,
  cwd: string,
  options: {
    userConfig?: import("@nakama/core").UserConfig | null;
    profileModel?: string | null;
  } = {},
): Promise<CodingAgentCommandTemplate> {
  const escapedTask = shellEscape(taskPrompt.trim());
  const baseCommand = [harness.command, ...harness.args].join(" ");
  const { spawn } = await resolveCodingAgentSpawnBundle({
    userConfig: options.userConfig,
    profileModel: options.profileModel,
    harnessKind: harness.kind,
  });
  const spawnEnv = spawn.env;
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
      "When Nakama provider passthrough is active, these env vars are merged at spawn time:",
      "",
      "```json",
      JSON.stringify(redactSpawnEnvForPrompt(template.spawnEnv), null, 2),
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
