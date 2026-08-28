import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProviderInstanceId,
  isProviderConfigured,
  loadUserConfig,
  saveUserConfig,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createMinimalHonoApp } from "./http/test-app-helpers";
import { createProviderFromActiveConfig } from "./providers";
import { runFirstBootSeed } from "./seed";
import { AuthService } from "./services/auth-service";
import { OrgService } from "./services/org-service";

const SEED_ENV_KEYS = [
  "NAKAMA_SEED_ADMIN_EMAIL",
  "NAKAMA_SEED_ADMIN_NAME",
  "NAKAMA_SEED_ADMIN_PASSWORD",
  "NAKAMA_SEED_ORG_NAME",
  "NAKAMA_CONFIG_DIR",
] as const;

describe("runFirstBootSeed", () => {
  let configDir = "";
  const previousEnv: Partial<
    Record<(typeof SEED_ENV_KEYS)[number], string | undefined>
  > = {};

  afterEach(async () => {
    for (const key of SEED_ENV_KEYS) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }
  });

  function snapshotEnv(): void {
    for (const key of SEED_ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  async function withFreshConfigDir(): Promise<void> {
    snapshotEnv();
    configDir = await mkdtemp(join(tmpdir(), "nakama-seed-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  }

  function createServices() {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const authService = new AuthService();
    const orgService = new OrgService(databaseAdapter, authService);
    return { authService, databaseAdapter, orgService };
  }

  test("no seed env is a no-op", async () => {
    await withFreshConfigDir();
    const services = createServices();

    const result = await runFirstBootSeed(services);

    expect(result).toEqual({ providerWritten: false, seeded: false });
    expect(await services.databaseAdapter.countHumanUsers()).toBe(0);
    expect(await loadUserConfig()).toBeNull();
  });

  test("partial seed env fails with missing var names", async () => {
    await withFreshConfigDir();
    const services = createServices();

    await expect(
      runFirstBootSeed({
        ...services,
        env: {
          NAKAMA_SEED_ADMIN_EMAIL: "admin@example.com",
          NAKAMA_SEED_ADMIN_NAME: "",
          NAKAMA_SEED_ADMIN_PASSWORD: "seedpass123",
        },
      })
    ).rejects.toThrow(/NAKAMA_SEED_ADMIN_NAME/);

    expect(await services.databaseAdapter.countHumanUsers()).toBe(0);
  });

  test("already-configured database skips silently", async () => {
    await withFreshConfigDir();
    const services = createServices();
    await services.orgService.bootstrapInitialSetup({
      admin: {
        email: "existing@example.com",
        name: "Existing",
        passwordHash: await services.authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Existing", slug: "existing" },
    });

    const result = await runFirstBootSeed({
      ...services,
      env: {
        NAKAMA_SEED_ADMIN_EMAIL: "admin@example.com",
        NAKAMA_SEED_ADMIN_NAME: "Admin",
        NAKAMA_SEED_ADMIN_PASSWORD: "seedpass123",
      },
    });

    expect(result).toEqual({ providerWritten: false, seeded: false });
    expect(await services.databaseAdapter.countHumanUsers()).toBe(1);
    expect(await loadUserConfig()).toBeNull();
  });

  test("writes OpenCode Zen provider with exact shape and merges existing config", async () => {
    await withFreshConfigDir();
    const services = createServices();
    const existingId = createProviderInstanceId();
    await saveUserConfig({
      defaultProviderId: existingId,
      providers: [
        {
          apiKey: "sk-existing",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: existingId,
          label: "OpenAI",
          type: "openai",
        },
      ],
      thinkingEnabled: false,
      timezone: "America/New_York",
    });

    const result = await runFirstBootSeed({
      ...services,
      env: {
        NAKAMA_SEED_ADMIN_EMAIL: "admin@example.com",
        NAKAMA_SEED_ADMIN_NAME: "Admin",
        NAKAMA_SEED_ADMIN_PASSWORD: "seedpass123",
      },
    });

    expect(result).toEqual({ providerWritten: true, seeded: true });
    expect(await services.databaseAdapter.countHumanUsers()).toBe(1);

    const loaded = await loadUserConfig();
    expect(loaded?.timezone).toBe("America/New_York");
    expect(loaded?.thinkingEnabled).toBe(false);
    expect(loaded?.providers).toHaveLength(2);
    expect(loaded?.providers[0]?.id).toBe(existingId);
    expect(loaded?.providers[0]?.label).toBe("OpenAI");
    expect(loaded?.providers[0]?.apiKey).toBe("sk-existing");

    const zen = loaded?.providers.find(
      (provider) => provider.label === "OpenCode Zen"
    );
    expect(zen).toMatchObject({
      apiKey: "public",
      baseUrl: "https://opencode.ai/zen/v1",
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
      label: "OpenCode Zen",
      type: "openai_compatible",
    });
    expect(zen?.customModels?.[0]).not.toHaveProperty("default");
    expect(loaded?.defaultProviderId).toBe(zen?.id);
    expect(isProviderConfigured(loaded)).toBe(true);
  });

  test("boot-level health reports userConfigured and providerConfigured after seed", async () => {
    await withFreshConfigDir();
    const services = createServices();

    const result = await runFirstBootSeed({
      ...services,
      env: {
        NAKAMA_SEED_ADMIN_EMAIL: "admin@example.com",
        NAKAMA_SEED_ADMIN_NAME: "Admin",
        NAKAMA_SEED_ADMIN_PASSWORD: "seedpass123",
      },
    });
    expect(result.seeded).toBe(true);

    const org =
      await services.databaseAdapter.getOrganizationBySlug("personal");
    expect(org?.name).toBe("Personal");

    const userConfig = await loadUserConfig();
    const provider = createProviderFromActiveConfig(userConfig, process.env);
    const { app } = createMinimalHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
        providerConfigured:
          isProviderConfigured(userConfig) && provider !== null,
      },
      authService: services.authService,
      databaseAdapter: services.databaseAdapter,
      orgService: services.orgService,
    });

    const response = await app.fetch(
      new Request("http://localhost:4310/health")
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      providerConfigured: true,
      userConfigured: true,
    });
  });
});
