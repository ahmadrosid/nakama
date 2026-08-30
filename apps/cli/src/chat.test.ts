import { describe, expect, test } from "bun:test";
import type {
  HealthResponse,
  ModelsResponse,
  ProfileSummary,
} from "@nakama/core";
import {
  createChatExitController,
  disableRawModeIfActive,
  formatErrorLines,
  formatStatusLines,
  isEscInterruptKey,
  needsTrailingStreamNewline,
} from "./chat";

describe("needsTrailingStreamNewline", () => {
  test("adds a newline when no chunk was rendered", () => {
    expect(needsTrailingStreamNewline(null)).toBe(true);
  });

  test("adds a newline when the stream ended mid-line", () => {
    expect(needsTrailingStreamNewline("Hello.")).toBe(true);
  });

  test("skips the newline when the stream already ended with one", () => {
    expect(needsTrailingStreamNewline("Hello.\n")).toBe(false);
    expect(needsTrailingStreamNewline("Hello.\r\n")).toBe(false);
  });
});

describe("createChatExitController", () => {
  test("requestExit resolves wait without scheduling an interval", async () => {
    const originalSetInterval = globalThis.setInterval;
    let intervalCalls = 0;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      intervalCalls += 1;
      return originalSetInterval(...args);
    }) as typeof setInterval;

    try {
      const exit = createChatExitController();
      const waited = exit.wait();
      expect(exit.exiting).toBe(false);
      exit.requestExit();
      await waited;
      expect(exit.exiting).toBe(true);
      expect(intervalCalls).toBe(0);
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });

  test("AbortSignal resolves wait immediately", async () => {
    const controller = new AbortController();
    const exit = createChatExitController(controller.signal);
    const waited = exit.wait();
    controller.abort();
    await waited;
    expect(exit.exiting).toBe(true);
  });

  test("already-aborted signal resolves wait without waiting", async () => {
    const controller = new AbortController();
    controller.abort();
    const exit = createChatExitController(controller.signal);
    await exit.wait();
    expect(exit.exiting).toBe(true);
  });
});

describe("formatStatusLines", () => {
  const health: HealthResponse = {
    apiVersion: 1,
    composioAvailable: false,
    composioConfigured: false,
    ok: true,
    providerConfigured: true,
    userConfigured: true,
  };
  const models: ModelsResponse = {
    currentProviderId: "provider-a",
    displayName: null,
    models: [],
    provider: "anthropic",
    providers: [],
  };
  const profile: ProfileSummary = {
    createdAt: "",
    hasAvatar: false,
    id: "default",
    isSuper: false,
    mcpServerCount: 0,
    model: "provider-a::claude-sonnet",
    name: "Default",
    soulActive: false,
    toolCount: 0,
    updatedAt: "",
  };

  test("matches the telegram status summary fields", () => {
    expect(formatStatusLines(health, models, profile)).toEqual([
      "Server: ok",
      "Provider configured: yes",
      "Profile: Default",
      "Provider: anthropic",
      "Model: claude-sonnet",
    ]);
  });

  test("shows offline mode when no provider is configured", () => {
    expect(
      formatStatusLines({ ...health, providerConfigured: false }, null, profile)
    ).toEqual([
      "Server: ok",
      "Provider configured: no",
      "Chat runs in offline mode without an API key.",
    ]);
  });
});

describe("formatErrorLines", () => {
  test("adds a blank line above rendered errors", () => {
    expect(formatErrorLines(new Error("Boom"))).toEqual(["", "Boom"]);
  });

  test("splits multiline errors into separate render lines", () => {
    expect(
      formatErrorLines(new Error("DeepSeek request failed\ninternal_error"))
    ).toEqual(["", "DeepSeek request failed", "internal_error"]);
  });
});

describe("isEscInterruptKey", () => {
  test("matches only a standalone escape key", () => {
    expect(isEscInterruptKey("\u001b")).toBe(true);
    expect(isEscInterruptKey("\u001b[A")).toBe(false);
  });
});

describe("disableRawModeIfActive", () => {
  test("skips setRawMode when stdin is not a TTY", () => {
    const calls: boolean[] = [];
    disableRawModeIfActive({
      isRaw: true,
      isTTY: false,
      setRawMode: (mode) => {
        calls.push(mode);
      },
    } as NodeJS.ReadStream);

    expect(calls).toEqual([]);
  });

  test("skips setRawMode when raw mode is already off", () => {
    const calls: boolean[] = [];
    disableRawModeIfActive({
      isRaw: false,
      isTTY: true,
      setRawMode: (mode) => {
        calls.push(mode);
      },
    } as NodeJS.ReadStream);

    expect(calls).toEqual([]);
  });

  test("disables raw mode when a TTY is currently raw", () => {
    const calls: boolean[] = [];
    disableRawModeIfActive({
      isRaw: true,
      isTTY: true,
      setRawMode: (mode) => {
        calls.push(mode);
      },
    } as NodeJS.ReadStream);

    expect(calls).toEqual([false]);
  });

  test("swallows setRawMode errors so cleanup can continue", () => {
    expect(() =>
      disableRawModeIfActive({
        isRaw: true,
        isTTY: true,
        setRawMode: () => {
          throw new Error("setRawMode rejected");
        },
      } as NodeJS.ReadStream)
    ).not.toThrow();
  });
});
