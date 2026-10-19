import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getProfileSoulDir,
  runWriteFile,
  type ToolContext,
} from "@nakama/core";
import {
  BUILTIN_TOOL_IDS,
  SAVE_ARTIFACT_TOOL_ID,
} from "@nakama/core/tools/protected";
import {
  createInMemoryDatabaseAdapter,
  ensureSaveArtifactToolDefinition,
} from "@nakama/db";
import { AgentService } from "../services/agent-service";
import {
  createSaveArtifactTool,
  runSaveArtifactTool,
} from "./save-artifact-tool";

const NOW = "2026-10-16T00:00:00.000Z";

type Db = ReturnType<typeof createInMemoryDatabaseAdapter>;

async function seedScope(db: Db): Promise<void> {
  for (const orgId of ["org_a", "org_b"]) {
    await db.upsertOrganization({
      createdAt: NOW,
      id: orgId,
      name: orgId,
      slug: orgId,
      updatedAt: NOW,
    });
  }

  await db.upsertProfile({
    createdAt: NOW,
    id: "profile_a",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Profile A",
    orgId: "org_a",
    systemPrompt: "",
    updatedAt: NOW,
  });

  await db.createUser({
    createdAt: NOW,
    email: "ana@example.com",
    id: "user_ana",
    name: "Ana",
    passwordHash: "unused",
    updatedAt: NOW,
  });

  await db.createUser({
    createdAt: NOW,
    email: "bo@example.com",
    id: "user_bo",
    passwordHash: "unused",
    updatedAt: NOW,
  });

  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: NOW,
    id: "session_a",
    model: null,
    profileId: "profile_a",
    title: null,
    userId: "user_ana",
  });
}

const context: ToolContext = {
  channel: "web",
  orgId: "org_a",
  profileId: "profile_a",
  sessionId: "session_a",
  userId: "user_ana",
};

describe("save_artifact", () => {
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
  let configDir = "";
  let db: Db;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-save-artifact-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    db = createInMemoryDatabaseAdapter();
    await seedScope(db);
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    await rm(configDir, { force: true, recursive: true });
  });

  test("writes the file and records the session user as owner", async () => {
    const result = await runSaveArtifactTool(
      { content: "# Q3", path: "artifacts/reports/q3.md" },
      context,
      { db }
    );

    expect(await readFile(result.path, "utf8")).toBe("# Q3");

    const records = await db.listArtifactRecords("org_a", "profile_a");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      channel: "web",
      filename: "reports/q3.md",
      sessionId: "session_a",
      userId: "user_ana",
      userName: "Ana",
    });
  });

  test("ignores an owner passed in the tool input", async () => {
    await createSaveArtifactTool({ db }).run(
      { content: "x", path: "artifacts/a.md", userId: "user_bo" },
      context
    );

    const [record] = await db.listArtifactRecords("org_a", "profile_a");

    expect(record?.userId).toBe("user_ana");
  });

  test("refuses paths outside artifacts/", async () => {
    for (const target of ["notes.md", "artifacts/../SOUL.md", "artifacts"]) {
      await expect(
        runSaveArtifactTool({ content: "x", path: target }, context, { db })
      ).rejects.toThrow();
    }

    expect(await db.listArtifactRecords("org_a", "profile_a")).toHaveLength(0);
  });

  test("a second save to the same name makes a new file with its own owner", async () => {
    await runSaveArtifactTool(
      { content: "one", path: "artifacts/plan.md" },
      context,
      { db }
    );

    await runSaveArtifactTool(
      { content: "two", path: "artifacts/plan.md" },
      { ...context, userId: "user_bo" },
      { db }
    );

    const artifactsDir = path.join(
      getProfileSoulDir("org_a", "profile_a"),
      "artifacts"
    );

    expect(await readdir(artifactsDir)).toHaveLength(2);

    const owners = (await db.listArtifactRecords("org_a", "profile_a"))
      .map((record) => record.userId)
      .sort();

    expect(owners).toEqual(["user_ana", "user_bo"]);
  });

  test("rows are scoped to their organization", async () => {
    await runSaveArtifactTool(
      { content: "x", path: "artifacts/a.md" },
      context,
      { db }
    );

    expect(await db.listArtifactRecords("org_b", "profile_a")).toHaveLength(0);
  });

  test("the list API returns createdBy, and delete removes the row", async () => {
    await runSaveArtifactTool(
      { content: "x", path: "artifacts/owned.md" },
      context,
      { db }
    );

    await runWriteFile(
      { content: "y", path: "artifacts/unowned.md" },
      { orgId: "org_a", profileId: "profile_a" }
    );

    const agent = new AgentService(null, null, db);
    const listed = await agent.listProfileArtifacts("org_a", "profile_a");

    const byName = new Map(
      listed.artifacts.map((artifact) => [artifact.filename, artifact])
    );

    expect(byName.get("owned.md")?.createdBy).toMatchObject({
      channel: "web",
      userId: "user_ana",
      userName: "Ana",
    });
    expect(byName.get("unowned.md")?.createdBy).toBeUndefined();

    await agent.deleteProfileArtifact("org_a", "profile_a", "owned.md");

    expect(await db.listArtifactRecords("org_a", "profile_a")).toHaveLength(0);
  });
});

