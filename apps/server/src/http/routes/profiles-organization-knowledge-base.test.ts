import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import {
  attachSharedKnowledgeBaseDocument,
  type GenerateChatInput,
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
  getOrgKnowledgeBaseDir,
  getProfileSoulDir,
} from "@nakama/core";
import { runKnowledgeBaseSearch } from "@nakama/core/tools/knowledge-base-search";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { zipSync } from "fflate";
import { AgentService } from "../../services/agent-service";
import { MemoryBackendService } from "../../services/memory-backend-service";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  createOrgAdminSession,
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-org-knowledge-base-routes-");

const BASE = "http://localhost:4310";

const textDocument = (content: string) => ({
  data: Buffer.from(content, "utf8").toString("base64"),
  filename: "handbook.txt",
  mediaType: "text/plain",
});

describe("profile knowledge base ZIP import", () => {
  test("imports a valid 15 MiB stored ZIP", async () => {
    const { app, orgId, post, profileId, session } = await setupSession(
      "platform-kb-large-zip@example.com"
    );

    const bytes = Buffer.alloc(15 * 1024 * 1024, 65);
    const archive = zipSync({ "large.txt": bytes }, { level: 0 });

    const response = await post(
      `/v1/profiles/${profileId}/knowledge-base/import-zip`,
      JSON.stringify({ zipBase64: Buffer.from(archive).toString("base64") })
    );

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.totals).toEqual({
      created: 1,
      duplicate: 0,
      error: 0,
      failedExtraction: 0,
      unsupported: 0,
    });
    const documentId = result.entries[0].documentId;

    const content = await app.fetch(
      new Request(
        `${BASE}/v1/profiles/${profileId}/knowledge-base/${documentId}/content`,
        { headers: session.headers({}, orgId) }
      )
    );

    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(bytes);
  }, 30_000);

  test("rejects noncanonical base64 without importing documents", async () => {
    const { post, profileId } = await setupSession(
      "platform-kb-canonical-zip@example.com"
    );

    const archive = zipSync({ "a.txt": Buffer.from("x") }, { level: 0 });
    const canonical = Buffer.from(archive).toString("base64");
    expect(canonical.endsWith("==")).toBe(true);
    const noncanonicalPadding = `${canonical.slice(0, -3)}B==`;
    expect(Buffer.from(noncanonicalPadding, "base64")).toEqual(
      Buffer.from(archive)
    );
    const path = `/v1/profiles/${profileId}/knowledge-base/import-zip`;

    for (const zipBase64 of [
      `${canonical}\n`,
      ` ${canonical}`,
      `${canonical}!`,
      canonical.slice(0, -2),
      `${canonical}=`,
      `${canonical.slice(0, 4)}=${canonical.slice(4)}`,
      noncanonicalPadding,
    ]) {
      const response = await post(path, JSON.stringify({ zipBase64 }));
      expect(response.status).toBe(400);
    }

    const response = await post(path, JSON.stringify({ zipBase64: canonical }));
    expect(response.status).toBe(200);
    expect((await response.json()).totals.created).toBe(1);
  }, 30_000);

  const body = (files: Record<string, Uint8Array>) =>
    JSON.stringify({
      zipBase64: Buffer.from(zipSync(files)).toString("base64"),
    });

  test("imports entries, reports partial results, and serves nested documents", async () => {
    const { app, orgId, post, profileId, session } = await setupSession(
      "platform-kb-zip-1@example.com"
    );

    const path = `/v1/profiles/${profileId}/knowledge-base/import-zip`;

    const response = await post(
      path,
      body({
        "guides/setup.md": Buffer.from("The comet manual"),
        "copy.md": Buffer.from("The comet manual"),
        "empty.txt": Buffer.from("  "),
        "image.png": Buffer.from([1, 2, 3]),
        "__MACOSX/._setup.md": Buffer.from("metadata"),
      })
    );

    expect(response.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const result = (await response.json()) as {
      entries: Array<{
        documentId?: string;
        filename: string;
        match?: string;
        outcome: string;
        status?: string;
      }>;
      totals: Record<string, number>;
    };

    expect(result.totals).toEqual({
      created: 2,
      duplicate: 1,
      unsupported: 1,
      error: 0,
      failedExtraction: 1,
    });
    expect(
      result.entries.find((entry) => entry.filename === "copy.md")
    ).toMatchObject({
      match: "content_hash",
      outcome: "duplicate",
    });
    expect(
      result.entries.some((entry) => entry.filename.startsWith("__MACOSX"))
    ).toBe(false);

    const created = result.entries.find(
      (entry) => entry.filename === "guides/setup.md"
    )!;

    expect(created.status).toBe("ready");

    const extracted = await readFile(
      getKnowledgeBaseExtractedPath(
        getKnowledgeBaseDir(orgId, profileId),
        created.documentId!
      ),
      "utf8"
    );

    expect(extracted).toContain("The comet manual");

    const content = await app.fetch(
      new Request(
        `${BASE}/v1/profiles/${profileId}/knowledge-base/${created.documentId}/content`,
        { headers: session.headers({}, orgId) }
      )
    );

    expect(content.status).toBe(200);
    expect(content.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''setup.md"
    );
    expect(await content.text()).toBe("The comet manual");

    const retry = await post(
      path,
      body({ "guides/setup.md": Buffer.from("The comet manual") })
    );

    expect(retry.status).toBe(200);
    expect((await retry.json()).totals.duplicate).toBe(1);

    const removed = await app.fetch(
      new Request(
        `${BASE}/v1/profiles/${profileId}/knowledge-base/${created.documentId}`,
        {
          headers: session.headers(
            { "X-CSRF-Token": session.csrfToken },
            orgId
          ),
          method: "DELETE",
        }
      )
    );

    expect(removed.status).toBe(200);
    expect((await removed.json()).deleted).toBe(true);
  }, 30_000);

  test("reports a name and size conflict without replacing the document", async () => {
    const { post, profileId } = await setupSession(
      "platform-kb-zip-2@example.com"
    );

    const path = `/v1/profiles/${profileId}/knowledge-base/import-zip`;
    expect(
      (await post(path, body({ "same.txt": Buffer.from("one") }))).status
    ).toBe(200);
    const response = await post(path, body({ "same.txt": Buffer.from("two") }));
    expect(response.status).toBe(200);
    expect((await response.json()).entries[0]).toMatchObject({
      match: "name_size",
      outcome: "duplicate",
    });
  }, 30_000);

  test("syncs once and can retry after a sync error", async () => {
    const { post, profileId } = await setupSession(
      "platform-kb-zip-sync@example.com"
    );

    const path = `/v1/profiles/${profileId}/knowledge-base/import-zip`;

    const payload = body({
      "a.txt": Buffer.from("first"),
      "b.txt": Buffer.from("second"),
    });

    const sync = spyOn(MemoryBackendService.prototype, "syncKnowledge");

    try {
      expect((await post(path, payload)).status).toBe(200);
      expect(sync).toHaveBeenCalledTimes(1);
      sync.mockRejectedValueOnce(new Error("sync unavailable"));
      expect((await post(path, payload)).status).toBe(500);
      expect(sync).toHaveBeenCalledTimes(2);
      const retry = await post(path, payload);
      expect(retry.status).toBe(200);
      expect((await retry.json()).totals.duplicate).toBe(2);
      expect(sync).toHaveBeenCalledTimes(3);
    } finally {
      sync.mockRestore();
    }
  }, 30_000);

  test("rejects invalid ZIPs before adding documents", async () => {
    const { app, orgId, post, profileId, session } = await setupSession(
      "platform-kb-zip-3@example.com"
    );

    const path = `/v1/profiles/${profileId}/knowledge-base/import-zip`;

    const invalid = [
      JSON.stringify({ zipBase64: "invalid!" }),
      JSON.stringify({
        zipBase64: Buffer.from("not a ZIP").toString("base64"),
      }),
      body({ "../escape.md": Buffer.from("bad") }),
      body({ "a/./b.md": Buffer.from("bad") }),
      body({ "a\\b.md": Buffer.from("bad") }),
      body({ "bad\nname.md": Buffer.from("bad") }),
      body({ "e\u0301.md": Buffer.from("one"), "é.md": Buffer.from("two") }),
      body({ "nope.png": Buffer.from("bad") }),
      body({}),
    ];

    for (const payload of invalid) {
      const response = await post(path, payload);
      expect(response.status).toBe(400);
    }

    expect(
      (
        await post(
          path,
          body({ "big.txt": Buffer.alloc(20 * 1024 * 1024 + 1) })
        )
      ).status
    ).toBe(413);
    const many: Record<string, Uint8Array> = {};

    for (let index = 0; index < 101; index += 1) {
      many[`file-${index}.txt`] = Buffer.from("x");
    }

    expect((await post(path, body(many))).status).toBe(413);
    const total: Record<string, Uint8Array> = {};

    for (let index = 0; index < 6; index += 1) {
      total[`large-${index}.txt`] = Buffer.alloc(17 * 1024 * 1024);
    }

    expect((await post(path, body(total))).status).toBe(413);
    expect(
      (
        await post(
          path,
          JSON.stringify({
            zipBase64: "A".repeat(Math.ceil((20 * 1024 * 1024) / 3) * 4 + 4),
          })
        )
      ).status
    ).toBe(413);

    const list = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}/knowledge-base`, {
        headers: session.headers({}, orgId),
      })
    );

    expect(list.status).toBe(200);
    expect((await list.json()).documents).toEqual([]);
  }, 30_000);

  test("openapi describes the ZIP import route", async () => {
    const { app } = createApp();
    const response = await app.fetch(new Request(`${BASE}/openapi.json`));

    const spec: ReturnType<typeof app.getOpenAPI31Document> =
      await response.json();

    expect(
      spec.paths?.["/v1/profiles/{profileId}/knowledge-base/import-zip"]?.post
    ).toBeDefined();
  });

  test("requires a platform administrator and the active organization", async () => {
    const { app, authService, databaseAdapter } = createApp();

    const { adminSession, orgId } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-org-kb-zip-guard",
      "org-admin-kb-zip@acme.com"
    );

    const denied = await app.fetch(
      new Request(`${BASE}/v1/profiles/profile_1/knowledge-base/import-zip`, {
        body: body({ "x.txt": Buffer.from("x") }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(denied.status).toBe(403);

    const {
      post,
      profileId,
      session: platformSession,
      app: otherApp,
      authService: otherAuthService,
      databaseAdapter: otherDatabase,
      orgId: firstOrgId,
    } = await setupSession("platform-kb-zip-4@example.com");

    expect(
      (
        await post(
          `/v1/profiles/${profileId}-other/knowledge-base/import-zip`,
          body({ "x.txt": Buffer.from("x") })
        )
      ).status
    ).toBe(404);

    const { orgId: secondOrgId } = await createOrgAdminSession(
      otherApp,
      otherAuthService,
      otherDatabase,
      "other-kb-zip-org",
      "other-kb-zip-admin@example.com"
    );

    expect(secondOrgId).not.toBe(firstOrgId);

    const crossOrg = await otherApp.fetch(
      new Request(
        `${BASE}/v1/profiles/${profileId}/knowledge-base/import-zip`,
        {
          body: body({ "x.txt": Buffer.from("x") }),
          headers: platformSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": platformSession.csrfToken,
            },
            secondOrgId
          ),
          method: "POST",
        }
      )
    );

    expect(crossOrg.status).toBe(404);
  }, 30_000);
});

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);

  return {
    ...createMinimalHonoApp({
      agent: {
        readPublishedKnowledgeBaseDocument: (
          orgId: string,
          publicationId: string,
          options: { render?: "text" }
        ) =>
          profileService.readPublishedKnowledgeBaseDocument(
            orgId,
            publicationId,
            options
          ),
        deleteKnowledgeBaseDocument: (
          orgId: string,
          profileId: string,
          documentId: string
        ) =>
          profileService.deleteKnowledgeBaseDocument(
            orgId,
            profileId,
            documentId
          ),
        deleteOrganizationKnowledgeBaseDocument: (
          orgId: string,
          documentId: string
        ) =>
          profileService.deleteOrganizationKnowledgeBaseDocument(
            orgId,
            documentId
          ),
        getProfile: (orgId: string, profileId: string) =>
          profileService.getProfile(orgId, profileId),
        importKnowledgeBaseZip: (
          orgId: string,
          profileId: string,
          zipBase64: string
        ) => profileService.importKnowledgeBaseZip(orgId, profileId, zipBase64),
        listKnowledgeBase: (orgId: string, profileId: string) =>
          profileService.listKnowledgeBase(orgId, profileId),
        listOrganizationKnowledgeBase: (orgId: string) =>
          profileService.listOrganizationKnowledgeBase(orgId),
        listProfiles: async () => ({ profiles: [] }),
        readOrganizationKnowledgeBaseDocument: (
          orgId: string,
          documentId: string,
          options: { render?: "text" }
        ) =>
          profileService.readOrganizationKnowledgeBaseDocument(
            orgId,
            documentId,
            options
          ),
        readKnowledgeBaseDocument: (
          orgId: string,
          profileId: string,
          documentId: string,
          options: { render?: "text" }
        ) =>
          profileService.readKnowledgeBaseDocument(
            orgId,
            profileId,
            documentId,
            options
          ),
        uploadOrganizationKnowledgeBaseDocument: (
          orgId: string,
          document: Parameters<
            ProfileService["uploadOrganizationKnowledgeBaseDocument"]
          >[1],
          onDuplicate?: "error" | "replace" | "skip"
        ) =>
          profileService.uploadOrganizationKnowledgeBaseDocument(
            orgId,
            document,
            onDuplicate
          ),
      },
      databaseAdapter,
    }),
    databaseAdapter,
    profileService,
  };
}

async function setupPublishedKnowledge() {
  const { app, authService, databaseAdapter: db, profileService } = createApp();
  const now = new Date().toISOString();

  for (const id of ["org_parent", "org_other", "org_team_a", "org_team_b"]) {
    await db.upsertOrganization({
      createdAt: now,
      updatedAt: now,
      id,
      name: id,
      slug: id.replaceAll("_", "-"),
      parentOrgId: id.startsWith("org_team") ? "org_parent" : null,
    });
  }

  await db.createUser({
    id: "user_reader",
    email: "shared-reader@example.com",
    createdAt: now,
    updatedAt: now,
    passwordHash: await authService.hashPassword("password123"),
  });

  for (const orgId of ["org_team_a", "org_team_b", "org_other"]) {
    await db.upsertOrgMember({
      orgId,
      userId: "user_reader",
      role: "member",
      createdAt: now,
    });
  }

  const { document } =
    await profileService.uploadOrganizationKnowledgeBaseDocument(
      "org_parent",
      textDocument("Published parent bytes")
    );

  const privateDocument =
    await profileService.uploadOrganizationKnowledgeBaseDocument("org_parent", {
      ...textDocument("Private parent bytes"),
      filename: "private.txt",
    });

  const publication = await db.publishOrgSharedResource({
    id: "publication_knowledge",
    orgId: "org_parent",
    resourceId: document.id,
    resourceKind: "knowledge",
    createdAt: now,
    updatedAt: now,
  });

  await db.publishOrgSharedResource({
    id: "publication_other",
    orgId: "org_other",
    resourceId: document.id,
    resourceKind: "knowledge",
    createdAt: now,
    updatedAt: now,
  });

  const session = await loginUserSession(
    app,
    "shared-reader@example.com",
    "password123"
  );

  const read = (
    pathOrg = "org_team_a",
    id = publication.id,
    query = "",
    activeOrg = pathOrg
  ) =>
    app.fetch(
      new Request(
        `${BASE}/v1/orgs/${pathOrg}/shared-resources/${id}/content${query}`,
        { headers: session.headers({}, activeOrg) }
      )
    );

  return {
    app,
    db,
    profileService,
    publication,
    document,
    privateDocument: privateDocument.document,
    session,
    read,
  };
}

describe("published parent knowledge reads", () => {
  test.each([false, true])(
    "cached prompt catalogs recheck publications for cognito=%s",
    async (cognito) => {
      const { db, profileService, publication, document } =
        await setupPublishedKnowledge();

      const created = await profileService.createProfile("org_team_a", {
        name: "Prompt reader",
      });

      const prompts: string[] = [];
      const agent = new AgentService(null, null, db);
      Object.assign(agent, {
        _providerConfigured: true,
        resolveProfileTools: async () => [],
        createHarnessForProfile: () => ({
          provider: {
            name: "test",
            generateChat(input: GenerateChatInput) {
              prompts.push(input.system ?? "");

              return Promise.resolve({
                content: "Done",
                assistantMessage: { role: "assistant", content: "Done" },
                toolCalls: [],
              });
            },
          },
        }),
      });

      const id = await agent.createSession(
        "org_team_a",
        "web",
        created.profile.id,
        null,
        { cognito, orgRole: "member" }
      );

      const session = await agent.resolveSession(id, "org_team_a");
      expect(session).not.toBeNull();
      await session!.send("First question");
      expect(prompts[0]).toContain('"id":"org_parent"');
      expect(prompts[0]).not.toContain(document.filename);
      expect(prompts[0]).not.toContain("Published parent bytes");
      await db.deleteOrgSharedResource("org_parent", publication.id);
      await session!.send("Second question");
      expect(prompts[1]).not.toContain('"id":"org_parent"');
      expect(await agent.resolveSession(id, "org_team_a")).toBe(session);
      expect(
        session!.getHistory().filter((message) => message.role === "user")
      ).toHaveLength(2);
      const parent = await db.getOrganizationById("org_parent");
      await db.upsertOrganization({ ...parent!, name: "Renamed parent" });
      await db.publishOrgSharedResource(publication);
      await session!.send("Third question");
      expect(prompts[2]).toContain('"name":"Renamed parent"');
      expect(
        session!.getHistory().filter((message) => message.role === "user")
      ).toHaveLength(3);
    }
  );
  test("server tool contexts recheck parent publications during real search", async () => {
    const { db, profileService, publication } = await setupPublishedKnowledge();

    const created = await profileService.createProfile("org_team_a", {
      name: "Reader",
    });

    const agent = new AgentService(null, null, db);

    const context = agent.buildPluginToolContext("org_team_a", {
      profileId: created.profile.id,
      runId: "run",
      workflowId: "workflow",
    });

    expect(context.workspaceRoot).toBe(
      getProfileSoulDir("org_team_a", created.profile.id)
    );

    const initial = await runKnowledgeBaseSearch(
      { query: "Published parent", regex: true },
      context
    );

    expect(
      initial.matches.filter((match) => match.scope === "parent")
    ).toHaveLength(1);
    await db.deleteOrgSharedResource("org_parent", publication.id);
    expect(
      (
        await runKnowledgeBaseSearch(
          { query: "Published parent", regex: true },
          context
        )
      ).matches.filter((match) => match.scope === "parent")
    ).toEqual([]);
  });
  test("team profile catalogs separate live parent publications from local attachments", async () => {
    const { db, profileService, document, publication, privateDocument } =
      await setupPublishedKnowledge();

    const team = await profileService.createProfile("org_team_a", {
      name: "Reader A",
    });

    const sibling = await profileService.createProfile("org_team_b", {
      name: "Reader B",
    });

    const unrelated = await profileService.createProfile("org_other", {
      name: "Other",
    });

    const local = await profileService.uploadKnowledgeBaseDocument(
      "org_team_a",
      team.profile.id,
      textDocument("Team private bytes")
    );

    const attached =
      await profileService.uploadOrganizationKnowledgeBaseDocument(
        "org_team_a",
        textDocument("Team attached bytes")
      );

    await attachSharedKnowledgeBaseDocument(
      "org_team_a",
      team.profile.id,
      attached.document.id
    );

    const result = await profileService.listKnowledgeBase(
      "org_team_a",
      team.profile.id
    );

    expect(result.documents.map((entry) => entry.id).sort()).toEqual(
      [local.document.id, attached.document.id].sort()
    );
    expect(result.publishedDocuments).toEqual([
      {
        id: document.id,
        filename: document.filename,
        mediaType: document.mediaType,
        sizeBytes: document.sizeBytes,
        status: "ready",
        uploadedAt: document.uploadedAt,
        scope: "parent",
        publicationId: publication.id,
        sourceOrganization: { id: "org_parent", name: "org_parent" },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(privateDocument.id);
    expect(
      (await profileService.listKnowledgeBase("org_team_b", sibling.profile.id))
        .publishedDocuments
    ).toEqual(result.publishedDocuments);
    expect(
      (await profileService.listKnowledgeBase("org_team_b", sibling.profile.id))
        .documents
    ).toEqual([]);
    expect(
      (
        await profileService.listKnowledgeBase(
          "org_other",
          unrelated.profile.id
        )
      ).publishedDocuments
    ).toEqual([]);
    await expect(
      profileService.listKnowledgeBase("org_team_a", sibling.profile.id)
    ).rejects.toMatchObject({ status: 404 });
    await db.deleteOrgSharedResource("org_parent", publication.id);

    const revoked = await profileService.listKnowledgeBase(
      "org_team_a",
      team.profile.id
    );

    expect(revoked.publishedDocuments).toEqual([]);
    expect(revoked.documents).toEqual(result.documents);
    expect(revoked.sources).toEqual(result.sources);
  });

  test("catalogs omit unavailable files and keep unexpected database failures visible", async () => {
    const { db, document, profileService } = await setupPublishedKnowledge();

    const original =
      await profileService.listPublishedKnowledgeBaseDocuments("org_team_a");

    expect(original).toHaveLength(1);
    const lookup = spyOn(db, "getOrgSharedResource");

    try {
      lookup.mockRejectedValueOnce(new Error("database unavailable"));
      await expect(
        profileService.listPublishedKnowledgeBaseDocuments("org_team_a")
      ).rejects.toThrow("database unavailable");
    } finally {
      lookup.mockRestore();
    }

    const dir = getOrgKnowledgeBaseDir("org_parent");
    const manifestPath = getKnowledgeBaseManifestPath(dir);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    const entry = manifest.documents.find(
      (item: { id: string }) => item.id === document.id
    );

    entry.status = "failed";
    entry.error = "/private/source/path";
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect(
      await profileService.listPublishedKnowledgeBaseDocuments("org_team_a")
    ).toEqual([]);
    entry.status = "ready";
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect(
      JSON.stringify(
        await profileService.listPublishedKnowledgeBaseDocuments("org_team_a")
      )
    ).not.toContain("/private/source/path");
    await rm(
      getKnowledgeBaseStoredDocumentPath(dir, document.id, document.filename)
    );
    expect(
      await profileService.listPublishedKnowledgeBaseDocuments("org_team_a")
    ).toEqual([]);
  });

  test("standalone profile responses retain local fields and declare published metadata", async () => {
    const { app, orgId, profileId, session } = await setupSession(
      "platform-kb-catalog@example.com"
    );

    const response = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}/knowledge-base`, {
        headers: session.headers({}, orgId),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      profileId,
      documents: [],
      publishedDocuments: [],
    });

    const spec = await (
      await app.fetch(new Request(`${BASE}/openapi.json`))
    ).json();

    expect(
      spec.components.schemas.ListKnowledgeBaseResponse.properties
        .publishedDocuments.items.properties.scope.enum
    ).toEqual(["parent"]);
  });

  test("members in sibling teams can download and preview published parent bytes without parent membership", async () => {
    const { db, read } = await setupPublishedKnowledge();
    expect(await db.getOrgMember("org_parent", "user_reader")).toBeNull();

    for (const team of ["org_team_a", "org_team_b"]) {
      const downloaded = await read(team);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get("Content-Type")).toBe("text/plain");
      expect(downloaded.headers.get("Content-Disposition")).toBe(
        'attachment; filename="handbook.txt"'
      );
      expect(await downloaded.text()).toBe("Published parent bytes");

      const preview = await read(
        team,
        undefined,
        "?inline=1&render=text&parentOrgId=org_other"
      );

      expect(preview.status).toBe(200);
      expect(preview.headers.get("Content-Disposition")).toBe(
        'inline; filename="handbook.txt"'
      );
      expect(await preview.text()).toBe("Published parent bytes");
    }
  });

  test("publication IDs do not grant private, foreign, or parent tenant access", async () => {
    const { app, db, document, privateDocument, publication, read, session } =
      await setupPublishedKnowledge();

    const now = new Date().toISOString();
    await db.publishOrgSharedResource({
      id: "publication_model",
      orgId: "org_parent",
      resourceId: document.id,
      resourceKind: "model",
      createdAt: now,
      updatedAt: now,
    });

    for (const id of [
      document.id,
      privateDocument.id,
      "publication_other",
      "publication_model",
      "missing",
    ]) {
      expect((await read("org_team_a", id)).status).toBe(404);
    }

    expect((await read("org_other")).status).toBe(404);
    expect(
      (await read("org_parent", publication.id, "", "org_team_a")).status
    ).toBe(404);
    expect((await read("org_parent")).status).toBe(404);

    const parentRead = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/org_parent/knowledge-base/${document.id}/content`,
        { headers: session.headers({}, "org_parent") }
      )
    );

    expect(parentRead.status).toBe(404);

    const anonymous = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/org_team_a/shared-resources/${publication.id}/content`
      )
    );

    expect(anonymous.status).toBe(401);
  });

  test("parent admins read published documents in parent context with live publication checks", async () => {
    const { db, document, privateDocument, publication, read } =
      await setupPublishedKnowledge();

    await db.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId: "org_parent",
      role: "admin",
      userId: "user_reader",
    });

    for (const query of ["", "?render=text"]) {
      const response = await read("org_parent", publication.id, query);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/plain");
      expect(await response.text()).toBe("Published parent bytes");

      for (const id of [document.id, privateDocument.id, "publication_other"]) {
        expect((await read("org_parent", id, query)).status).toBe(404);
      }

      expect(
        (await read("org_parent", publication.id, query, "org_team_a")).status
      ).toBe(404);
    }

    await db.deleteOrgSharedResource("org_parent", publication.id);
    expect((await read("org_parent")).status).toBe(404);
    expect(
      (await read("org_parent", publication.id, "?render=text")).status
    ).toBe(404);
  });

  test("new reads fail after revocation, source removal, or archive", async () => {
    const { db, document, publication, profileService, read } =
      await setupPublishedKnowledge();

    expect((await read()).status).toBe(200);
    await db.deleteOrgSharedResource("org_parent", publication.id);
    expect((await read()).status).toBe(404);
    expect(
      await profileService.listPublishedKnowledgeBaseDocuments("org_team_a")
    ).toEqual([]);
    await db.publishOrgSharedResource(publication);
    const team = await db.getOrganizationById("org_team_a");
    const sibling = await db.getOrganizationById("org_team_b");
    await db.upsertOrganization({
      ...team!,
      archivedAt: new Date().toISOString(),
    });
    expect((await read()).status).toBe(404);
    await db.upsertOrganization({
      ...sibling!,
      archivedAt: new Date().toISOString(),
    });
    const parent = await db.getOrganizationById("org_parent");
    await db.upsertOrganization({
      ...parent!,
      archivedAt: new Date().toISOString(),
    });
    expect((await read()).status).toBe(404);
    await expect(
      profileService.readPublishedKnowledgeBaseDocument(
        "org_parent",
        publication.id
      )
    ).rejects.toMatchObject({ status: 404 });
    await db.upsertOrganization({ ...parent!, archivedAt: null });
    await db.upsertOrganization({ ...team!, archivedAt: null });
    await db.upsertOrganization({ ...sibling!, archivedAt: null });
    await profileService.deleteOrganizationKnowledgeBaseDocument(
      "org_parent",
      document.id
    );
    expect((await read()).status).toBe(404);
  });

  test("failed documents and missing originals cannot use cached extracted text", async () => {
    const { document, read } = await setupPublishedKnowledge();
    const dir = getOrgKnowledgeBaseDir("org_parent");
    const manifestPath = getKnowledgeBaseManifestPath(dir);
    const original = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(original);
    manifest.documents.find(
      (entry: { id: string }) => entry.id === document.id
    ).status = "failed";
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect((await read()).status).toBe(404);
    await writeFile(manifestPath, original);
    await rm(
      getKnowledgeBaseStoredDocumentPath(dir, document.id, document.filename)
    );
    expect((await read()).status).toBe(404);
    expect((await read("org_team_a", undefined, "?render=text")).status).toBe(
      404
    );
  });

  test.each(["stored", "extracted", "manifest", "directory"])(
    "rejects a %s symlink outside the source directory",
    async (kind) => {
      const { document, read, profileService } =
        await setupPublishedKnowledge();

      const dir = getOrgKnowledgeBaseDir("org_parent");
      const privateDir = getOrgKnowledgeBaseDir("org_other");
      const secretPath = `${privateDir}/secret.txt`;
      await mkdir(privateDir, { recursive: true });
      await writeFile(secretPath, "Sibling secret");

      const path =
        kind === "stored"
          ? getKnowledgeBaseStoredDocumentPath(
              dir,
              document.id,
              document.filename
            )
          : kind === "extracted"
            ? getKnowledgeBaseExtractedPath(dir, document.id)
            : kind === "manifest"
              ? getKnowledgeBaseManifestPath(dir)
              : dir;

      await rm(path, { recursive: kind === "directory", force: true });
      await symlink(kind === "directory" ? privateDir : secretPath, path);
      const response = await read("org_team_a", undefined, "?render=text");
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Sibling secret");
      expect(
        await profileService.listPublishedKnowledgeBaseDocuments("org_team_a")
      ).toEqual([]);
    }
  );
});

