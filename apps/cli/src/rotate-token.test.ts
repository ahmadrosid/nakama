import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getLocalAuthTokenPath,
  loadLocalAuthToken,
  verifyLocalAuthToken,
} from "@nakama/core/local-auth";
import { runRotateToken } from "./rotate-token";

describe("rotate-token command", () => {
  test("runRotateToken rotates the on-disk token", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "nakama-cli-rotate-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      const original = await loadLocalAuthToken();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        await runRotateToken();
      } finally {
        console.log = originalLog;
      }

      const rotated = await loadLocalAuthToken();
      const tokenPath = getLocalAuthTokenPath();
      expect(rotated).toStartWith("tc_local_");
      expect(rotated).not.toBe(original);
      await expect(verifyLocalAuthToken(original!)).resolves.toBeNull();
      await expect(verifyLocalAuthToken(rotated!)).resolves.toEqual({
        email: "local-client@nakama.internal",
      });
      expect(
        logs.some((line) => line.includes("Local auth token rotated."))
      ).toBe(true);
      expect(
        logs.some((line) => line.includes(`Token file: ${tokenPath}`))
      ).toBe(true);
      expect(logs.some((line) => line.includes(rotated!))).toBe(false);
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { force: true, recursive: true });
    }
  });
});
