import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  persistWebPublicUrl,
  isLoopbackComposioCallbackBaseUrl,
  resolveComposioCallbackBaseUrl,
  resolveRequestClientOrigin,
} from "./composio-callback-url";

describe("composio-callback-url", () => {
  test("resolveRequestClientOrigin prefers explicit origin", () => {
    const request = new Request("http://api.example.com/v1/composio/toolkits/gmail/connect", {
      headers: { Origin: "http://ignored.example.com" },
    });

    expect(resolveRequestClientOrigin(request, "https://app.example.com/")).toBe(
      "https://app.example.com",
    );
  });

  test("resolveRequestClientOrigin reads Origin header", () => {
    const request = new Request("http://api.example.com/v1/sessions/s1/messages", {
      headers: { Origin: "http://localhost:3003" },
    });

    expect(resolveRequestClientOrigin(request)).toBe("http://localhost:3003");
  });

  test("isLoopbackComposioCallbackBaseUrl detects localhost hosts", () => {
    expect(isLoopbackComposioCallbackBaseUrl("http://127.0.0.1:3003")).toBe(true);
    expect(isLoopbackComposioCallbackBaseUrl("http://localhost:3003")).toBe(true);
    expect(isLoopbackComposioCallbackBaseUrl("https://nakama.example.com")).toBe(false);
  });

  test("resolveComposioCallbackBaseUrl falls back to env when no request", () => {
    const previous = process.env.NAKAMA_WEB_PUBLIC_URL;
    process.env.NAKAMA_WEB_PUBLIC_URL = "https://deployed.example.com/";

    try {
      expect(resolveComposioCallbackBaseUrl()).toBe("https://deployed.example.com");
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_WEB_PUBLIC_URL;
      } else {
        process.env.NAKAMA_WEB_PUBLIC_URL = previous;
      }
    }
  });

  test("persistWebPublicUrl stores origin only", async () => {
    const configDir = join(tmpdir(), `nakama-callback-url-test-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      expect(await persistWebPublicUrl("https://app.example.com/setup")).toBe(
        "https://app.example.com",
      );
      expect(resolveComposioCallbackBaseUrl()).toBe("https://app.example.com");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
