import { describe, expect, test } from "bun:test";
import type {
  HealthResponse,
  ModelsResponse,
  ProfileSummary,
} from "@nakama/core";
import {
  createDebouncedEscAbortHandler,
  disableRawModeIfActive,
  formatBusyDropLine,
  formatErrorLines,
  formatStatusLines,
  isEscInterruptKey,
  needsTrailingStreamNewline,
  runCleanupThenExit,
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

describe("formatBusyDropLine", () => {
  test("shows a short busy marker before the warn threshold", () => {
    expect(formatBusyDropLine(1)).toBe("[busy]");
    expect(formatBusyDropLine(2)).toBe("[busy]");
  });

  test("includes the drop count once the warn threshold is reached", () => {
    expect(formatBusyDropLine(3)).toBe(
      "[busy] ignored input (3 while processing)"
    );
    expect(formatBusyDropLine(5)).toBe(
      "[busy] ignored input (5 while processing)"
    );
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

describe("createDebouncedEscAbortHandler", () => {
  test("does not abort bare ESC when more input arrives in the window", async () => {
    let aborted = 0;
    const handler = createDebouncedEscAbortHandler(() => {
      aborted += 1;
    }, 30);

    handler.onData("\u001b");
    handler.onData("[A");
    await Bun.sleep(50);

    expect(aborted).toBe(0);
    handler.dispose();
  });

  test("aborts after a quiet window on bare ESC", async () => {
    let aborted = 0;
    const handler = createDebouncedEscAbortHandler(() => {
      aborted += 1;
    }, 20);

    handler.onData("\u001b");
    await Bun.sleep(40);

    expect(aborted).toBe(1);
    handler.dispose();
  });
});

describe("runCleanupThenExit", () => {
  test("awaits cleanup before exit", async () => {
    const order: string[] = [];

    await runCleanupThenExit(
      async () => {
        await Bun.sleep(5);
        order.push("cleanup");
      },
      () => {
        order.push("exit");
      }
    );

    expect(order).toEqual(["cleanup", "exit"]);
  });

  test("exits even when cleanup throws", async () => {
    const order: string[] = [];

    await runCleanupThenExit(
      async () => {
        order.push("cleanup");
        throw new Error("cleanup failed");
      },
      () => {
        order.push("exit");
      }
    );

    expect(order).toEqual(["cleanup", "exit"]);
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
