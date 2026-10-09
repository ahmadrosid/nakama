import { describe, expect, spyOn, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  attachSharedKnowledgeBaseDocument,
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
} from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { zipSync } from "fflate";
import { MemoryBackendService } from "../../services/memory-backend-service";
import { ProfileService } from "../../services/profile-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  createOrgAdminSession,
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

    // SAFETY: This test controls the fixture shape at this boundary.
    const spec = (await response.json()) as {
      paths: Record<string, { get?: object; post?: object; put?: object }>;
    };

    expect(
      spec.paths["/v1/profiles/{profileId}/knowledge-base/import-zip"]?.post
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
  };
}

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
      [`/v1/orgs/${orgId}/knowledge-base`, "GET"],
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

    // SAFETY: This test controls the fixture shape at this boundary.
    const spec = (await response.json()) as {
      paths: Record<string, { get?: object; post?: object; put?: object }>;
    };

    const expected: Array<[string, string[]]> = [
      ["/v1/orgs/{orgId}/knowledge-base", ["get", "post"]],
      ["/v1/orgs/{orgId}/knowledge-base/{documentId}", ["delete"]],
      ["/v1/orgs/{orgId}/knowledge-base/{documentId}/content", ["get"]],
      [
        "/v1/profiles/{profileId}/knowledge-base/shared/{documentId}",
        ["put", "delete"],
      ],
    ];

    for (const [path, methods] of expected) {
      for (const method of methods) {
        expect([method, path, Boolean(spec.paths[path]?.[method])]).toEqual([
          method,
          path,
          true,
        ]);
      }
    }
  }, 20_000);
});
