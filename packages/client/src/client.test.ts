import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getUserConfigDir, saveUserConfig } from "@tinyclaw/core";
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

test("clients send org context on authenticated requests", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    authToken: "local-auth-token",
    orgId: "org_test",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return Response.json({ profiles: [] });
    },
  });

  await client.listProfiles();

  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("X-Org-Id")).toBe("org_test");
});

test("non-browser clients send local auth as a bearer token", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    authToken: "local-auth-token",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return Response.json({ ok: true });
    },
  });

  await client.health();

  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
});

test("non-browser clients reload the local auth token once after a 401", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "tinyclaw-client-auth-reload-"));
  process.env.TINYCLAW_CONFIG_DIR = configDir;

  try {
    await writeFile(
      join(getUserConfigDir(), "local-auth-token"),
      "tc_local_stale\n",
      "utf8",
    );
    await saveUserConfig({
      defaultProviderId: null,
      providers: [],
      localAuthTokenHash: createHash("sha256").update("tc_local_fresh").digest("hex"),
    });
    await writeFile(
      join(getUserConfigDir(), "local-auth-token"),
      "tc_local_fresh\n",
      "utf8",
    );

    let attempts = 0;
    const client = createClient({
      baseUrl: "http://localhost:4310",
      authToken: "tc_local_stale",
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: "Authentication required" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        return Response.json({ ok: true });
      },
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  } finally {
    delete process.env.TINYCLAW_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
  }
});
