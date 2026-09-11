import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginExecutionContext } from "@nakama/core";
import { run } from "./actions";

let dir: string;
const originalFetch = globalThis.fetch;
let calls: {
  path: string;
  method: string;
  body: Record<string, unknown>;
  auth: string | null;
}[];
let reply: (path: string, body: Record<string, unknown>) => Response;
let context: PluginExecutionContext & {
  host: (input: unknown) => Promise<unknown>;
};
const invoke = (actionKey: string, input: Record<string, unknown> = {}) =>
  run(input, { ...context, actionKey });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nakama-supermemory-"));
  const databasePath = join(dir, "plugin.sqlite");
  const db = new Database(databasePath);
  db.exec(
    readFileSync(
      new URL("../migrations/001-supermemory.sql", import.meta.url),
      "utf8"
    )
  );
  db.close();
  context = {
    actor: { id: "admin", role: "admin" },
    apiVersion: 1,
    databasePath,
    dataDir: dir,
    host: async () => [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
    ],
    invocationId: "test",
    orgId: "org-a",
    pluginId: "supermemory",
    pluginVersion: "0.1.0",
  };
  calls = [];
  reply = () => Response.json({});
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const path = new URL(String(url)).pathname;
    calls.push({
      auth: new Headers(init?.headers).get("Authorization"),
      body,
      method: String(init?.method),
      path,
    });
    return reply(path, body);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(dir, { force: true, recursive: true });
});
const configure = () =>
  invoke("save_settings", { token: "secret", url: "http://localhost:3000" });

