import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonRecord, type JsonValue, run } from "./actions";

let dir: string;

const originalFetch = globalThis.fetch;

let calls: {
  path: string;
  method: string;
  body: JsonRecord;
  auth: string | null;
}[];

let reply: (path: string, body: JsonRecord) => Response;

let context: Parameters<typeof run>[1];

const invoke = (actionKey: string, input: JsonRecord = {}) =>
  run(input, { ...context, actionKey });

function asJsonRecord(value: JsonValue | undefined): JsonRecord {
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }

  return value;
}

function asJsonRecords(value: JsonValue | undefined): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected a JSON array");
  }

  return value.map((entry) => asJsonRecord(entry));
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];

  if (value !== String(value)) {
    throw new Error(`Expected string field: ${key}`);
  }

  return value;
}

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
    actionKey: "remember",
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
  globalThis.fetch = async (url, init) => {
    const body: JsonRecord = JSON.parse(String(init?.body ?? "{}"));
    const path = new URL(String(url)).pathname;
    calls.push({
      auth: new Headers(init?.headers).get("Authorization"),
      body,
      method: String(init?.method),
      path,
    });

    return reply(path, body);
  };
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

  const first = asJsonRecord(await invoke("remember", input));

  expect(stringField(first, "state")).toBe("unknown");
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

  const first = asJsonRecord(await invoke("add_document", input));
  const recovered = asJsonRecord(await invoke("add_document", input));
  expect(stringField(recovered, "state")).toBe("ready");
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
  let meta: JsonRecord = {};
  reply = (path, body) => {
    if (path === "/v4/memories" && body.memories) {
      const memory = asJsonRecords(body.memories)[0];

      if (!memory) {
        throw new Error("Expected a memory request");
      }

      meta = asJsonRecord(memory.metadata);

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

  const saved = await invoke("remember", {
    agentId: "alice",
    content: "Prefers tea",
    submissionKey: "tea",
  });

  const savedRecord = asJsonRecord(saved);

  expect(
    await invoke("search_memory", { agentId: "alice", query: "drink" })
  ).toMatchObject({ items: [{ excerpt: "Prefers tea", id: savedRecord.id }] });
  expect(
    await invoke("search_memory", { agentId: "bob", query: "drink" })
  ).toEqual({ items: [] });
  expect(
    await invoke("forget_memory", { agentId: "alice", id: savedRecord.id })
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
  let meta: JsonRecord = {};
  let customId = "";
  let failDelete = true;
  reply = (path, body) => {
    if (path === "/v3/documents") {
      meta = asJsonRecord(body.metadata);
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
        content: "Full document content",
        customId,
        id: "doc-1",
        status: "done",
      });
    }

    return Response.json({});
  };

  const transport = globalThis.fetch;
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE" && failDelete) {
      return new Response("outage", { status: 503 });
    }

    return transport(url, init);
  };

  const saved = asJsonRecord(
    await invoke("add_document", {
      agentId: "alice",
      content: "Some knowledge",
      submissionKey: "guide",
      title: "Guide",
    })
  );

  const savedId = stringField(saved, "id");

  expect(
    await invoke("get_document", { agentId: "alice", id: savedId })
  ).toMatchObject({ content: "Full document content", state: "ready" });
  expect(
    await invoke("search_knowledge", { agentId: "alice", query: "guide" })
  ).toMatchObject({ items: [{ excerpt: "Guide excerpt", id: savedId }] });
  expect(
    await invoke("delete_document", { agentId: "alice", id: savedId })
  ).toMatchObject({ state: "deleting" });
  expect(
    await invoke("search_knowledge", { agentId: "alice", query: "guide" })
  ).toEqual({ items: [] });
  expect(
    await invoke("get_document", { agentId: "alice", id: savedId })
  ).toMatchObject({ state: "deleting" });
  failDelete = false;
  expect(
    await invoke("delete_document", { agentId: "alice", id: savedId })
  ).toMatchObject({ state: "deleted" });
});

