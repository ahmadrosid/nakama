import {
  createProviderInstanceId,
  loadUserConfig,
  NakamaApiError,
  type ProviderInstance,
  saveUserConfig,
  type UserConfig,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "./services/auth-service";
import type { OrgService } from "./services/org-service";

const SEED_ADMIN_EMAIL = "NAKAMA_SEED_ADMIN_EMAIL";
const SEED_ADMIN_NAME = "NAKAMA_SEED_ADMIN_NAME";
const SEED_ADMIN_PASSWORD = "NAKAMA_SEED_ADMIN_PASSWORD";
const SEED_ORG_NAME = "NAKAMA_SEED_ORG_NAME";

const REQUIRED_SEED_ENV_KEYS = [
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_NAME,
  SEED_ADMIN_PASSWORD,
] as const;

const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_ZEN_LABEL = "OpenCode Zen";
const MIN_PASSWORD_LENGTH = 8;

export type FirstBootSeedDeps = {
  authService: AuthService;
  databaseAdapter: DatabaseAdapter;
  env?: Record<string, string | undefined>;
  orgService: OrgService;
};

export type FirstBootSeedResult = {
  providerWritten: boolean;
  seeded: boolean;
};

export async function runFirstBootSeed(
  deps: FirstBootSeedDeps
): Promise<FirstBootSeedResult> {
  const env = deps.env ?? process.env;
  const present = REQUIRED_SEED_ENV_KEYS.filter((key) => {
    const value = env[key]?.trim();
    return Boolean(value);
  });

  if (present.length === 0) {
    return { providerWritten: false, seeded: false };
  }

  if (present.length < REQUIRED_SEED_ENV_KEYS.length) {
    const missing = REQUIRED_SEED_ENV_KEYS.filter((key) => !env[key]?.trim());
    throw new Error(
      `First-boot seed is partially configured. Missing: ${missing.join(", ")}. Set all of ${REQUIRED_SEED_ENV_KEYS.join(", ")} or none.`
    );
  }

  if ((await deps.databaseAdapter.countHumanUsers()) > 0) {
    return { providerWritten: false, seeded: false };
  }

  const adminEmail = env[SEED_ADMIN_EMAIL]!.trim();
  const adminName = env[SEED_ADMIN_NAME]!.trim();
  const adminPassword = env[SEED_ADMIN_PASSWORD]!.trim();
  const orgName = env[SEED_ORG_NAME]?.trim() || "Personal";
  const orgSlug = slugifyOrgName(orgName);

  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `First-boot seed failed: ${SEED_ADMIN_PASSWORD} must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  try {
    await deps.orgService.bootstrapInitialSetup({
      admin: {
        email: adminEmail,
        name: adminName,
        passwordHash: await deps.authService.hashPassword(adminPassword),
        phone: "",
      },
      organization: {
        name: orgName,
        slug: orgSlug,
      },
    });
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw new Error(`First-boot seed failed: ${error.message}`);
    }
    throw error;
  }

  await writeOpenCodeZenProvider();

  return { providerWritten: true, seeded: true };
}

function slugifyOrgName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "personal";
}

async function writeOpenCodeZenProvider(): Promise<void> {
  const existing = await loadUserConfig();
  const instance: ProviderInstance = {
    apiKey: "public",
    baseUrl: OPENCODE_ZEN_BASE_URL,
    createdAt: new Date().toISOString(),
    customModels: [
      {
        id: "big-pickle",
        name: "Big Pickle",
        supportsThinking: true,
      },
      {
        id: "hy3-free",
        name: "Hy3 Free",
        supportsThinking: true,
      },
    ],
    id: createProviderInstanceId(),
    label: OPENCODE_ZEN_LABEL,
    type: "openai_compatible",
  };

  const next: UserConfig = {
    ...(existing ?? { defaultProviderId: null, providers: [] }),
    defaultProviderId: instance.id,
    providers: [...(existing?.providers ?? []), instance],
  };

  await saveUserConfig(next);
}
