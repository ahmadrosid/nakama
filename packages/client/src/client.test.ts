import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getUserConfigDir, saveUserConfig } from "@nakama/core";
import { createClient } from "./index";

test("chat stream request includes cookie CSRF protection", async () => {
  const originalDocument = (globalThis as typeof globalThis & { document?: { cookie: string } }).document;
  (globalThis as typeof globalThis & { document?: { cookie: string } }).document = {
    cookie: "nakama_csrf=csrf-token-123; other=value",
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

test("data export downloads zip bytes with filename metadata", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    authToken: "local-auth-token",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Disposition": 'attachment; filename="nakama-export-test.zip"',
          "Content-Type": "application/zip",
        },
      });
    },
  });

  const result = await client.exportData();

  expect(fetchCalls[0]!.input.toString()).toBe("http://localhost:4310/v1/platform/data/export");
  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("Content-Type")).toBeNull();
  expect(result.filename).toBe("nakama-export-test.zip");
  expect(Array.from(new Uint8Array(result.data))).toEqual([1, 2, 3]);
});

test("readProfileArtifactContent fetches artifact bytes with inline query", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    authToken: "local-auth-token",
    orgId: "org_test",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response("# Report", {
        headers: {
          "Content-Type": "text/markdown",
          "Content-Disposition": 'inline; filename="report.md"',
        },
      });
    },
  });

  const result = await client.readProfileArtifactContent("profile_1", "weekly/report.md", {
    inline: true,
  });

  expect(fetchCalls[0]!.input.toString()).toBe(
    "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=weekly%2Freport.md&inline=1",
  );
  const headers = new Headers(fetchCalls[0]!.init?.headers);
  expect(headers.get("Authorization")).toBe("Bearer local-auth-token");
  expect(headers.get("X-Org-Id")).toBe("org_test");
  expect(result.contentType).toBe("text/markdown");
  expect(new TextDecoder().decode(result.data)).toBe("# Report");
});

test("data import helpers upload base64 archive data", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    authToken: "local-auth-token",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      if (input.toString().endsWith("/preview")) {
        return Response.json({
          manifest: { kind: "nakama-export" },
          archiveFileCount: 1,
          archiveTotalBytes: 3,
          topLevelPaths: ["config.ini"],
          willReplaceRoot: true,
        });
      }

      return Response.json({
        manifest: { kind: "nakama-export" },
        restoredRoot: "/tmp/nakama",
        restoredFileCount: 1,
      });
    },
  });

  await expect(client.previewDataImport(new Uint8Array([1, 2, 3]))).resolves.toMatchObject({
    archiveFileCount: 1,
  });
  await expect(
    client.restoreDataImport(new Uint8Array([4, 5, 6]), { confirm: true }),
  ).resolves.toMatchObject({ restoredFileCount: 1 });

  expect(JSON.parse(fetchCalls[0]!.init?.body as string)).toEqual({ data: "AQID" });
  expect(JSON.parse(fetchCalls[1]!.init?.body as string)).toEqual({
    confirm: true,
    data: "BAUG",
  });
  expect(new Headers(fetchCalls[1]!.init?.headers).get("Authorization")).toBe(
    "Bearer local-auth-token",
  );
});

test("non-browser clients reload the local auth token once after a 401", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-client-auth-reload-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;

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
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
  }
});

test("notification destination client methods hit the expected routes", async () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createClient({
    baseUrl: "http://localhost:4310",
    authToken: "local-auth-token",
    orgId: "org_test",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });

      if (init?.method === "POST" && input.toString().endsWith("/rotate-key")) {
        return Response.json({ destination: { id: "dest_1" }, apiKey: "rotated" });
      }

      if (init?.method === "POST") {
        return Response.json({ destination: { id: "dest_1" }, apiKey: "created" });
      }

      if (init?.method === "PUT") {
        return Response.json({ id: "dest_1", name: "Ops" });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return Response.json({ destinations: [] });
    },
  });

  await client.listNotificationDestinations();
  await client.createNotificationDestination({
    name: "Ops",
    channel: "telegram",
    telegram: { chatId: 1001 },
  });
  await client.updateNotificationDestination("dest_1", {
    name: "Ops",
    telegram: { chatId: 1001, topicId: 22 },
  });
  await client.regenerateNotificationDestinationKey("dest_1");
  await client.deleteNotificationDestination("dest_1");

  expect(fetchCalls[0]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations",
  );
  expect(fetchCalls[1]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations",
  );
  expect(fetchCalls[2]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations/dest_1",
  );
  expect(fetchCalls[3]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations/dest_1/rotate-key",
  );
  expect(fetchCalls[4]?.input.toString()).toBe(
    "http://localhost:4310/v1/notification-destinations/dest_1",
  );
});
