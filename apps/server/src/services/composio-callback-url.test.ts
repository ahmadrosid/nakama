import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isLoopbackComposioCallbackBaseUrl,
  persistWebPublicUrl,
  resolveComposioCallbackBaseUrl,
  resolveRequestClientOrigin,
} from "./composio-callback-url";

describe("composio-callback-url", () => {
  test("resolveRequestClientOrigin prefers explicit origin", () => {
    const request = new Request(
      "http://app.example.com/v1/composio/toolkits/gmail/connect",
      {
        headers: { Origin: "http://ignored.example.com" },
      }
    );

    expect(
      resolveRequestClientOrigin(request, "https://app.example.com/")
    ).toBe("https://app.example.com");
  });

  test("resolveRequestClientOrigin rejects an origin off the request host", () => {
    const request = new Request(
      "http://api.example.com/v1/composio/toolkits/gmail/connect"
    );

    expect(() =>
      resolveRequestClientOrigin(request, "https://evil.example.com")
    ).toThrow("Origin is not allowed.");
  });

  test("resolveRequestClientOrigin rejects a non-http scheme", () => {
    const request = new Request(
      "http://api.example.com/v1/composio/toolkits/gmail/connect"
    );

    expect(() =>
      resolveRequestClientOrigin(request, "javascript:alert(1)")
    ).toThrow("Origin must be an http or https URL.");
  });

  test("resolveRequestClientOrigin reads Origin header", () => {
    const request = new Request(
      "http://api.example.com/v1/sessions/s1/messages",
      {
        headers: { Origin: "http://localhost:3003" },
      }
    );

    expect(resolveRequestClientOrigin(request)).toBe("http://localhost:3003");
  });

  test("isLoopbackComposioCallbackBaseUrl detects localhost hosts", () => {
    expect(isLoopbackComposioCallbackBaseUrl("http://127.0.0.1:3003")).toBe(
      true
    );
    expect(isLoopbackComposioCallbackBaseUrl("http://localhost:3003")).toBe(
      true
    );
    expect(
      isLoopbackComposioCallbackBaseUrl("https://nakama.example.com")
    ).toBe(false);
  });

  test("resolveComposioCallbackBaseUrl falls back to env when no request", () => {
    const previous = process.env.NAKAMA_WEB_PUBLIC_URL;
    process.env.NAKAMA_WEB_PUBLIC_URL = "https://deployed.example.com/";

    try {
      expect(resolveComposioCallbackBaseUrl()).toBe(
        "https://deployed.example.com"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_WEB_PUBLIC_URL;
      } else {
        process.env.NAKAMA_WEB_PUBLIC_URL = previous;
      }
    }
  });

  test("caller headers off the configured URL are refused", () => {
    const previous = process.env.NAKAMA_WEB_PUBLIC_URL;
    process.env.NAKAMA_WEB_PUBLIC_URL = "https://deployed.example.com";
    const request = new Request(
      "http://127.0.0.1:4310/v1/composio/toolkits/gmail/connect",
      {
        headers: {
          Origin: "https://evil.example.com",
          "X-Forwarded-Host": "evil.example.com",
          "X-Forwarded-Proto": "https",
        },
        method: "POST",
      }
    );

    try {
      expect(() =>
        resolveComposioCallbackBaseUrl({
          clientOrigin: "https://evil.example.com",
          request,
        })
      ).toThrow("Origin is not allowed.");
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_WEB_PUBLIC_URL;
      } else {
        process.env.NAKAMA_WEB_PUBLIC_URL = previous;
      }
    }
  });

  test("an unparseable clientOrigin is refused, not silently dropped", () => {
    const configDir = join(tmpdir(), `nakama-callback-url-unset-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    const previousPublicUrl = process.env.NAKAMA_WEB_PUBLIC_URL;
    process.env.NAKAMA_CONFIG_DIR = configDir;
    delete process.env.NAKAMA_WEB_PUBLIC_URL;
    const request = new Request(
      "http://127.0.0.1:4310/v1/composio/toolkits/gmail/connect",
      { method: "POST" }
    );

    try {
      expect(() =>
        resolveComposioCallbackBaseUrl({
          clientOrigin: "javascript:alert(1)",
          request,
        })
      ).toThrow("Origin must be an http or https URL.");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      if (previousPublicUrl !== undefined) {
        process.env.NAKAMA_WEB_PUBLIC_URL = previousPublicUrl;
      }
      rmSync(configDir, { force: true, recursive: true });
    }
  });

  test("persistWebPublicUrl preserves path segments", async () => {
    const configDir = join(tmpdir(), `nakama-callback-url-test-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = configDir;

    try {
      expect(await persistWebPublicUrl("https://gateway.example.com/v1/")).toBe(
        "https://gateway.example.com/v1"
      );
      expect(resolveComposioCallbackBaseUrl()).toBe(
        "https://gateway.example.com/v1"
      );
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      rmSync(configDir, { force: true, recursive: true });
    }
  });
});
