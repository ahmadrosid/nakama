import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeEnableComposioToolkitRequest,
  normalizeUpdateProfileComposioToolkitsRequest,
} from "./composio";
import {
  composioOrgUserId,
  composioUserId,
  getComposioConfigPath,
  isComposioConfigured,
  isComposioConfiguredAsync,
  loadComposioConfigFile,
  loadComposioSettingsPublic,
  resolveComposioApiKey,
  saveComposioConfig,
  toComposioSettingsPublic,
} from "./composio-config";

describe("composio-config", () => {
  test("isComposioConfigured is false without config file", () => {
    expect(isComposioConfigured(null)).toBe(false);
    expect(isComposioConfigured({ apiKey: "   " })).toBe(false);
  });

  test("isComposioConfigured is true with config file", () => {
    expect(isComposioConfigured({ apiKey: "ck-test" })).toBe(true);
  });

  test("resolveComposioApiKey reads from file config", () => {
    expect(resolveComposioApiKey({ apiKey: "ck-file" }, {})).toBe("ck-file");
    expect(resolveComposioApiKey(null, {})).toBe("");
  });

  test("resolveComposioApiKey reads a mounted secret file", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-secret-"));
    const secretPath = join(configDir, "api-key");
    await writeFile(secretPath, "  ck-mounted\n");

    expect(
      resolveComposioApiKey(
        { apiKey: "ck-saved" },
        { COMPOSIO_API_KEY_FILE: secretPath }
      )
    ).toBe("ck-mounted");
    expect(
      toComposioSettingsPublic(null, { COMPOSIO_API_KEY_FILE: secretPath })
    ).toEqual({
      apiKeyMasked: "••••••nted",
      configured: true,
    });
  });

  test("direct Composio API key takes priority over its file", () => {
    expect(
      resolveComposioApiKey(
        { apiKey: "ck-saved" },
        {
          COMPOSIO_API_KEY: "ck-direct",
          COMPOSIO_API_KEY_FILE: "/missing/secret",
        }
      )
    ).toBe("ck-direct");
  });

  test("composioOrgUserId namespaces org id", () => {
    expect(composioOrgUserId("org_123")).toBe("nakama:org:org_123");
  });

  test("composioUserId namespaces nakama user id", () => {
    expect(composioUserId("usr_123")).toBe("nakama:user:usr_123");
  });

  test("saveComposioConfig writes config.ini", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-composio-config-"));
    const previous = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const saved = await saveComposioConfig({ apiKey: "ck_test_secret" });
      expect(saved.configured).toBe(true);
      expect(saved.apiKeyMasked).toBeTruthy();

      const loaded = await loadComposioConfigFile();
      expect(loaded?.apiKey).toBe("ck_test_secret");

      const raw = await readFile(getComposioConfigPath(), "utf8");
      expect(raw).toContain("api_key=ck_test_secret");

      expect(await isComposioConfiguredAsync()).toBe(true);
      expect((await loadComposioSettingsPublic()).configured).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }
    }
  });
});

describe("normalizeEnableComposioToolkitRequest", () => {
  test("accepts valid toolkit slug", () => {
    expect(
      normalizeEnableComposioToolkitRequest({ toolkitSlug: "Gmail" })
    ).toEqual({ toolkitSlug: "gmail" });
  });

  test("rejects invalid toolkit slug", () => {
    expect(() =>
      normalizeEnableComposioToolkitRequest({ toolkitSlug: "bad slug" })
    ).toThrow(/toolkitSlug/);
  });
});

describe("normalizeUpdateProfileComposioToolkitsRequest", () => {
  test("accepts toolkit assignment with action allowlist", () => {
    expect(
      normalizeUpdateProfileComposioToolkitsRequest({
        assignments: [
          {
            allowedActions: ["GMAIL_SEND_EMAIL"],
            toolkitId: "ctk_1",
          },
        ],
      })
    ).toEqual({
      assignments: [
        {
          allowedActions: ["GMAIL_SEND_EMAIL"],
          toolkitId: "ctk_1",
        },
      ],
    });
  });

  test("treats empty allowlist as null", () => {
    expect(
      normalizeUpdateProfileComposioToolkitsRequest({
        assignments: [{ allowedActions: [], toolkitId: "ctk_1" }],
      })
    ).toEqual({
      assignments: [{ allowedActions: null, toolkitId: "ctk_1" }],
    });
  });

  test("rejects invalid action slug", () => {
    expect(() =>
      normalizeUpdateProfileComposioToolkitsRequest({
        assignments: [{ allowedActions: ["bad-action"], toolkitId: "ctk_1" }],
      })
    ).toThrow(/allowedActions/);
  });
});
