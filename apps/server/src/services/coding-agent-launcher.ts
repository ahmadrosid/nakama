import { spawn } from "node:child_process";
import type { DatabaseAdapter, StoredCodingAgentHarnessKind, StoredProfileRecord } from "@nakama/db";
import { getProfileSoulDir, NakamaApiError, type OrgRole, type ProfileSummary } from "@nakama/core";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { canAccessSuperBotProfile, resolveProfileInput } from "@nakama/core/profiles";
import {
  buildSpawnEnvForHarness,
  getInferenceGatewayBaseUrl,
  mergeCodingAgentSpawnEnv,
  normalizeCodingAgentModel,
} from "./coding-agent-spawn-env";
import {
  getCodingHarnessInstallCommand,
  getCodingHarnessInstallHint,
  resolveCodingAgentHarness,
  saveCodingAgentWorkspaceSettings,
} from "./coding-agent-harness-service";
import { resolveProfileModelId } from "./coding-agent-bash-env";

export const CODING_AGENT_KIND_ALIASES: Record<string, StoredCodingAgentHarnessKind> = {
  claude: "claude_code",
  "claude-code": "claude_code",
  claude_code: "claude_code",
  codex: "codex",
  opencode: "opencode",
};

export interface CodingAgentLaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  harnessId: string;
  harnessKind: StoredCodingAgentHarnessKind;
  harnessName: string;
  model: string | null;
}

export interface PrepareCodingAgentLaunchInput {
  orgId: string;
  profileId: string;
  backend?: string | null;
  model?: string | null;
  cwd?: string | null;
  passthroughArgs?: string[];
  persistSelection?: boolean;
}

export interface CodingAgentLaunchAccess {
  orgRole?: OrgRole | null;
  isPlatformAdmin?: boolean;
  localCli?: boolean;
}

function toProfileSummary(profile: StoredProfileRecord): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    model: profile.model,
    isDefault: profile.isDefault ?? false,
    isSuper: profile.isSuper,
    toolCount: 0,
    mcpServerCount: 0,
    soulActive: false,
    hasAvatar: false,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export async function resolveCodingAgentLaunchProfileId(
  db: DatabaseAdapter,
  orgId: string,
  profileRef: string,
): Promise<string> {
  const trimmed = profileRef.trim();
  const profiles = await db.listProfilesForOrg(orgId);
  const match = resolveProfileInput(profiles.map(toProfileSummary), trimmed);

  if (match) {
    return match.id;
  }

  const direct = await db.getProfileForOrg(trimmed, orgId);

  if (direct) {
    return direct.id;
  }

  throw new Error(`Unknown profile: ${trimmed}`);
}

export function assertCanLaunchCodingAgentProfile(
  profile: StoredProfileRecord,
  access: CodingAgentLaunchAccess = {},
): void {
  if (!profile.isSuper) {
    return;
  }

  if (access.localCli) {
    return;
  }

  if (
    !canAccessSuperBotProfile({
      orgRole: access.orgRole,
      isPlatformAdmin: access.isPlatformAdmin,
    })
  ) {
    throw new NakamaApiError("Super Bot is only available to org admins.", 403);
  }
}

export function resolveCodingAgentKindAlias(
  backend: string | null | undefined,
): StoredCodingAgentHarnessKind | null {
  const normalized = backend?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return CODING_AGENT_KIND_ALIASES[normalized] ?? null;
}

export function buildCodingAgentLaunchPlan(input: {
  harness: {
    id: string;
    kind: StoredCodingAgentHarnessKind;
    name: string;
    command: string;
    args: string[];
  };
  cwd: string;
  model: string | null;
  spawnEnv: Record<string, string>;
  passthroughArgs?: string[];
}): CodingAgentLaunchPlan {
  const baseArgs = [...input.harness.args];
  const passthrough = input.passthroughArgs ?? [];
  const args = [...baseArgs, ...passthrough];

  return {
    command: input.harness.command,
    args,
    env: input.spawnEnv,
    cwd: input.cwd,
    harnessId: input.harness.id,
    harnessKind: input.harness.kind,
    harnessName: input.harness.name,
    model: input.model,
  };
}

export async function prepareCodingAgentLaunch(
  db: DatabaseAdapter,
  input: PrepareCodingAgentLaunchInput,
  access: CodingAgentLaunchAccess = {},
): Promise<CodingAgentLaunchPlan> {
  const orgId = input.orgId.trim();

  if (!input.profileId.trim()) {
    throw new Error("Profile id is required.");
  }

  if (!orgId) {
    throw new Error("Organization context is required.");
  }

  const resolvedProfileId = await resolveCodingAgentLaunchProfileId(
    db,
    orgId,
    input.profileId,
  );
  const profile = await db.getProfileForOrg(resolvedProfileId, orgId);

  if (!profile) {
    throw new Error(`Unknown profile: ${input.profileId.trim()}`);
  }

  assertCanLaunchCodingAgentProfile(profile, access);

  const preferredKind = resolveCodingAgentKindAlias(input.backend);
  const harness = await resolveCodingAgentHarness(db, preferredKind);

  if (!harness.installed) {
    throw new Error(
      [
        `${harness.name} is not installed.`,
        `Install with: ${getCodingHarnessInstallCommand(harness.kind)}`,
        getCodingHarnessInstallHint(harness.kind),
      ].join(" "),
    );
  }

  const profileModel = normalizeCodingAgentModel(
    input.model?.trim() || (await resolveProfileModelId(db, resolvedProfileId)),
  );
  const gatewayBaseUrl = getInferenceGatewayBaseUrl();
  const authToken = gatewayBaseUrl ? await resolveInferenceAuthToken() : null;
  const spawnEnv = buildSpawnEnvForHarness(harness.kind, {
    model: profileModel,
    gatewayBaseUrl,
    authToken,
    orgId,
    profileId: resolvedProfileId,
  });
  const cwd = input.cwd?.trim() || getProfileSoulDir(orgId, resolvedProfileId);

  if (input.persistSelection) {
    await saveCodingAgentWorkspaceSettings(db, {
      selectedHarnessId: harness.id,
    });
  }

  return buildCodingAgentLaunchPlan({
    harness,
    cwd,
    model: profileModel,
    spawnEnv,
    passthroughArgs: input.passthroughArgs,
  });
}

export async function execCodingAgentLaunch(plan: CodingAgentLaunchPlan): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: mergeCodingAgentSpawnEnv(process.env, plan.env),
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function resolveInferenceAuthToken(): Promise<string | null> {
  try {
    return await loadLocalAuthToken();
  } catch {
    return null;
  }
}
