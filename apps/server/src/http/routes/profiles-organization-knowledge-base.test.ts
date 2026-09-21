import { describe, expect, test } from "bun:test";
import { attachSharedKnowledgeBaseDocument } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
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

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
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
        uploadOrganizationKnowledgeBaseDocument: (
          orgId: string,
          document: unknown,
          onDuplicate?: "error" | "replace" | "skip"
        ) =>
          profileService.uploadOrganizationKnowledgeBaseDocument(
            orgId,
            document as Parameters<
              ProfileService["uploadOrganizationKnowledgeBaseDocument"]
            >[1],
            onDuplicate
          ),
      },
      databaseAdapter,
    }),
    databaseAdapter,
  };
}

async function setupSession(email: string) {
  const { app, databaseAdapter } = createApp();
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
  return { app, orgId, post, profileId: profile.id, session };
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

    const spec = (await response.json()) as {
      paths: Record<string, Record<string, unknown>>;
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