test("concurrent saves reserve once, preserve URL/token pairing, and rotate same-server tokens", async () => {
  await configure();
  let complete: ((response: Response) => void) | undefined;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    });

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
  let meta: JsonRecord = {};
  reply = (path, body) => {
    if (path === "/v4/memories" && body.memories) {
      const memory = asJsonRecords(body.memories)[0];

      if (!memory) {
        throw new Error("Expected a memory request");
      }

      meta = asJsonRecord(memory.metadata);

      return Response.json({ memories: [{ id: "mem-race" }] });
    }

    if (path === "/v4/memories/list") {
      return Response.json({
        memoryEntries: [{ id: "mem-race", isForgotten: false, metadata: meta }],
      });
    }

    return Response.json({});
  };

  const saved = asJsonRecord(
    await invoke("remember", {
      agentId: "alice",
      content: "Secret fact",
      submissionKey: "race",
    })
  );

  const savedId = stringField(saved, "id");

  const db = new Database(context.databasePath!);
  db.query("UPDATE receipts SET state='unknown' WHERE id=?").run(savedId);
  db.close();
  const transport = globalThis.fetch;
  let release: ((response: Response) => void) | undefined;
  let listingStarted: () => void = () => {};

  const started = new Promise<void>((resolve) => {
    listingStarted = resolve;
  });

  let first = true;
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith("/v4/memories/list") && first) {
      first = false;
      listingStarted();

      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }

    return transport(url, init);
  };

  const reconcile = invoke("list_memories", { agentId: "alice", id: savedId });
  await started;
  expect(
    await invoke("forget_memory", { agentId: "alice", id: savedId })
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
  let meta: JsonRecord = {};
  reply = (path, body) => {
    if (path === "/v4/memories") {
      const memory = asJsonRecords(body.memories)[0];

      if (!memory) {
        throw new Error("Expected a memory request");
      }

      meta = asJsonRecord(memory.metadata);

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

  const saved = asJsonRecord(await invoke("remember", input));
  const savedId = stringField(saved, "id");
  const db = new Database(context.databasePath!);
  db.query(
    "UPDATE receipts SET state='submitting',upstream_id=NULL,updated_at=0 WHERE id=?"
  ).run(savedId);
  db.close();
  expect(await invoke("remember", input)).toMatchObject({
    id: savedId,
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

  const saved = asJsonRecord(
    await invoke("add_document", {
      agentId: "alice",
      content: "A guide",
      submissionKey: "ownership",
      title: "Guide",
    })
  );

  const savedId = stringField(saved, "id");

  await expect(
    invoke("get_document", { agentId: "alice", id: savedId })
  ).rejects.toThrow();
  expect(
    await invoke("delete_document", { agentId: "alice", id: savedId })
  ).toMatchObject({ state: "deleting" });
  expect(
    calls.filter((call) => call.path === "/v3/documents/doc")
  ).toHaveLength(2);
});

test("managed connections become available only after readiness and never expose the token", async () => {
  const workerDir = join(dir, "workers", "server");
  mkdirSync(workerDir, { recursive: true });
  writeFileSync(
    join(workerDir, "connection.json"),
    JSON.stringify({ token: "private-token", url: "http://127.0.0.1:5678" })
  );
  writeFileSync(
    join(workerDir, "status.json"),
    JSON.stringify({ state: "starting" })
  );
  expect(await invoke("profiles")).toMatchObject({
    canConfigure: false,
    configured: false,
    managed: true,
  });
  writeFileSync(
    join(workerDir, "status.json"),
    JSON.stringify({ state: "ready" })
  );
  const ready = await invoke("profiles");
  expect(ready).toMatchObject({ configured: true, managed: true });
  expect(JSON.stringify(ready)).not.toContain("private-token");
  writeFileSync(
    join(workerDir, "status.json"),
    JSON.stringify({ message: "Startup failed", state: "error" })
  );
  expect(await invoke("profiles")).toMatchObject({
    configured: false,
    worker: { state: "error" },
  });
});

test("existing external connections take precedence over managed state", async () => {
  await configure();
  expect(await invoke("profiles")).toMatchObject({
    canConfigure: true,
    configured: true,
    managed: false,
  });
});

test("managed settings are automatic and reject manual connection changes", async () => {
  mkdirSync(join(dir, "workers", "server"), { recursive: true });
  expect(await invoke("get_settings")).toMatchObject({
    configured: false,
    managed: true,
  });
  expect(await invoke("profiles")).toMatchObject({ canConfigure: false });
  await expect(
    invoke("save_settings", { token: "secret", url: "http://localhost:9999" })
  ).rejects.toThrow();
});
