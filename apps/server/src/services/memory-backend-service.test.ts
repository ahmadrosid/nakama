import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getOrgPluginDataDir,
  getProfileSoulDir,
  loadSoulStack,
  runDeleteFile,
  runEditFile,
  runKnowledgeBaseSearch,
  runReadFile,
  runWriteFile,
  uploadKnowledgeBaseDocument,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { MemoryBackendService } from "./memory-backend-service";
import { OrgMemoryService } from "./org-memory-service";

const directories: string[] = [];
const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

async function setup() {
  const configDir = await mkdtemp(join(tmpdir(), "memory-backend-"));
  directories.push(configDir);
  process.env.NAKAMA_CONFIG_DIR = configDir;
  const db = createInMemoryDatabaseAdapter();
  const documents = new Map<string, Record<string, unknown>>();
  let unavailable = false;
  let pending = false;
  let loseWriteResponse = false;
  let writes = 0;
  const transport = async (url: string, init: RequestInit) => {
    if (unavailable) {
      return new Response(null, { status: 503 });
    }
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path === "/v3/documents" && init.method === "POST") {
      writes++;
      const id = body.customId;
      documents.set(id, {
        ...body,
        content: body.content.trim(),
        id,
        status: pending ? "queued" : "done",
      });
      if (loseWriteResponse) {
        loseWriteResponse = false;
        throw new Error("Connection lost after save");
      }
      return Response.json({ id });
    }
    if (path === "/v3/search") {
      return Response.json({
        results: [...documents.values()]
          .filter((doc) =>
            (doc.containerTags as string[]).includes(body.containerTags[0])
          )
          .map((doc) => ({
            chunks: [{ content: doc.content }],
            documentId: doc.id,
            metadata: doc.metadata,
          })),
      });
    }
    const id = decodeURIComponent(path.slice("/v3/documents/".length));
    const document = documents.get(id);
    if (!document) {
      return new Response(null, { status: 404 });
    }
    if (init.method === "DELETE" && document.status === "queued") {
      return new Response(null, { status: 409 });
    }
    if (init.method === "DELETE") {
      documents.delete(id);
    }
    return Response.json(document);
  };
  async function enable(
    orgId: string,
    lifecycleState: "enabled" | "disabled" = "enabled"
  ) {
    const record = await db.getOrgPlugin(orgId, "supermemory");
    await db.compareAndSetOrgPluginState({
      databaseGeneration: null,
      expectedRevision: record?.revision ?? 0,
      lifecycleState,
      now: new Date().toISOString(),
      orgId,
      pluginId: "supermemory",
      selectedVersion: "0.1.0",
    });
    const dir = getOrgPluginDataDir(orgId, "supermemory", configDir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "connection.json"),
      JSON.stringify({ token: "test", url: "http://127.0.0.1:9999" })
    );
  }
  return {
    configDir,
    db,
    documents,
    enable,
    loseNextWriteResponse: () => {
      loseWriteResponse = true;
    },
    service: new MemoryBackendService(db, { configDir, transport }),
    setPending: (value: boolean) => {
      pending = value;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    writes: () => writes,
  };
}

test("built-in memory remains local without an enabled plugin", async () => {
  const h = await setup();
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", "local")).toBe(
    "local"
  );
  expect(h.writes()).toBe(0);
});

test("file tools and prompt loading share memory; failed writes preserve the local copy", async () => {
  const h = await setup();
  await h.enable("org");
  await mkdir(getProfileSoulDir("org", "agent"), { recursive: true });
  const context = {
    orgId: "org",
    profileId: "agent",
    ...h.service.toolContext("org", "agent"),
  };
  await runWriteFile(
    { content: "# Memory\n- tea", path: "MEMORY.md" },
    context
  );
  await runEditFile(
    { edits: [{ newText: "coffee", oldText: "tea" }], path: "MEMORY.md" },
    context
  );
  expect((await runReadFile({ path: "MEMORY.md" }, context)).content).toContain(
    "coffee"
  );
  const root = getProfileSoulDir("org", "agent");
  const stack = await loadSoulStack(root, (content) =>
    h.service.readMemory("org", "agent", "MEMORY.md", content)
  );
  expect(stack.files.memory).toContain("coffee");
  h.setUnavailable(true);
  await expect(
    runWriteFile({ content: "lost update", path: "MEMORY.md" }, context)
  ).rejects.toThrow();
  expect(await readFile(join(root, "MEMORY.md"), "utf8")).toContain("coffee");
  h.setUnavailable(false);
  await runDeleteFile({ path: "MEMORY.md" }, context);
  expect(h.documents.size).toBe(0);
});

test("org proposals stay private until approval and undo restores backend content", async () => {
  const h = await setup();
  await h.enable("org");
  const now = new Date().toISOString();
  await h.db.upsertOrganization({
    createdAt: now,
    id: "org",
    name: "Org",
    slug: "org",
    updatedAt: now,
  });
  const service = new OrgMemoryService(h.db, {
    configDir: h.configDir,
    memoryBackend: h.service,
  });
  await service.addFact("org", "existing policy", { pin: true });
  const proposed = await service.propose("org", { bullet: "new policy" });
  expect(
    [...h.documents.values()].some((doc) =>
      String(doc.content).includes("new policy")
    )
  ).toBe(false);
  await service.approveProposal("org", proposed.proposalId!, "admin", {
    pin: true,
  });
  expect(await service.getSummary("org")).toContain("new policy");
  await service.undoLastChange("org", "admin");
  expect(await service.getSummary("org")).not.toContain("new policy");
  expect(
    (await service.search("org", "policy")).matches.map((match) => match.bullet)
  ).toEqual(["existing policy"]);
});

