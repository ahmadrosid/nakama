import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NakamaApiError } from "./api-error";
import {
  getChannelConfigDir,
  migrateChannelBotTokens,
  readBotTokensFromServer,
  removeChannelConnection,
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
function useSecretStore() {
  const store = new Map<string, string>();
  const saves: string[] = [];

  setManagedSecretWriter({
    delete: async (scope, name) => {
      store.delete(`${scope}/${name}`);
    },
    migrate: async (scope, name, value) => {
      if (!store.has(`${scope}/${name}`)) {
        store.set(`${scope}/${name}`, value);
      }
    },
    save: async (scope, name, value) => {
      saves.push(name);
      store.set(`${scope}/${name}`, value);
    },
  });
  setManagedSecretResolver(
    async (scope, name) => store.get(`${scope}/${name}`) ?? null
  );

  return { saves, store };
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
  test("a saved token goes to managed secrets once, not config.ini", async () => {
    await withTempHomedir("nakama-bot-token-save-", async () => {
      const { saves, store } = useSecretStore();

      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      // Same token again, as an allowlist edit does: no re-encrypt.
      await saveTelegramConfig(owner, { allowedUserIds: "7" });
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

      const raw = await readFile(configPath("telegram"), "utf8");
      expect(raw).not.toContain("111:AAA");
      expect(raw).toContain("bot_token_ref=managed");
      expect(await readFile(configPath("discord"), "utf8")).not.toContain(
        "discord-token"
      );
      expect(saves).toEqual(["telegram-bot:agent_a", "discord-bot:agent_a"]);
      expect(store.get("org_a/telegram-bot:agent_a")).toBe("111:AAA");
      expect((await loadTelegramConfigFile(owner))?.botToken).toBe("111:AAA");
    });
  });

  test("a worker pairing a user does not write the token back", async () => {
    await withTempHomedir("nakama-bot-token-pair-", async () => {
      const { store } = useSecretStore();
      const saved = await saveTelegramConfig(owner, { botToken: "111:AAA" });

      // The worker process: no key, so no writer, and the token comes from the server.
      setManagedSecretWriter(null);
      readBotTokensFromServer(
        async (secret) => store.get(`${secret.scope}/${secret.name}`) ?? null
      );

      const result = await verifyAndPairTelegramUser(
        owner,
        saved.handshakeCode!,
        42
      );

      const raw = await readFile(configPath("telegram"), "utf8");
      expect(result.ok).toBe(true);
      expect(raw).toContain("paired_user_ids=42");
      expect(raw).toContain("bot_token_ref=managed");
      expect(raw).not.toContain("bot_token=");
    });
  });

  test("start-up moves a plaintext token out and skips a bad entry", async () => {
    await withTempHomedir("nakama-bot-token-migrate-", async () => {
      await saveTelegramConfig(owner, {
        allowedUserIds: "7",
        botToken: "111:AAA",
      });
      // Not an agent id, so listing owners throws on it.
      await writeFile(
        join(getChannelConfigDir("telegram", owner), "..", "..", ".DS_Store"),
        ""
      );
      expect(await readFile(configPath("telegram"), "utf8")).toContain(
        "bot_token=111:AAA"
      );

      const { store } = useSecretStore();
      const originalWarn = console.warn;
      console.warn = () => undefined;

      try {
        await migrateChannelBotTokens();
      } finally {
        console.warn = originalWarn;
      }

      const raw = await readFile(configPath("telegram"), "utf8");
      expect(raw).not.toContain("bot_token=");
      expect(raw).toContain("allowed_user_ids=7");
      expect(store.get("org_a/telegram-bot:agent_a")).toBe("111:AAA");
      expect((await loadTelegramConfigFile(owner))?.allowedUserIds).toEqual([
        7,
      ]);
    });
  });

  test("disconnecting deletes the stored token", async () => {
    await withTempHomedir("nakama-bot-token-remove-", async () => {
      const { store } = useSecretStore();
      await saveTelegramConfig(owner, { botToken: "111:AAA" });

      await removeChannelConnection("telegram", owner);

      expect(store.size).toBe(0);
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
    fetchToken: () => Promise<string | null>,
    waits: number[]
  ) {
    await writeFile(
      configPath("telegram"),
      "bot_token_ref=managed\nprofile_id=agent_a\n"
    );
    readBotTokensFromServer(fetchToken, async (ms) => {
      waits.push(ms);
    });

    return loadTelegramConfigFile(owner);
  }

  test("waits out a starting or busy server, then reads once", async () => {
    await withTempHomedir("nakama-bot-token-retry-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const waits: number[] = [];
      let calls = 0;

      const fetchToken = async () => {
        calls += 1;

        if (calls === 1) {
          throw new TypeError("fetch failed");
        }

        if (calls === 2) {
          throw new NakamaApiError("Too many requests", 429);
        }

        return "111:AAA";
      };

      expect((await loadWith(fetchToken, waits))?.botToken).toBe("111:AAA");
      expect((await loadTelegramConfigFile(owner))?.botToken).toBe("111:AAA");
      expect(waits).toEqual([500, 1000]);
      expect(calls).toBe(3);
    });
  });

  test("stops at an error that will not heal", async () => {
    await withTempHomedir("nakama-bot-token-refused-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const waits: number[] = [];
      const refusal = new NakamaApiError("Decrypt failed", 500);

      await expect(
        loadWith(async () => {
          throw refusal;
        }, waits)
      ).rejects.toMatchObject({ cause: refusal });
      expect(waits).toEqual([]);
    });
  });

  test("gives up after about a minute", async () => {
    await withTempHomedir("nakama-bot-token-timeout-", async () => {
      await saveTelegramConfig(owner, { botToken: "111:AAA" });
      const waits: number[] = [];

      await expect(
        loadWith(async () => {
          throw new TypeError("fetch failed");
        }, waits)
      ).rejects.toThrow();
      expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(65_500);
    });
  });
});