describe("member artifact scope (#1816)", () => {
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
  let configDir = "";
  let db: Db;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-member-artifact-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    db = createInMemoryDatabaseAdapter();
    await seedScope(db);
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    await rm(configDir, { force: true, recursive: true });
  });

  test("a member sees only their own artifacts, paged and counted", async () => {
    for (const name of ["a", "b", "c"]) {
      await runSaveArtifactTool(
        { content: name, path: `artifacts/${name}.md` },
        context,
        { db }
      );
    }

    await runSaveArtifactTool(
      { content: "bo", path: "artifacts/bo.md" },
      { ...context, userId: "user_bo" },
      { db }
    );

    const agent = new AgentService(null, null, db);

    const page = await agent.listProfileArtifacts(
      "org_a",
      "profile_a",
      { limit: 2, offset: 0 },
      "user_bo"
    );

    expect(page.total).toBe(1);
    expect(page.artifacts.map((artifact) => artifact.filename)).toEqual([
      "bo.md",
    ]);

    const ana = await agent.listProfileArtifacts(
      "org_a",
      "profile_a",
      { limit: 2, offset: 0 },
      "user_ana"
    );

    expect(ana.total).toBe(3);
    expect(ana.artifacts).toHaveLength(2);
  });

  test("a member cannot delete an artifact someone else made", async () => {
    await runSaveArtifactTool(
      { content: "x", path: "artifacts/ana.md" },
      context,
      { db }
    );

    const agent = new AgentService(null, null, db);

    await expect(
      agent.deleteProfileArtifact("org_a", "profile_a", "ana.md", "user_bo")
    ).rejects.toThrow("Forbidden");

    await agent.deleteProfileArtifact(
      "org_a",
      "profile_a",
      "ana.md",
      "user_ana"
    );

    expect(await db.listArtifactRecords("org_a", "profile_a")).toHaveLength(0);
  });
});

describe("write_file under artifacts/", () => {
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
  let configDir = "";

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-write-artifact-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    await rm(configDir, { force: true, recursive: true });
  });

  test("is refused when save_artifact is assigned", async () => {
    const scope = {
      forbidArtifactFileWrites: true,
      orgId: "org_a",
      profileId: "profile_a",
    };

    await expect(
      runWriteFile({ content: "x", path: "artifacts/a.md" }, scope)
    ).rejects.toThrow();

    const other = await runWriteFile({ content: "x", path: "notes.md" }, scope);

    expect(await readFile(other.path, "utf8")).toBe("x");
  });

  test("still works when save_artifact is not assigned", async () => {
    const written = await runWriteFile(
      { content: "x", path: "artifacts/a.md" },
      { orgId: "org_a", profileId: "profile_a" }
    );

    expect(await readFile(written.path, "utf8")).toBe("x");
  });
});

describe("save_artifact seed", () => {
  test("grants the tool once to profiles that can write files", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedScope(db);

    await db.upsertProfile({
      createdAt: NOW,
      id: "profile_reader",
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Reader",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: NOW,
    });

    await db.upsertTool({
      createdAt: NOW,
      description: "write",
      handlerConfig: {},
      handlerType: "builtin",
      id: BUILTIN_TOOL_IDS.write_file,
      name: "write_file",
      updatedAt: NOW,
    });
    await db.assignToolToProfile("profile_a", BUILTIN_TOOL_IDS.write_file);

    await ensureSaveArtifactToolDefinition(db);

    const toolIds = async (profileId: string) =>
      (await db.listToolsForProfile(profileId)).map((tool) => tool.id);

    expect(await toolIds("profile_a")).toContain(SAVE_ARTIFACT_TOOL_ID);
    expect(await toolIds("profile_reader")).not.toContain(
      SAVE_ARTIFACT_TOOL_ID
    );

    await db.unassignToolFromProfile("profile_a", SAVE_ARTIFACT_TOOL_ID);
    await ensureSaveArtifactToolDefinition(db);

    expect(await toolIds("profile_a")).not.toContain(SAVE_ARTIFACT_TOOL_ID);
  });
});