test("knowledge tool migrates uploads and preserves filename scoping and citations", async () => {
  const h = await setup();
  await h.enable("org");
  for (const [filename, content] of [
    ["policy.txt", "Paid time off is twenty days."],
    ["other.txt", "Another document."],
  ]) {
    await uploadKnowledgeBaseDocument("org", "agent", {
      data: Buffer.from(content!).toString("base64"),
      filename: filename!,
      mediaType: "text/plain",
    });
  }
  const result = await runKnowledgeBaseSearch(
    { filename: "policy.txt", query: "vacation" },
    {
      orgId: "org",
      profileId: "agent",
      ...h.service.toolContext("org", "agent"),
    }
  );
  expect(result.matches).toHaveLength(1);
  expect(result.matches[0]!.file).toStartWith("knowledge-base/");
  expect(result.matches[0]!.text).toContain("twenty days");
});

test("migrates once, preserves exact memory text, and replaces removed facts", async () => {
  const h = await setup();
  await h.enable("org");
  const text = "# Memory Log\n\n- Keep this verbatim.\n";
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", text)).toBe(
    text
  );
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", text)).toBe(
    text
  );
  expect(h.writes()).toBe(1);
  expect(
    await h.service.readMemory("org", "agent", "MEMORY.md", "replacement")
  ).toBe("replacement");
  expect(h.documents.size).toBe(1);
});

test("isolates orgs, agents, and shared org memory", async () => {
  const h = await setup();
  await h.enable("a");
  await h.enable("b");
  for (const [org, profile] of [
    ["a", "agent"],
    ["b", "agent"],
    ["a", "other"],
    ["a", null],
  ] as const) {
    await h.service.readMemory(org, profile, "MEMORY.md", "same content");
  }
  expect(h.documents.size).toBe(4);
});

test("editing while indexing excludes the old version and retries deletion later", async () => {
  const h = await setup();
  await h.enable("org");
  h.setPending(true);
  await h.service.readMemory("org", "agent", "MEMORY.md", "old fact");
  expect(
    await h.service.readMemory("org", "agent", "MEMORY.md", "new fact")
  ).toBe("new fact");
  expect(h.documents.size).toBe(2);
  for (const doc of h.documents.values()) {
    doc.status = "done";
  }
  await h.service.readMemory("org", "agent", "MEMORY.md", "new fact");
  expect(h.documents.size).toBe(1);
});

test("an active backend outage is explicit; disabling uses the retained local copy", async () => {
  const h = await setup();
  await h.enable("org");
  await h.service.readMemory("org", "agent", "MEMORY.md", "saved");
  h.setUnavailable(true);
  await expect(
    h.service.readMemory("org", "agent", "MEMORY.md", "saved")
  ).rejects.toThrow();
  await h.enable("org", "disabled");
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", "saved")).toBe(
    "saved"
  );
});

test("search rejects incomplete indexing and excludes removed documents", async () => {
  const h = await setup();
  await h.enable("org");
  h.setPending(true);
  const entries = [{ content: "holiday policy", id: "one" }];
  await expect(
    h.service.search("org", "knowledge:agent", entries, "vacation", 10)
  ).rejects.toThrow();
  h.setPending(false);
  for (const document of h.documents.values()) {
    document.status = "done";
  }
  expect(
    await h.service.search("org", "knowledge:agent", entries, "vacation", 10)
  ).toEqual([{ id: "one", text: "holiday policy" }]);
  expect(
    await h.service.search("org", "knowledge:agent", [], "vacation", 10)
  ).toEqual([]);
  expect(h.documents.size).toBe(0);
});

test("uncertain writes recover without creating duplicate documents", async () => {
  const h = await setup();
  await h.enable("org");
  h.loseNextWriteResponse();
  await expect(
    h.service.readMemory("org", "agent", "MEMORY.md", "saved")
  ).rejects.toThrow();
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", "saved")).toBe(
    "saved"
  );
  expect(h.writes()).toBe(1);
});

test("chunk boundaries preserve unicode and whitespace", async () => {
  const h = await setup();
  await h.enable("org");
  const text = `${" ".repeat(29_999)}😀\n${"終".repeat(30_000)}\n\t`;
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", text)).toBe(
    text
  );
  expect(h.documents.size).toBe(3);
});

test("undo while indexing keeps the restored version out of deferred cleanup", async () => {
  const h = await setup();
  await h.enable("org");
  h.setPending(true);
  for (const text of ["old", "new", "old"]) {
    expect(await h.service.readMemory("org", "agent", "MEMORY.md", text)).toBe(
      text
    );
  }
  for (const doc of h.documents.values()) {
    doc.status = "done";
  }
  expect(await h.service.readMemory("org", "agent", "MEMORY.md", "old")).toBe(
    "old"
  );
  expect(h.documents.size).toBe(1);
  expect(h.writes()).toBe(2);
});
