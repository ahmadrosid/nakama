import { afterEach, expect, test } from "bun:test";
import { createClient } from "./index";

test("chat stream request includes cookie CSRF protection", async () => {
  const originalDocument = (globalThis as typeof globalThis & { document?: { cookie: string } }).document;
  (globalThis as typeof globalThis & { document?: { cookie: string } }).document = {
    cookie: "tinyclaw_csrf=csrf-token-123; other=value",
  };

  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response('data: {"type":"done","reply":"ok"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  try {
    const session = client.createChatSession("session-1", "web");
    const reply = await session.sendStream("hello", () => {});

    expect(reply).toBe("ok");
    expect(fetchCalls).toHaveLength(1);

    const headers = new Headers(fetchCalls[0]!.init?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(fetchCalls[0]!.init?.credentials).toBe("include");
  } finally {
    (globalThis as typeof globalThis & { document?: { cookie: string } }).document = originalDocument;
  }
});
