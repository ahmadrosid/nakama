import { describe, expect, spyOn, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { NakamaClient } from "@nakama/client";
import type {
  HealthResponse,
  ModelsResponse,
  ProfileSummary,
} from "@nakama/core";
import {
  createChatExitController,
  createDebouncedEscAbortHandler,
  disableRawModeIfActive,
  formatBusyDropLine,
  formatErrorLines,
  formatSoulStatusLines,
  formatStatusLines,
  formatToolCall,
  isEscInterruptKey,
  needsTrailingStreamNewline,
  previewToolValue,
  runChat,
  runCleanupThenExit,
  toolResultFailed,
} from "./chat";
import * as profile from "./profile";
import * as promptModule from "./prompt";
import { TerminalRenderer } from "./terminal-renderer";

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

describe("tool rendering", () => {
  test("shows a compact summary without raw arguments and fits the terminal", () => {
    const input = { command: "bun test\n--coverage", secret: "hidden" };
    expect(formatToolCall("bash", input, "done", 400, 80)).toBe(
      "✓ bash bun test --coverage  0.4s"
    );
    expect(
      formatToolCall(
        "read_file",
        { path: "src/chat.ts" },
        "running",
        undefined,
        80
      )
    ).toBe("⠋ read_file src/chat.ts");
    expect(
      formatToolCall("bash", input, "error", 400, 20).length
    ).toBeLessThanOrEqual(18);
    expect(
      formatToolCall("custom", { secret: "hidden" }, "done", undefined, 80)
    ).toBe("✓ custom");
  });

  test("previews tool values without flooding the terminal", () => {
    expect(previewToolValue({ query: "hello" })).toBe('{"query":"hello"}');
    expect(previewToolValue("line\none")).toBe("line one");
    expect(previewToolValue("x".repeat(200))).toHaveLength(160);
  });

  test("detects failed tool results", () => {
    expect(toolResultFailed({ isError: true })).toBe(true);
    expect(toolResultFailed({ error: "failed" })).toBe(true);
    expect(toolResultFailed({ content: "ok" })).toBe(false);
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
    version: "0.4.10",
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

describe("formatSoulStatusLines", () => {
  const directory = join(
    homedir(),
    ".nakama",
    "orgs",
    "org_secret",
    "profiles",
    "agent-x"
  );
  const status = {
    active: true,
    directory,
    files: {
      examples: false,
      instructions: true,
      memory: true,
      soul: true,
      style: true,
    },
    profileId: "agent-x",
  };

  test("masks soul directory by default", () => {
    expect(formatSoulStatusLines(status)[0]).toBe(
      "Soul directory: ~/.nakama/orgs/<org>/profiles/<profile>"
    );
  });

  test("shows absolute soul directory when verbose", () => {
    expect(formatSoulStatusLines(status, true)[0]).toBe(
      `Soul directory: ${directory}`
    );
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

describe("non-TTY slash commands and EOF", () => {
  const selected = {
    id: "test",
    model: null,
    name: "Test",
  } as ProfileSummary;

  async function runBlockingInput(input: string | null) {
    const client = new NakamaClient();
    const session = client.createChatSession("test", "cli");
    const output: string[] = [];
    const clear = spyOn(session, "clear").mockResolvedValue(undefined);
    const sendStream = spyOn(session, "sendStream").mockResolvedValue("");
    let promptCount = 0;
    const spies = [
      spyOn(profile, "resolveStartupProfile").mockResolvedValue({
        profile: selected,
        profileId: selected.id,
      }),
      spyOn(client, "createSession").mockResolvedValue(session),
      spyOn(client, "listProfiles").mockResolvedValue({ profiles: [selected] }),
      spyOn(TerminalRenderer.prototype, "apply").mockReturnValue(false),
      spyOn(promptModule, "promptLine").mockImplementation(async () => {
        if (input === null || promptCount > 0) {
          throw new promptModule.PromptCancelledError();
        }
        promptCount += 1;
        return { text: input };
      }),
      spyOn(console, "log").mockImplementation((...args) => {
        output.push(args.map(String).join(" "));
      }),
    ];

    try {
      await runChat({
        channel: "cli",
        client,
        offline: true,
      });

      return {
        clearCalls: clear.mock.calls.length,
        output,
        sendCalls: sendStream.mock.calls.length,
      };
    } finally {
      for (const currentSpy of spies) {
        currentSpy.mockRestore();
      }
      clear.mockRestore();
      sendStream.mockRestore();
    }
  }

  test("runs /help locally without sending it to the model", async () => {
    const result = await runBlockingInput("/help");

    expect(result.output.some((line) => line.includes("/help"))).toBe(true);
    expect(result.sendCalls).toBe(0);
  });

  test("runs /clear locally without sending it to the model", async () => {
    const result = await runBlockingInput("/clear");

    expect(result.clearCalls).toBe(1);
    expect(result.sendCalls).toBe(0);
  });

  test("rejects interactive-only commands without sending them", async () => {
    const result = await runBlockingInput("/compact");

    expect(
      result.output.some((line) =>
        line.includes("/compact requires an interactive terminal")
      )
    ).toBe(true);
    expect(result.sendCalls).toBe(0);
  });

  test("treats EOF as clean cancellation", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const pendingPrompt = promptModule.promptLine("> ", input, output);
    input.end();

    await expect(pendingPrompt).rejects.toBeInstanceOf(
      promptModule.PromptCancelledError
    );

    const result = await runBlockingInput(null);
    expect(result.sendCalls).toBe(0);
  });
});
