import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConnections,
  resolveConnectionValues,
  saveConnection,
} from "./connections-config";

const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
const previousConnectionsKey = process.env.NAKAMA_CONNECTIONS_KEY;

describe("connections config", () => {
  let configDir = "";

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }
    if (previousConnectionsKey === undefined) {
      delete process.env.NAKAMA_CONNECTIONS_KEY;
    } else {
      process.env.NAKAMA_CONNECTIONS_KEY = previousConnectionsKey;
    }
    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("encrypts values and returns only masked metadata", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-connections-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    process.env.NAKAMA_CONNECTIONS_KEY = "test-master-key";

    const saved = await saveConnection("image_provider", "secret-value");
    expect(saved.valueMasked).not.toContain("secret-value");
    expect(await resolveConnectionValues(["image_provider"])).toEqual({
      image_provider: "secret-value",
    });
    expect((await loadConnections())[0]?.value).toBe("secret-value");
  });

  test("rejects missing connections", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-connections-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    process.env.NAKAMA_CONNECTIONS_KEY = "test-master-key";
    await expect(resolveConnectionValues(["missing"])).rejects.toThrow(
      "Missing connections: missing"
    );
  });
});