async function setupSession(email: string) {
  const { app, authService, databaseAdapter } = createApp();
  const session = await setupFreshInstallSession(app, databaseAdapter, email);
  const orgId = session.orgId!;
  const profiles = await databaseAdapter.listProfilesForOrg(orgId);
  const profile = profiles.find((entry) => !entry.isSuper)!;

  const headers = {
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  };

  const post = (path: string, body: string) =>
    app.fetch(
      new Request(`${BASE}${path}`, {
        body,
        headers: session.headers(headers, orgId),
        method: "POST",
      })
    );

  return {
    app,
    authService,
    databaseAdapter,
    orgId,
    post,
    profileId: profile.id,
    session,
  };
}

describe("organization knowledge base routes", () => {
  test("catalog permits tenant admins and checks both tenant membership and path scope", async () => {
    const { app, authService, databaseAdapter, profileService } = createApp();

    const admin = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "knowledge-catalog-admin@example.com",
      orgId: "knowledge-catalog-parent",
    });

    const session = await loginUserSession(
      app,
      admin.email,
      admin.password,
      admin.orgId
    );

    const now = new Date().toISOString();
    const documentIds = new Map<string, string>();

    for (const orgId of [
      admin.orgId,
      "knowledge-catalog-team",
      "knowledge-catalog-sibling",
      "knowledge-catalog-other",
    ]) {
      if (orgId !== admin.orgId) {
        await databaseAdapter.upsertOrganization({
          createdAt: now,
          id: orgId,
          name: orgId,
          parentOrgId: orgId === "knowledge-catalog-other" ? null : admin.orgId,
          slug: orgId,
          updatedAt: now,
        });
      }

      const { document } =
        await profileService.uploadOrganizationKnowledgeBaseDocument(
          orgId,
          textDocument(`Private handbook for ${orgId}`)
        );

      documentIds.set(orgId, document.id);
    }

    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: "knowledge-catalog-team",
      role: "admin",
      userId: admin.userId,
    });

    for (const orgId of [admin.orgId, "knowledge-catalog-team"]) {
      const response = await app.fetch(
        new Request(`${BASE}/v1/orgs/${orgId}/knowledge-base`, {
          headers: session.headers({}, orgId),
        })
      );

      expect(response.status).toBe(200);

      const result: Awaited<
        ReturnType<ProfileService["listOrganizationKnowledgeBase"]>
      > = await response.json();

      expect(result.documents.map((document) => document.id)).toEqual([
        documentIds.get(orgId)!,
      ]);
    }

    for (const orgId of [
      admin.orgId,
      "knowledge-catalog-sibling",
      "knowledge-catalog-other",
    ]) {
      const response = await app.fetch(
        new Request(`${BASE}/v1/orgs/${orgId}/knowledge-base`, {
          headers: session.headers({}, "knowledge-catalog-team"),
        })
      );

      expect(response.status).toBe(404);
    }

    for (const orgId of [
      "knowledge-catalog-sibling",
      "knowledge-catalog-other",
    ]) {
      const response = await app.fetch(
        new Request(`${BASE}/v1/orgs/${orgId}/knowledge-base`, {
          headers: session.headers({}, orgId),
        })
      );

      expect(response.status).toBe(404);
    }

    for (const role of ["member"] as const) {
      await databaseAdapter.upsertOrgMember({
        createdAt: now,
        orgId: admin.orgId,
        role,
        userId: admin.userId,
      });

      const response = await app.fetch(
        new Request(`${BASE}/v1/orgs/${admin.orgId}/knowledge-base`, {
          headers: session.headers({}, admin.orgId),
        })
      );

      expect(response.status).toBe(403);
    }
  });

  test("upload validation and duplicate handling match the profile route", async () => {
    const { orgId, post } = await setupSession("platform-kb-1@example.com");
    const path = `/v1/orgs/${orgId}/knowledge-base`;

    const created = await post(
      path,
      JSON.stringify({ document: textDocument("Shared handbook body") })
    );

    expect(created.status).toBe(201);

    // SAFETY: This test controls the fixture shape at this boundary.
    const { document } = (await created.json()) as {
      document: { id: string; scope: string };
    };

    expect(document.scope).toBe("organization");

    const duplicate = await post(
      path,
      JSON.stringify({ document: textDocument("Shared handbook body") })
    );

    expect(duplicate.status).toBe(409);

    const unsupported = await post(
      path,
      JSON.stringify({
        document: {
          data: Buffer.from("zip", "utf8").toString("base64"),
          filename: "archive.zip",
          mediaType: "application/zip",
        },
      })
    );

    expect(unsupported.status).toBe(400);

    const missing = await post(path, "{}");
    expect(missing.status).toBe(400);
  }, 20_000);

  test("delete reports the profiles that still reference a shared document", async () => {
    const { app, orgId, post, profileId, session } = await setupSession(
      "platform-kb-2@example.com"
    );

    const path = `/v1/orgs/${orgId}/knowledge-base`;

    const created = await post(
      path,
      JSON.stringify({ document: textDocument("Attached handbook body") })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const { document } = (await created.json()) as {
      document: { id: string };
    };

    await attachSharedKnowledgeBaseDocument(orgId, profileId, document.id);

    const inUse = await app.fetch(
      new Request(`${BASE}${path}/${document.id}`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }, orgId),
        method: "DELETE",
      })
    );

    expect(inUse.status).toBe(409);
    expect(await inUse.json()).toMatchObject({ profileIds: [profileId] });

    await app.fetch(
      new Request(
        `${BASE}/v1/profiles/${profileId}/knowledge-base/shared/${document.id}`,
        {
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          method: "DELETE",
        }
      )
    );

    const removed = await app.fetch(
      new Request(`${BASE}${path}/${document.id}`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }, orgId),
        method: "DELETE",
      })
    );

    expect(removed.status).toBe(200);

    const missing = await app.fetch(
      new Request(`${BASE}${path}/kb_missing`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }, orgId),
        method: "DELETE",
      })
    );

    expect(missing.status).toBe(404);
  }, 20_000);

  test("replacing an attached shared document is a conflict", async () => {
    const { orgId, post, profileId } = await setupSession(
      "platform-kb-3@example.com"
    );

    const path = `/v1/orgs/${orgId}/knowledge-base`;

    const created = await post(
      path,
      JSON.stringify({ document: textDocument("Replaced handbook body") })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const { document } = (await created.json()) as {
      document: { id: string };
    };

    await attachSharedKnowledgeBaseDocument(orgId, profileId, document.id);

    const replacement = await post(
      path,
      JSON.stringify({
        document: textDocument("Replaced handbook body"),
        onDuplicate: "replace",
      })
    );

    expect(replacement.status).toBe(409);
  }, 20_000);

  test("content preview of an unknown document is not a server error", async () => {
    const { app, orgId, session } = await setupSession(
      "platform-kb-4@example.com"
    );

    const response = await app.fetch(
      new Request(
        `${BASE}/v1/orgs/${orgId}/knowledge-base/kb_missing/content?render=text`,
        { headers: session.headers({}, orgId) }
      )
    );

    expect(response.status).toBe(404);
  }, 20_000);

  test("shared organization knowledge base management stays platform-admin only", async () => {
    const { app, authService, databaseAdapter } = createApp();

    const { adminSession, orgId } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-org-kb-guard",
      "org-admin-kb@acme.com"
    );

    const headers = adminSession.headers(
      {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminSession.csrfToken,
      },
      orgId
    );

    const requests: Array<[string, string]> = [
      [`/v1/orgs/${orgId}/knowledge-base`, "POST"],
      [`/v1/orgs/${orgId}/knowledge-base/kb_1`, "DELETE"],
      [`/v1/orgs/${orgId}/knowledge-base/kb_1/content`, "GET"],
      ["/v1/profiles/profile_1/knowledge-base/shared/kb_1", "PUT"],
      ["/v1/profiles/profile_1/knowledge-base/shared/kb_1", "DELETE"],
    ];

    for (const [path, method] of requests) {
      const response = await app.fetch(
        new Request(`${BASE}${path}`, {
          body: method === "POST" ? "{}" : undefined,
          headers,
          method,
        })
      );

      expect([method, path, response.status]).toEqual([method, path, 403]);
    }
  }, 30_000);

  test("openapi documents the organization knowledge base routes", async () => {
    const { app } = createApp();
    const response = await app.fetch(new Request(`${BASE}/openapi.json`));
    expect(response.status).toBe(200);

    const spec: ReturnType<typeof app.getOpenAPI31Document> =
      await response.json();

    const expected = [
      ["/v1/orgs/{orgId}/knowledge-base", ["get", "post"]],
      ["/v1/orgs/{orgId}/knowledge-base/{documentId}", ["delete"]],
      ["/v1/orgs/{orgId}/knowledge-base/{documentId}/content", ["get"]],
      ["/v1/orgs/{orgId}/shared-resources/{publicationId}/content", ["get"]],
      [
        "/v1/profiles/{profileId}/knowledge-base/shared/{documentId}",
        ["put", "delete"],
      ],
    ] as const;

    for (const [path, methods] of expected) {
      for (const method of methods) {
        expect([method, path, Boolean(spec.paths?.[path]?.[method])]).toEqual([
          method,
          path,
          true,
        ]);
      }
    }
  }, 20_000);
});
