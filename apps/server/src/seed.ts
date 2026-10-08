import { NakamaApiError } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "./services/auth-service";
import type { OrgService } from "./services/org-service";

const SEED_ADMIN_EMAIL = "NAKAMA_SEED_ADMIN_EMAIL";

const SEED_ADMIN_NAME = "NAKAMA_SEED_ADMIN_NAME";

const SEED_ADMIN_PASSWORD = "NAKAMA_SEED_ADMIN_PASSWORD";

const SEED_ADMIN_PASSWORD_HASH = "NAKAMA_SEED_ADMIN_PASSWORD_HASH";

const SEED_ORG_NAME = "NAKAMA_SEED_ORG_NAME";

const SEED_ENV_KEYS = [
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_NAME,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ORG_NAME,
] as const;

const MIN_PASSWORD_LENGTH = 8;

export type FirstBootSeedDeps = {
  authService: AuthService;
  databaseAdapter: DatabaseAdapter;
  env?: Record<string, string | undefined>;
  orgService: OrgService;
};

export type FirstBootSeedResult = {
  seeded: boolean;
};

export async function runFirstBootSeed(
  deps: FirstBootSeedDeps
): Promise<FirstBootSeedResult> {
  const env = deps.env ?? process.env;

  const present = SEED_ENV_KEYS.filter((key) => {
    const value = env[key]?.trim();

    return Boolean(value);
  });

  if (present.length === 0) {
    return { seeded: false };
  }

  const missing = [SEED_ADMIN_EMAIL, SEED_ADMIN_NAME].filter(
    (key) => !env[key]?.trim()
  );

  const hasPassword = Boolean(env[SEED_ADMIN_PASSWORD]?.trim());
  const hasHash = Boolean(env[SEED_ADMIN_PASSWORD_HASH]?.trim());

  if (missing.length > 0 || hasPassword === hasHash) {
    throw new Error(
      `First-boot seed requires ${SEED_ADMIN_EMAIL}, ${SEED_ADMIN_NAME}, and exactly one of ${SEED_ADMIN_PASSWORD} or ${SEED_ADMIN_PASSWORD_HASH}. Missing: ${missing.join(", ")}.`
    );
  }

  if ((await deps.databaseAdapter.countHumanUsers()) > 0) {
    return { seeded: false };
  }

  const adminEmail = env[SEED_ADMIN_EMAIL]!.trim();
  const adminName = env[SEED_ADMIN_NAME]!.trim();
  const adminPassword = env[SEED_ADMIN_PASSWORD]?.trim();
  const suppliedHash = env[SEED_ADMIN_PASSWORD_HASH]?.trim();
  const orgName = env[SEED_ORG_NAME]?.trim() || "Personal";
  const orgSlug = slugifyOrgName(orgName);

  if (adminPassword && adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `First-boot seed failed: ${SEED_ADMIN_PASSWORD} must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  if (
    suppliedHash &&
    !/^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(suppliedHash)
  ) {
    throw new Error(
      `First-boot seed failed: ${SEED_ADMIN_PASSWORD_HASH} must be a bcrypt hash.`
    );
  }

  try {
    await deps.orgService.bootstrapInitialSetup({
      admin: {
        email: adminEmail,
        name: adminName,
        passwordHash:
          suppliedHash ?? (await deps.authService.hashPassword(adminPassword!)),
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

  // No provider is seeded: OpenCode's free tier rejects the "public" key
  // outside OpenCode. Free-tier admins add a provider after sign-in.
  return { seeded: true };
}

function slugifyOrgName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "personal";
}
