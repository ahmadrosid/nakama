import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getChannelConfigDir,
  migrateChannelBotTokens,
  readBotTokensFromServer,
} from "./channel-config-shared";
import { asTestFetch } from "./channel-test-helpers";
import {
  readEnvValue,
  setManagedSecretResolver,
  setManagedSecretWriter,
} from "./config";
import { saveDiscordConfig } from "./discord-config";
import {
  loadTelegramConfigFile,
  saveTelegramConfig,
  verifyAndPairTelegramUser,
} from "./telegram-config";
import { withTempHomedir } from "./testing/channel-config-fixtures";

const owner = { orgId: "org_a", profileId: "agent_a" };

// Stands in for ManagedSecrets: the server sets both hooks when it has a key.
function useSecretStore(): Map<string, string> {
  const store = new Map<string, string>();
  setManagedSecretWriter(async (scope, name, value) => {
    store.set(`${scope}/${name}`, value);
  });
  setManagedSecretResolver(
    async (scope, name) => store.get(`${scope}/${name}`) ?? null
  );

  return store;
}

function configPath(platform: "telegram" | "discord"): string {
  return join(getChannelConfigDir(platform, owner), "config.ini");
}

afterEach(() => {
  setManagedSecretWriter(null);
  // The default resolver: environment variables only.
  setManagedSecretResolver(
    async (_scope, _name, envNames) =>
      envNames.map((name) => readEnvValue(process.env, name)).find(Boolean) ??
      null
  );
  readBotTokensFromServer(null);
});

describe("bot tokens with NAKAMA_SECRETS_KEY", () => {
  test("a saved token goes to managed secrets, not config.ini", async () => {
    await withTempHomedir("nakama-bot-token-save-", async () => {
      const store = useSecretStore();

      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const originalFetch = globalThis.fetch;
      // Saving a Discord token looks up its application id first.
      globalThis.fetch = asTestFetch(async () =>
        Response.json({ id: "1525937133096013954" })
      );

      try {
        await saveDiscordConfig({ botToken: "discord-token" }, owner);
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(await readFile(configPath("telegram"), "utf8")).not.toContain(
        "111:AAA"
      );
      expect(await readFile(configPath("discord"), "utf8")).not.toContain(
        "discord-token"
      );
      expect([...store.entries()]).toEqual([
        ["org_a/telegram-bot:agent_a", "111:AAA"],
        ["org_a/discord-bot:agent_a", "discord-token"],
      ]);
      expect((await loadTelegramConfigFile(owner))?.botToken).toBe("111:AAA");
    });
  });

  test("a worker pairing a user does not write the token back", async () => {
    await withTempHomedir("nakama-bot-token-pair-", async () => {
      const store = useSecretStore();
      const saved = await saveTelegramConfig(owner, { botToken: "111:AAA" });

      // The worker process: no key, so no writer, and the token comes from the server.
      setManagedSecretWriter(null);
      readBotTokensFromServer({
        baseUrl: "http://nakama.test",
        fetch: asTestFetch(async () =>
          Response.json({ token: store.get("org_a/telegram-bot:agent_a") })
        ),
      });

      const result = await verifyAndPairTelegramUser(
        owner,
        saved.handshakeCode!,
        42
      );

      const raw = await readFile(configPath("telegram"), "utf8");
      expect(result.ok).toBe(true);
      expect(raw).toContain("paired_user_ids=42");
      expect(raw).not.toContain("bot_token");
    });
  });

  test("start-up moves an existing plaintext token out of config.ini", async () => {
    await withTempHomedir("nakama-bot-token-migrate-", async () => {
      await saveTelegramConfig(owner, {
        allowedUserIds: "7",
        botToken: "111:AAA",
      });
      expect(await readFile(configPath("telegram"), "utf8")).toContain(
        "bot_token=111:AAA"
      );

      const store = useSecretStore();
      await migrateChannelBotTokens();

      const raw = await readFile(configPath("telegram"), "utf8");
      expect(raw).not.toContain("bot_token");
      expect(raw).toContain("allowed_user_ids=7");
      expect(store.get("org_a/telegram-bot:agent_a")).toBe("111:AAA");
      expect((await loadTelegramConfigFile(owner))?.allowedUserIds).toEqual([
        7,
      ]);
    });
  });

  test("without a key the token stays in config.ini as before", async () => {
    await withTempHomedir("nakama-bot-token-plain-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      await migrateChannelBotTokens();

      expect(await readFile(configPath("telegram"), "utf8")).toContain(
        "bot_token=111:AAA"
      );
      expect((await loadTelegramConfigFile(owner))?.botToken).toBe("111:AAA");
    });
  });
});

describe("readBotTokensFromServer", () => {
  async function loadWith(
    fetchImpl: Parameters<typeof asTestFetch>[0],
    waits: number[]
  ) {
    await writeFile(configPath("telegram"), "profile_id=agent_a\n");
    readBotTokensFromServer({
      authToken: "local-token",
      baseUrl: "http://nakama.test",
      fetch: asTestFetch(fetchImpl),
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    return loadTelegramConfigFile(owner);
  }

  test("waits with backoff until the server answers", async () => {
    await withTempHomedir("nakama-bot-token-retry-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const waits: number[] = [];
      const requests: Request[] = [];
      let calls = 0;

      const config = await loadWith(async (url, init) => {
        requests.push(new Request(url, init));
        calls += 1;

        if (calls < 3) {
          throw new Error("connect ECONNREFUSED");
        }

        return Response.json({ token: "111:AAA" });
      }, waits);

      expect(config?.botToken).toBe("111:AAA");
      expect(waits).toEqual([500, 1000]);
      expect(new URL(requests[0]!.url).searchParams.get("name")).toBe(
        "telegram-bot:agent_a"
      );
      expect(requests[0]!.headers.get("Authorization")).toBe(
        "Bearer local-token"
      );
    });
  });

  test("stops at a refusal instead of retrying", async () => {
    await withTempHomedir("nakama-bot-token-refused-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const waits: number[] = [];

      await expect(
        loadWith(async () => Response.json({}, { status: 401 }), waits)
      ).rejects.toThrow();
      expect(waits).toEqual([]);
    });
  });

  test("gives up after about a minute", async () => {
    await withTempHomedir("nakama-bot-token-timeout-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const waits: number[] = [];

      await expect(
        loadWith(async () => {
          throw new Error("connect ECONNREFUSED");
        }, waits)
      ).rejects.toThrow();
      expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(65_500);
    });
  });
});