test("settings are redacted, private and admin-only", async () => {
  await configure();
  expect(await invoke("get_settings")).toEqual({
    configured: true,
    url: "http://localhost:3000",
  });
  expect(statSync(join(dir, "connection.json")).mode % 512).toBe(0o600);
  context.actor.role = "member";
  await expect(configure()).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("profile and org boundaries fail before network access", async () => {
  await configure();
  context.profileId = "alice";
  await expect(
    invoke("search_memory", { agentId: "bob", query: "x" })
  ).rejects.toThrow();
  context.profileId = undefined;
  await expect(
    invoke("search_memory", { agentId: "foreign", query: "x" })
  ).rejects.toThrow();
  context.orgId = "other-org";
  await expect(invoke("list_memories", { agentId: "alice" })).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("ambiguous memory writes cannot be replayed and key reuse is rejected", async () => {
  await configure();
  reply = () => {
    throw new Error("connection lost secret");
  };
  const input = {
    agentId: "alice",
    content: "Prefers tea",
    submissionKey: "one",
  };
  const first = (await invoke("remember", input)) as {
    id: string;
    state: string;
  };
  expect(first.state).toBe("unknown");
  await expect(invoke("remember", input)).rejects.toThrow();
  expect(calls.filter((c) => c.path === "/v4/memories")).toHaveLength(1);
  await expect(
    invoke("remember", { ...input, content: "Changed" })
  ).rejects.toThrow();
  await expect(
    invoke("save_settings", { token: "new", url: "http://localhost:4000" })
  ).rejects.toThrow();
});

test("documents reconcile by customId and foreign IDs cannot be deleted", async () => {
  await configure();
  let tag = "";
  let customId = "";
  reply = (path, body) => {
    if (path === "/v3/documents") {
      tag = String(body.containerTag);
      customId = String(body.customId);
      throw new Error("lost");
    }
    if (path === "/v3/documents/list") {
      return Response.json({ memories: [{ id: "remote-doc" }] });
    }
    return Response.json({
      containerTags: [tag],
      content: "Knowledge",
      customId,
      id: "remote-doc",
      status: "done",
    });
  };
  const input = {
    agentId: "alice",
    content: "Knowledge",
    submissionKey: "doc-one",
    title: "Guide",
  };
  const first = (await invoke("add_document", input)) as { id: string };
  const recovered = (await invoke("add_document", input)) as { state: string };
  expect(recovered.state).toBe("ready");
  expect(calls.filter((c) => c.path === "/v3/documents")).toHaveLength(1);
  const count = calls.length;
  await expect(
    invoke("delete_document", { agentId: "bob", id: first.id })
  ).rejects.toThrow();
  expect(calls).toHaveLength(count);
});

test("invalid text is rejected before ingestion", async () => {
  await configure();
  for (const content of [
    "",
    "https://example.com",
    "binary\u0000data",
    "x".repeat(262_145),
  ]) {
    await expect(
      invoke("add_document", {
        agentId: "alice",
        content,
        submissionKey: "key",
        title: "Doc",
      })
    ).rejects.toThrow();
  }
  expect(calls).toHaveLength(0);
});

test("search and forget require owned metadata and filter the selected fact only", async () => {
  await configure();
  let meta: Record<string, unknown> = {};
  reply = (path, body) => {
    if (path === "/v4/memories" && body.memories) {
      meta = (body.memories as { metadata: Record<string, unknown> }[])[0]!
        .metadata;
      return Response.json({ memories: [{ id: "mem-1" }] });
    }
    if (path === "/v4/memories/list") {
      return Response.json({
        memoryEntries: [{ id: "mem-1", isForgotten: false, metadata: meta }],
      });
    }
    if (path === "/v4/search") {
      return Response.json({
        results: [
          { id: "mem-1", memory: "Prefers tea", metadata: meta },
          { id: "foreign", memory: "Foreign", metadata: meta },
        ],
      });
    }
    return Response.json({});
  };
  const saved = (await invoke("remember", {
    agentId: "alice",
    content: "Prefers tea",
    submissionKey: "tea",
  })) as { id: string };
  expect(
    await invoke("search_memory", { agentId: "alice", query: "drink" })
  ).toMatchObject({ items: [{ excerpt: "Prefers tea", id: saved.id }] });
  expect(
    await invoke("search_memory", { agentId: "bob", query: "drink" })
  ).toEqual({ items: [] });
  expect(
    await invoke("forget_memory", { agentId: "alice", id: saved.id })
  ).toMatchObject({ state: "forgotten" });
  expect(
    await invoke("search_memory", { agentId: "alice", query: "drink" })
  ).toEqual({ items: [] });
  const search = calls.find((call) => call.path === "/v4/search")!;
  expect(search.body).toMatchObject({
    include: { forgottenMemories: false },
    searchMode: "memories",
  });
  const forgotten = calls
    .filter((call) => call.path === "/v4/memories")
    .at(-1)!;
  expect(forgotten.body).toEqual({
    containerTag: meta.nakamaContainer,
    id: "mem-1",
  });
});

test("failed document removal excludes search immediately and retries safely", async () => {
  await configure();
  let meta: Record<string, unknown> = {};
  let customId = "";
  let failDelete = true;
  reply = (path, body) => {
    if (path === "/v3/documents") {
      meta = body.metadata as Record<string, unknown>;
      customId = String(body.customId);
      return Response.json({ id: "doc-1" });
    }
    if (path === "/v3/search") {
      return Response.json({
        results: [
          {
            chunks: [{ content: "Guide excerpt", isRelevant: true }],
            documentId: "doc-1",
            metadata: meta,
          },
        ],
      });
    }
    if (
      calls.at(-1)?.body &&
      Object.keys(body).length === 0 &&
      path === "/v3/documents/doc-1"
    ) {
      return Response.json({
        containerTags: [meta.nakamaContainer],
        customId,
        id: "doc-1",
        status: "done",
      });
    }
    return Response.json({});
  };
  const transport = globalThis.fetch;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    if (init?.method === "DELETE" && failDelete) {
      return new Response("outage", { status: 503 });
    }
    return transport(url, init);
  }) as unknown as typeof fetch;
  const saved = (await invoke("add_document", {
    agentId: "alice",
    content: "Some knowledge",
    submissionKey: "guide",
    title: "Guide",
  })) as { id: string };
  expect(
    await invoke("search_knowledge", { agentId: "alice", query: "guide" })
  ).toMatchObject({ items: [{ excerpt: "Guide excerpt", id: saved.id }] });
  expect(
    await invoke("delete_document", { agentId: "alice", id: saved.id })
  ).toMatchObject({ state: "deleting" });
  expect(
    await invoke("search_knowledge", { agentId: "alice", query: "guide" })
  ).toEqual({ items: [] });
  expect(
    await invoke("get_document", { agentId: "alice", id: saved.id })
  ).toMatchObject({ state: "deleting" });
  failDelete = false;
  expect(
    await invoke("delete_document", { agentId: "alice", id: saved.id })
  ).toMatchObject({ state: "deleted" });
});

test("concurrent saves reserve once, preserve URL/token pairing, and rotate same-server tokens", async () => {
  await configure();
  let complete: ((response: Response) => void) | undefined;
  globalThis.fetch = (async () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    })) as unknown as typeof fetch;
  const input = {
    agentId: "alice",
    content: "Same save",
    submissionKey: "concurrent",
  };
  const first = invoke("remember", input);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const duplicate = await invoke("remember", input);
  expect(duplicate).toMatchObject({ state: "submitting" });
  await expect(
    invoke("save_settings", {
      token: "replacement",
      url: "http://localhost:4000",
    })
  ).rejects.toThrow();
  await invoke("save_settings", {
    token: "rotated",
    url: "http://localhost:3000",
  });
  complete!(Response.json({ memories: [{ id: "one" }] }));
  expect(await first).toMatchObject({ state: "ready" });
  const db = new Database(context.databasePath!);
  expect(
    db
      .query<{ count: number }, []>("SELECT count(*) AS count FROM receipts")
      .get()?.count
  ).toBe(1);
  db.close();
});

