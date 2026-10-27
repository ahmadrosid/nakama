import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { JsonValue, ToolContext, ToolDefinition } from "@nakama/core";
import { z } from "zod";
import { asTestFetch } from "../providers/test-helpers";
import { saveAgentBrowserConfig } from "../services/agent-browser-service";
import {
  setupTestConfigDir,
  setupTestManagedSecrets,
} from "../test-config-dir";
import { createBrowserTools } from "./browser-tools";

setupTestConfigDir("nakama-browser-tools-test-");

const secrets = setupTestManagedSecrets();

interface KernelCall {
  body: Record<string, JsonValue> | null;
  method: string;
  path: string;
}

const tools = new Map(createBrowserTools().map((tool) => [tool.name, tool]));

const context: ToolContext = {
  orgId: "org-a",
  profileId: "agent-1",
  sessionId: "chat-1",
  userId: "user-1",
};

const USER_BROWSER = "nakama-org-a-user-user-1";

const ImagesResultSchema = z.object({
  images: z.array(z.object({ data: z.string(), mediaType: z.string() })),
});

function tool(name: string): ToolDefinition {
  const found = tools.get(name);

  if (!found) {
    throw new Error(`missing tool ${name}`);
  }

  return found;
}

describe("browser tools", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KERNEL_API_KEY;
  const originalProvider = process.env.NAKAMA_BROWSER_PROVIDER;
  let calls: KernelCall[] = [];
  let browserExists = true;
  let playwrightResponse: (call: KernelCall) => Response;
  let executorLimitReached = false;

  beforeEach(() => {
    delete process.env.KERNEL_API_KEY;
    delete process.env.NAKAMA_BROWSER_PROVIDER;
    calls = [];
    browserExists = true;
    executorLimitReached = false;

    playwrightResponse = () =>
      Response.json({ result: { ok: true }, success: true });

    globalThis.fetch = asTestFetch(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const call = { body, method, path: decodeURIComponent(url.pathname) };

        calls.push(call);

        if (call.path === "/profiles") {
          return Response.json({}, { status: 200 });
        }

        if (call.path === "/browsers" && method === "POST") {
          browserExists = true;

          return Response.json({
            browser_live_view_url: "https://live.kernel.sh/x",
            cdp_ws_url: "wss://cdp.kernel.sh/x",
            session_id: "kernel-1",
          });
        }

        if (call.path.endsWith("/playwright/execute")) {
          if (executorLimitReached && body?.executor) {
            return Response.json({ executors: [] }, { status: 409 });
          }

          return playwrightResponse(call);
        }

        if (call.path.endsWith("/playwright/executors")) {
          return Response.json({
            executors: [
              { last_used_at: "2026-10-19T01:00:00Z", name: "default" },
              { last_used_at: "2026-10-19T01:05:00Z", name: "old-1" },
              { last_used_at: "2026-10-19T01:06:00Z", name: "old-2" },
              { last_used_at: "2026-10-19T01:07:00Z", name: "recent-1" },
              { last_used_at: "2026-10-19T01:08:00Z", name: "recent-2" },
              { last_used_at: "2026-10-19T01:09:00Z", name: "chat-1" },
            ],
          });
        }

        if (call.path.includes("/playwright/executors/")) {
          return new Response(null, { status: 204 });
        }

        if (call.path.endsWith("/computer/screenshot")) {
          return new Response(new Uint8Array([137, 80, 78, 71]), {
            headers: { "content-type": "image/png" },
          });
        }

        if (call.path.endsWith("/computer/batch")) {
          return new Response(null, { status: 200 });
        }

        if (browserExists) {
          return Response.json({
            browser_live_view_url: "https://live.kernel.sh/x",
            cdp_ws_url: "wss://cdp.kernel.sh/x",
            session_id: "kernel-1",
          });
        }

        return Response.json({}, { status: 404 });
      }
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;

    for (const [key, value] of [
      ["KERNEL_API_KEY", originalKey],
      ["NAKAMA_BROWSER_PROVIDER", originalProvider],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("registers the six browser tools", () => {
    expect([...tools.keys()].sort()).toEqual([
      "browser_computer",
      "browser_navigate",
      "browser_playwright",
      "browser_read",
      "browser_screenshot",
      "browser_scroll",
    ]);
  });

  test("refuse to run without a signed-in user", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    await expect(
      tool("browser_read").run({}, { ...context, userId: undefined })
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("refuse to run when Kernel is not set up", async () => {
    await expect(tool("browser_read").run({}, context)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("run on the caller's own browser, in the chat's own tab", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    await tool("browser_navigate").run({ url: "https://example.com" }, context);

    await tool("browser_navigate").run(
      { url: "https://example.com" },
      { ...context, sessionId: "chat-2", userId: "user-2" }
    );

    const executed = calls.filter((call) =>
      call.path.endsWith("/playwright/execute")
    );

    expect(executed.map((call) => [call.path, call.body?.executor])).toEqual([
      [`/browsers/${USER_BROWSER}/playwright/execute`, "chat-1"],
      ["/browsers/nakama-org-a-user-user-2/playwright/execute", "chat-2"],
    ]);
  });

  test("navigate refuses addresses that are not http or https", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    await expect(
      tool("browser_navigate").run({ url: "javascript:alert(1)" }, context)
    ).rejects.toThrow();
    expect(
      calls.some((call) => call.path.endsWith("/playwright/execute"))
    ).toBe(false);
  });

  test("start a missing browser at the small screen size", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );
    browserExists = false;

    await tool("browser_screenshot").run({}, context);

    const created = calls.find(
      (call) => call.path === "/browsers" && call.method === "POST"
    );

    expect(created?.body).toMatchObject({
      name: USER_BROWSER,
      profile: { name: USER_BROWSER, save_changes: true },
      viewport: { height: 800, width: 1280 },
    });
  });

  test("fall back to the default tab when the executor limit is reached", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );
    executorLimitReached = true;

    const result = await tool("browser_scroll").run({}, context);

    const executed = calls.filter((call) =>
      call.path.endsWith("/playwright/execute")
    );

    expect(result).toEqual({ ok: true });
    expect(executed.map((call) => call.body?.executor)).toEqual([
      "chat-1",
      undefined,
    ]);
  });

  test("read caps the page text and keeps the links", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    playwrightResponse = () =>
      Response.json({
        result: {
          links: [{ href: "https://example.com/a", text: "A" }],
          selector: "main",
          text: "x".repeat(25_000),
          title: "Feed",
          url: "https://example.com",
        },
        success: true,
      });

    const ReadResultSchema = z.object({
      links: z.array(z.json()).optional(),
      text: z.string(),
      totalChars: z.number(),
      truncated: z.boolean(),
    });

    const full = ReadResultSchema.parse(
      await tool("browser_read").run({}, context)
    );

    const short = ReadResultSchema.parse(
      await tool("browser_read").run({ maxChars: 100 }, context)
    );

    expect(full.text.length).toBe(20_000);
    expect(full.truncated).toBe(true);
    expect(full.totalChars).toBe(25_000);
    expect(full.links).toHaveLength(1);
    expect(short.text.length).toBe(100);
    expect(short.truncated).toBe(true);
  });

  test("a new chat tab closes the oldest chat tabs", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    playwrightResponse = () =>
      Response.json({ result: {}, success: true, tab: { created: true } });

    await tool("browser_navigate").run({ url: "https://example.com" }, context);

    const closed = calls
      .filter(
        (call) =>
          call.method === "DELETE" &&
          call.path.includes("/playwright/executors/")
      )
      .map((call) => call.path.split("/").pop());

    expect(closed.sort()).toEqual(["old-1", "old-2"]);
  });

  test("read from an offset returns only the text after it", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    playwrightResponse = () =>
      Response.json({
        result: { links: [], text: `${"a".repeat(3000)}${"b".repeat(500)}` },
        success: true,
      });

    const tail = z
      .object({ offset: z.number(), text: z.string(), truncated: z.boolean() })
      .parse(await tool("browser_read").run({ offset: 3000 }, context));

    expect(tail.offset).toBe(3000);
    expect(tail.text).toBe("b".repeat(500));
    expect(tail.truncated).toBe(false);
  });

  test("playwright reports a failed step as an error", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    playwrightResponse = () =>
      Response.json({ error: "locator timed out", success: false });

    await expect(
      tool("browser_playwright").run({ code: "return 1;" }, context)
    ).rejects.toBeInstanceOf(Error);
  });

  test("screenshot and mouse actions bring the chat's tab to the front first", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    await tool("browser_screenshot").run({}, context);
    await tool("browser_computer").run(
      { actions: [{ ms: 1, type: "wait" }] },
      context
    );

    const steps = calls
      .filter(
        (call) =>
          call.path.endsWith("/playwright/execute") ||
          call.path.includes("/computer/")
      )
      .map((call) =>
        call.path.endsWith("/playwright/execute")
          ? `front:${call.body?.executor}`
          : call.path.split("/").pop()
      );

    expect(steps).toEqual([
      "front:chat-1",
      "screenshot",
      "front:chat-1",
      "batch",
      "screenshot",
    ]);
  });

  test("screenshot returns the image to the model", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    const result = ImagesResultSchema.parse(
      await tool("browser_screenshot").run({}, context)
    );

    expect(result.images).toEqual([
      {
        data: Buffer.from([137, 80, 78, 71]).toString("base64"),
        mediaType: "image/png",
      },
    ]);
  });

  test("computer maps actions to Kernel and returns a screenshot", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    const result = ImagesResultSchema.parse(
      await tool("browser_computer").run(
        {
          actions: [
            { type: "click", x: 469, y: 641 },
            { text: "hello", type: "type" },
            { keys: ["Return"], type: "key" },
          ],
        },
        context
      )
    );

    const batch = calls.find((call) => call.path.endsWith("/computer/batch"));

    expect(batch?.body?.actions).toEqual([
      {
        click_mouse: { button: "left", num_clicks: 1, x: 469, y: 641 },
        type: "click_mouse",
      },
      { type: "type_text", type_text: { text: "hello" } },
      { press_key: { keys: ["Return"] }, type: "press_key" },
      { sleep: { duration_ms: 500 }, type: "sleep" },
    ]);
    expect(result.images).toHaveLength(1);
  });

  test("computer refuses too many actions", async () => {
    await saveAgentBrowserConfig(
      { apiKey: "kernel-key", provider: "kernel" },
      secrets()
    );

    await expect(
      tool("browser_computer").run(
        {
          actions: Array.from({ length: 21 }, () => ({ ms: 1, type: "wait" })),
        },
        context
      )
    ).rejects.toThrow();
    expect(calls.some((call) => call.path.endsWith("/computer/batch"))).toBe(
      false
    );
  });
});
