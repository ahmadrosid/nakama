import { spawn } from "node:child_process";
import type { NakamaClient } from "@nakama/client";
import type { CodingAgentLaunchPlanResponse } from "@nakama/core";
import { pickProfileForOrg } from "@nakama/core/profiles";
import { ensureServerRunning } from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { createClient } from "@nakama/client";
import { loadSavedCliProfileId } from "./cli-config";
import { resolveStartupProfile } from "./profile";
import { resolveCliOrgId } from "./org";

export interface LaunchCliOptions {
  argv?: string[];
}

export function isLaunchCommand(argv = process.argv.slice(2)): boolean {
  return argv[0] === "launch";
}

export function parseLaunchArgs(argv = process.argv.slice(2)): {
  backend?: string;
  profileId?: string;
  orgId?: string;
  model?: string;
  cwd?: string;
  yes: boolean;
  persistSelection: boolean;
  passthroughArgs: string[];
} {
  const launchArgv = argv[0] === "launch" ? argv.slice(1) : argv;
  let backend: string | undefined;
  let profileId: string | undefined;
  let orgId: string | undefined;
  let model: string | undefined;
  let cwd: string | undefined;
  let yes = false;
  let persistSelection = false;
  const passthroughArgs: string[] = [];
  let parsingPassthrough = false;

  for (let index = 0; index < launchArgv.length; index += 1) {
    const arg = launchArgv[index]!;

    if (parsingPassthrough) {
      passthroughArgs.push(arg);
      continue;
    }

    if (arg === "--") {
      parsingPassthrough = true;
      continue;
    }

    if (arg === "--profile" || arg === "-p") {
      profileId = launchArgv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      profileId = arg.slice("--profile=".length).trim();
      continue;
    }

    if (arg === "--org" || arg === "-o") {
      orgId = launchArgv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--org=")) {
      orgId = arg.slice("--org=".length).trim();
      continue;
    }

    if (arg === "--model" || arg === "-m") {
      model = launchArgv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length).trim();
      continue;
    }

    if (arg === "--cwd") {
      cwd = launchArgv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length).trim();
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }

    if (arg === "--save-harness") {
      persistSelection = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown launch flag: ${arg}`);
    }

    if (!backend) {
      backend = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return {
    backend,
    profileId,
    orgId,
    model,
    cwd,
    yes,
    persistSelection,
    passthroughArgs,
  };
}

export async function runLaunch(options: LaunchCliOptions = {}): Promise<number> {
  const parsed = parseLaunchArgs(options.argv);

  if (!parsed.backend) {
    throw new Error(
      [
        "Usage: nakama launch <backend> [--org ID] [--profile ID] [--model MODEL] [--cwd DIR] [--yes] [--save-harness] [-- ARGS...]",
        "",
        "Backends: claude, codex, opencode",
      ].join("\n"),
    );
  }

  const { serverUrl } = await ensureServerRunning();
  const client = createClient({
    baseUrl: serverUrl,
    authToken: await loadLocalAuthToken("cli@nakama.internal"),
  });

  await resolveCliOrgId(client, { orgId: parsed.orgId });

  let profileId = parsed.profileId?.trim();

  if (!profileId) {
    const profile = await resolveLaunchProfile(client, {
      yes: parsed.yes,
    });
    profileId = profile.id;
  }

  const plan = await client.prepareCodingAgentLaunch({
    profileId,
    backend: parsed.backend,
    model: parsed.model,
    cwd: parsed.cwd ?? process.cwd(),
    passthroughArgs: parsed.passthroughArgs,
    persistSelection: parsed.persistSelection,
  });

  printLaunchSummary(plan);
  return execCodingAgentLaunch(plan);
}

async function resolveLaunchProfile(
  client: NakamaClient,
  options: { yes: boolean },
) {
  const { profiles } = await client.listProfiles();

  if (profiles.length === 0) {
    throw new Error("No bot profiles found.");
  }

  if (options.yes) {
    const savedProfileId = await loadSavedCliProfileId();
    const saved = savedProfileId
      ? profiles.find((profile) => profile.id === savedProfileId)
      : null;

    return saved ?? pickProfileForOrg(profiles);
  }

  const startup = await resolveStartupProfile(client, {});
  return startup.profile;
}

function printLaunchSummary(plan: CodingAgentLaunchPlanResponse): void {
  const commandLine = [plan.command, ...plan.args].join(" ");

  console.log(`Launching ${plan.harnessName} (${plan.harnessKind})`);
  console.log(`Profile model: ${plan.model ?? "default"}`);
  console.log(`Working directory: ${plan.cwd}`);
  console.log(`Command: ${commandLine}`);

  if (Object.keys(plan.env).length > 0) {
    console.log("Spawn env: Nakama inference gateway routing enabled");
    return;
  }

  if (plan.harnessKind === "claude_code") {
    console.log("");
    console.log(
      "No gateway env was applied. Claude Code will ask for /login unless you already have Anthropic credentials.",
    );
    console.log(
      "Enable the Nakama gateway on the server, then restart dev:server:",
    );
    console.log("  export NAKAMA_INFERENCE_GATEWAY_ENABLED=1");
  }

  console.log("");
}

function mergeCodingAgentSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  spawnEnv: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...spawnEnv };

  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const) {
    if (key in spawnEnv && spawnEnv[key] === "") {
      delete env[key];
    }
  }

  return env;
}

export async function execCodingAgentLaunch(plan: CodingAgentLaunchPlanResponse): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: {
        ...process.env,
        ...plan.env,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

export function formatLaunchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "Not found") {
    return [
      message,
      "",
      "If you recently pulled code, restart the server so it registers /v1/coding-agents/prepare-launch:",
      "  bun run dev:server",
    ].join("\n");
  }

  return message;
}
