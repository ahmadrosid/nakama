import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { AcpAgentConfig } from "@nakama/core";
import { z } from "zod";

/**
 * Agents Nakama ships with. They are pinned in the runtime manifest, so each
 * one runs from node_modules: no download when a chat starts.
 */
const BUNDLED_AGENTS = [
  {
    id: "claude",
    label: "Claude",
    packageName: "@agentclientprotocol/claude-agent-acp",
  },
  {
    id: "codex",
    label: "Codex",
    packageName: "@agentclientprotocol/codex-acp",
  },
] as const;

/**
 * Agents the host installs itself. Each one is offered only when its CLI is on
 * the server's PATH, and runs with the arguments that start its ACP mode.
 */
const HOST_AGENTS = [
  {
    agent: { args: ["acp"], command: "opencode" },
    id: "opencode",
    label: "OpenCode",
  },
] as const;

export interface AcpAgentPreset {
  agent: AcpAgentConfig;
  id: string;
  label: string;
}

// A package can declare its bin as one path or as a map. Both become a map here.
const packageManifestSchema = z.object({
  bin: z
    .union([
      z.string().transform((entry) => ({ default: entry })),
      z.record(z.string(), z.string()),
    ])
    .optional(),
});

/**
 * The bundled agents, with each one's entry point resolved on this server,
 * then the host agents whose CLI this server can find.
 */
export function listAcpAgentPresets(
  which: (command: string) => string | null = Bun.which
): AcpAgentPreset[] {
  const bundled = BUNDLED_AGENTS.map(({ id, label, packageName }) => ({
    agent: resolveBundledAgent(packageName),
    id,
    label,
  }));

  const host = HOST_AGENTS.flatMap(({ agent, id, label }) =>
    which(agent.command)
      ? [
          {
            agent: { args: [...agent.args], command: agent.command },
            id,
            label,
          },
        ]
      : []
  );

  return [...bundled, ...host];
}

/**
 * Runs the agent's JavaScript entry with the server's own Bun binary. The
 * entry comes from the package's `bin` field.
 */
function resolveBundledAgent(packageName: string): AcpAgentConfig {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve(`${packageName}/package.json`);

  const manifest = packageManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );

  const entry = Object.values(manifest.bin ?? {})[0];

  if (!entry) {
    throw new Error(`${packageName} has no bin entry.`);
  }

  return {
    args: [join(dirname(manifestPath), entry)],
    command: process.execPath,
  };
}