test("a late reconciliation cannot resurrect a forgotten memory", async () => {
  await configure();
  let meta: Record<string, unknown> = {};
  reply = (path, body) => {
    if (path === "/v4/memories" && body.memories) {
      meta = (body.memories as { metadata: Record<string, unknown> }[])[0]!
        .metadata;
      return Response.json({ memories: [{ id: "mem-race" }] });
    }
    if (path === "/v4/memories/list") {
      return Response.json({
        memoryEntries: [{ id: "mem-race", isForgotten: false, metadata: meta }],
      });
    }
    return Response.json({});
  };
  const saved = (await invoke("remember", {
    agentId: "alice",
    content: "Secret fact",
    submissionKey: "race",
  })) as { id: string };
  const db = new Database(context.databasePath!);
  db.query("UPDATE receipts SET state='unknown' WHERE id=?").run(saved.id);
  db.close();
  const transport = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  let listingStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    listingStarted = resolve;
  });
  let first = true;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    if (String(url).endsWith("/v4/memories/list") && first) {
      first = false;
      listingStarted();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return transport(url, init);
  }) as unknown as typeof fetch;
  const reconcile = invoke("list_memories", { agentId: "alice", id: saved.id });
  await started;
  expect(
    await invoke("forget_memory", { agentId: "alice", id: saved.id })
  ).toMatchObject({ state: "forgotten" });
  release!(
    Response.json({
      memoryEntries: [{ id: "mem-race", isForgotten: false, metadata: meta }],
    })
  );
  expect(await reconcile).toMatchObject({ items: [{ state: "forgotten" }] });
});

test("an interrupted submission reconciles without creating again", async () => {
  await configure();
  let meta: Record<string, unknown> = {};
  reply = (path, body) => {
    if (path === "/v4/memories") {
      meta = (body.memories as { metadata: Record<string, unknown> }[])[0]!
        .metadata;
      return Response.json({ memories: [{ id: "persisted" }] });
    }
    return Response.json({
      memoryEntries: [{ id: "persisted", isForgotten: false, metadata: meta }],
    });
  };
  const input = {
    agentId: "alice",
    content: "Saya suka teh",
    submissionKey: "restart",
  };
  const saved = (await invoke("remember", input)) as { id: string };
  const db = new Database(context.databasePath!);
  db.query(
    "UPDATE receipts SET state='submitting',upstream_id=NULL,updated_at=0 WHERE id=?"
  ).run(saved.id);
  db.close();
  expect(await invoke("remember", input)).toMatchObject({
    id: saved.id,
    state: "ready",
  });
  expect(calls.filter((call) => call.path === "/v4/memories")).toHaveLength(1);
});

test("wrong-container documents cannot be returned or remotely deleted", async () => {
  await configure();
  reply = (path) =>
    path === "/v3/documents"
      ? Response.json({ id: "doc" })
      : Response.json({
          containerTags: ["foreign"],
          customId: "foreign",
          id: "doc",
          status: "done",
        });
  const saved = (await invoke("add_document", {
    agentId: "alice",
    content: "A guide",
    submissionKey: "ownership",
    title: "Guide",
  })) as { id: string };
  await expect(
    invoke("get_document", { agentId: "alice", id: saved.id })
  ).rejects.toThrow();
  expect(
    await invoke("delete_document", { agentId: "alice", id: saved.id })
  ).toMatchObject({ state: "deleting" });
  expect(
    calls.filter((call) => call.path === "/v3/documents/doc")
  ).toHaveLength(2);
});
