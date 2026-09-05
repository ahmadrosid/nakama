import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTextOrNull } from "./fs";
import { REDACTED_SECRET_VALUE } from "./secret-mask";
import { getUserConfigPath, parseIniWithSections } from "./user-config";
import {
  isWebSearchConfigComplete,
  loadWebSearchConfig,
  loadWebSearchSettingsPublic,
  saveWebSearchConfig,
  WEB_SEARCH_SECTION,
} from "./web-search-config";

describe("web search config", () => {
  let configDir = "";

  afterEach(async () => {
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
      configDir = "";
    }

    delete process.env.NAKAMA_CONFIG_DIR;
  });

  async function useTempConfigDir(): Promise<void> {
    configDir = await mkdtemp(join(tmpdir(), "nakama-web-search-config-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  }

  test("reports built-in search when nothing is configured", async () => {
    await useTempConfigDir();

    expect(await loadWebSearchConfig()).toBeNull();
    expect(await loadWebSearchSettingsPublic()).toEqual({
      apiKeyMasked: null,
      configured: false,
      endpoint: null,
      provider: null,
    });
  });

  test("fills the vendor endpoint and masks the key", async () => {
    await useTempConfigDir();

    const saved = await saveWebSearchConfig({
      apiKey: "exa-secret-key-1234",
      provider: "exa",
    });

    expect(saved.configured).toBe(true);
    expect(saved.endpoint).toBe("https://api.exa.ai/search");
    expect(saved.apiKeyMasked).not.toContain("secret");
    expect(saved.apiKeyMasked?.endsWith("1234")).toBe(true);

    expect(await loadWebSearchConfig()).toEqual({
      apiKey: "exa-secret-key-1234",
      endpoint: "https://api.exa.ai/search",
      provider: "exa",
    });
  });

  test("keeps the stored key when the masked placeholder is sent back", async () => {
    await useTempConfigDir();
    await saveWebSearchConfig({ apiKey: "exa-secret-key", provider: "exa" });

    await saveWebSearchConfig({
      apiKey: REDACTED_SECRET_VALUE,
      provider: "exa",
    });

    const config = await loadWebSearchConfig();
    expect(config?.apiKey).toBe("exa-secret-key");
  });

  test("does not carry an endpoint or key across providers", async () => {
    await useTempConfigDir();
    await saveWebSearchConfig({ apiKey: "exa-secret-key", provider: "exa" });

    await saveWebSearchConfig({ apiKey: "fc-key", provider: "firecrawl" });

    expect(await loadWebSearchConfig()).toEqual({
      apiKey: "fc-key",
      endpoint: "https://api.firecrawl.dev/v2/search",
      provider: "firecrawl",
    });
  });

  test("rejects a hosted provider without a key and a bad endpoint", async () => {
    await useTempConfigDir();

    await expect(saveWebSearchConfig({ provider: "exa" })).rejects.toThrow(
      "API key"
    );
    await expect(
      saveWebSearchConfig({
        apiKey: "k",
        endpoint: "not-a-url",
        provider: "exa",
      })
    ).rejects.toThrow("http or https");
  });

  test("clearing the provider removes the section and other config survives", async () => {
    await useTempConfigDir();
    await saveWebSearchConfig({ apiKey: "exa-secret-key", provider: "exa" });

    const cleared = await saveWebSearchConfig({ provider: null });

    expect(cleared.configured).toBe(false);
    expect(await loadWebSearchConfig()).toBeNull();

    const raw = (await readTextOrNull(getUserConfigPath())) ?? "";
    expect(
      parseIniWithSections(raw).sections[WEB_SEARCH_SECTION]
    ).toBeUndefined();
    expect(raw).toContain("thinking=");
  });

  test("treats an incomplete config as not configured", () => {
    expect(isWebSearchConfigComplete(null)).toBe(false);
    expect(
      isWebSearchConfigComplete({
        apiKey: "",
        endpoint: "https://api.exa.ai/search",
        provider: "exa",
      })
    ).toBe(false);
  });
});
