import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LocalAuthTokenManagedExternallyError,
  loadLocalAuthToken,
  verifyLocalAuthToken,
} from "@nakama/core/local-auth";
import {
  formatRotateTokenError,
  isRotateTokenCommand,
  runRotateToken,
} from "./rotate-token";

describe("rotate-token command", () => {
  test("isRotateTokenCommand matches the rotate-token subcommand", () => {
    expect(isRotateTokenCommand(["rotate-token"])).toBe(true);
    expect(isRotateTokenCommand(["chat"])).toBe(false);
    expect(isRotateTokenCommand([])).toBe(false);
  });

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
      expect(rotated).toStartWith("tc_local_");
      expect(rotated).not.toBe(original);
      await expect(verifyLocalAuthToken(original!)).resolves.toBeNull();
      await expect(verifyLocalAuthToken(rotated!)).resolves.toEqual({
        email: "local-client@nakama.internal",
      });
      expect(logs.some((line) => line.includes(rotated!))).toBe(true);
    } finally {
      delete process.env.NAKAMA_CONFIG_DIR;
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("formatRotateTokenError surfaces env-managed token errors", () => {
    expect(
      formatRotateTokenError(new LocalAuthTokenManagedExternallyError()),
    ).toContain("NAKAMA_LOCAL_AUTH_TOKEN");
  });
});
