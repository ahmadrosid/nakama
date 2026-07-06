import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCliConfigPath,
  loadSavedCliProfileId,
  saveCliProfileId,
} from "./cli-config";

describe("cli-config", () => {
  test("saves and loads profile_id", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-cli-"));
    const previous = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      await saveCliProfileId("super_bot");
      expect(await loadSavedCliProfileId()).toBe("super_bot");

      const raw = await readFile(getCliConfigPath(), "utf8");
      expect(raw).toContain("profile_id=super_bot");
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }
    }
  });
});
