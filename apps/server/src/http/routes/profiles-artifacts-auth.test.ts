import { describe, expect, test } from "bun:test";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProfileSoulDir, NakamaApiError } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  createOrgAdminSession,
  loginPlatformAdminSession,
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profiles-artifacts-auth-test-");

test("workspace rename requires platform admin access and updates pins for every user only in this profile", async () => {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({
    databaseAdapter,
    agent: {
      getProfile: async (orgId: string, profileId: string) => {
        const profile = await databaseAdapter.getProfile(profileId);
        if (!profile || profile.orgId !== orgId) {
          throw new NakamaApiError("Not found", 404);
        }
        return profile;
      },
    },
  });
  const owner = await setupFreshInstallSession(
    app,
    databaseAdapter,
    "rename@example.com"
  );
  const other = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter,
    "rename-other@example.com"
  );
  const ownerUser = (await databaseAdapter.getUserByEmail(
    "rename@example.com"
  ))!;
  const otherUser = (await databaseAdapter.getUserByEmail(
    "rename-other@example.com"
  ))!;
  const now = new Date().toISOString();
  await databaseAdapter.upsertOrganization({
    id: "rename-foreign-org",
    name: "Foreign",
    slug: "rename-foreign-org",
    createdAt: now,
    updatedAt: now,
  });
  for (const [id, orgId] of [
    ["rename-profile", owner.orgId!],
    ["rename-other-profile", owner.orgId!],
    ["rename-foreign-profile", "rename-foreign-org"],
  ]) {
    await databaseAdapter.upsertProfile({
      id: id!,
      orgId,
      name: id!,
      isSuper: false,
      model: null,
      systemPrompt: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  const root = getProfileSoulDir(owner.orgId!, "rename-profile");
  await mkdir(path.join(root, "notes_%/nested"), { recursive: true });
  await writeFile(path.join(root, "notes_%/nested/report.md"), "report");
  for (const user of [ownerUser, otherUser]) {
    await databaseAdapter.setFilePinned(
      owner.orgId!,
      user.id,
      "rename-profile",
      "notes_%",
      true
    );
    await databaseAdapter.setFilePinned(
      owner.orgId!,
      user.id,
      "rename-profile",
      "notes_%/nested/report.md",
      true
    );
    await databaseAdapter.setFilePinned(
      owner.orgId!,
      user.id,
      "rename-profile",
      "notes_%suffix/file.md",
      true
    );
  }
  await databaseAdapter.setFilePinned(
    owner.orgId!,
    ownerUser.id,
    "rename-other-profile",
    "notes_%",
    true
  );
  const request = (
    body: unknown,
    session = owner,
    profile = "rename-profile"
  ) =>
    app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${profile}/workspace/rename`,
        {
          method: "PATCH",
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            session.orgId
          ),
          body: JSON.stringify(body),
        }
      )
    );
  const renamed = await request({ path: "notes_%", newName: "drafts" });
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toMatchObject({
    path: "drafts",
    filename: "drafts",
    kind: "directory",
  });
  for (const user of [ownerUser, otherUser]) {
    expect(
      await databaseAdapter.listFilePins(
        owner.orgId!,
        user.id,
        "rename-profile"
      )
    ).toEqual(["drafts", "drafts/nested/report.md", "notes_%suffix/file.md"]);
  }
  expect(
    await databaseAdapter.listFilePins(
      owner.orgId!,
      ownerUser.id,
      "rename-other-profile"
    )
  ).toEqual(["notes_%"]);
  expect(
    (await request({ path: "drafts/nested/report.md", newName: "summary.md" }))
      .status
  ).toBe(200);
  expect(
    await databaseAdapter.listFilePins(
      owner.orgId!,
      ownerUser.id,
      "rename-profile"
    )
  ).toContain("drafts/nested/summary.md");
  expect((await request({ path: "drafts", newName: "../escape" })).status).toBe(
    400
  );
  expect(
    (await request({ path: "SOUL.md", newName: "renamed.md" })).status
  ).toBe(400);
  expect(
    (
      await request(
        { path: "drafts", newName: "other" },
        owner,
        "rename-foreign-profile"
      )
    ).status
  ).toBe(404);
  expect(
    (await request({ path: "drafts", newName: "other" }, other)).status
  ).toBe(400);
  expect((await request({ path: "missing", newName: "other" })).status).toBe(
    404
  );
  await writeFile(path.join(root, "existing"), "keep");
  expect((await request({ path: "drafts", newName: "existing" })).status).toBe(
    409
  );
  await databaseAdapter.createUser({
    id: "rename-member",
    email: "rename-member@example.com",
    passwordHash: await authService.hashPassword("password123"),
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    orgId: owner.orgId!,
    userId: "rename-member",
    role: "admin",
    createdAt: now,
  });
  const member = await loginUserSession(
    app,
    "rename-member@example.com",
    "password123",
    owner.orgId
  );
  expect(
    (await request({ path: "drafts", newName: "other" }, member)).status
  ).toBe(403);
  expect(
    (
      await app.fetch(
        new Request(
          "http://localhost:4310/v1/profiles/rename-profile/workspace/rename",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "drafts", newName: "other" }),
          }
        )
      )
    ).status
  ).toBe(401);
});

function createApp() {
  const readCalls: Array<{ render?: "markdown" }> = [];
  const writeCalls: Array<{ content: string; filename: string }> = [];
  const agent = {
    getProfile: async (_orgId: string, profileId: string) => {
      if (profileId !== "profile_1") {
        throw new NakamaApiError("Not found", 404);
      }
      return { profileId };
    },
    deleteProfileArtifact: async () => ({
      deleted: true,
      filename: "report.md",
      profileId: "profile_1",
    }),
    listProfileArtifacts: async () => ({
      artifacts: [],
      directory: "/tmp/artifacts",
      profileId: "profile_1",
      total: 0,
    }),
    readProfileArtifact: async (
      _orgId: string,
      _profileId: string,
      _filename: string,
      options: { render?: "markdown" } = {}
    ) => {
      readCalls.push(options);
      return {
        bytes: new TextEncoder().encode("# Report"),
        contentType: "text/markdown",
      };
    },
    writeProfileArtifact: async (
      _orgId: string,
      profileId: string,
      filename: string,
      content: string
    ) => {
      writeCalls.push({ content, filename });
      return {
        filename,
        profileId,
        sizeBytes: content.length,
        updatedAt: "2026-08-18T00:00:00.000Z",
      };
    },
  };

  return {
    ...createMinimalHonoApp({ agent }),
    readCalls,
    writeCalls,
  };
}

describe("profile artifact content auth", () => {
  test("org member can read artifact content", async () => {
    const { app, databaseAdapter } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "member@example.com",
      "member"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md&inline=1",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(await response.text()).toBe("# Report");
  });

  test("serves artifact content with a Unicode filename", async () => {
    const { app, databaseAdapter } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "unicode@example.com",
      "member"
    );
    const filename = "Pastry Box Claims Review — Synthetic Demo.md";
    const url = new URL(
      "http://localhost:4310/v1/profiles/profile_1/artifacts/content"
    );
    url.searchParams.set("path", filename);
    url.searchParams.set("inline", "1");

    const response = await app.fetch(
      new Request(url, {
        headers: memberSession.headers({}, memberSession.orgId),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
  });

  test("org viewer can read artifact content", async () => {
    const { app, databaseAdapter } = createApp();
    const viewerSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "viewer@example.com",
      "viewer"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md",
        {
          headers: viewerSession.headers({}, viewerSession.orgId),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("forwards render=markdown so a .docx is converted for preview", async () => {
    const { app, databaseAdapter, readCalls } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "render@example.com",
      "member"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=laporan.docx&inline=1&render=markdown",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(readCalls.at(-1)?.render).toBe("markdown");
  });

  test("serves raw bytes when render is not requested", async () => {
    const { app, databaseAdapter, readCalls } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "raw@example.com",
      "member"
    );

    await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=laporan.docx",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        }
      )
    );

    expect(readCalls.at(-1)?.render).toBeUndefined();
  });

  test("org member cannot list artifacts", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-artifact-member",
      "admin-artifact-member@acme.com"
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member-artifact@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
        }),
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

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as {
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member-artifact@acme.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts", {
        headers: memberSession.headers({}, orgId),
      })
    );

    expect(response.status).toBe(403);
    for (const endpoint of ["workspace", "workspace/content?path=SOUL.md"]) {
      const workspaceResponse = await app.fetch(
        new Request(`http://localhost:4310/v1/profiles/profile_1/${endpoint}`, {
          headers: memberSession.headers({}, orgId),
        })
      );
      expect(workspaceResponse.status).toBe(403);
    }
  });

  test("platform admin can still list artifacts", async () => {
    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts", {
        headers: adminSession.headers({}, adminSession.orgId),
      })
    );

    expect(response.status).toBe(200);
  });
});

describe("profile artifact write auth", () => {
  test("org member can save artifact content", async () => {
    const { app, databaseAdapter, writeCalls } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "writer@example.com",
      "member"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md",
        {
          body: JSON.stringify({ content: "# Report\n\nEdited by hand.\n" }),
          headers: memberSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": memberSession.csrfToken,
            },
            memberSession.orgId
          ),
          method: "PUT",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(writeCalls.at(-1)).toEqual({
      content: "# Report\n\nEdited by hand.\n",
      filename: "report.md",
    });
  });

  test("org viewer cannot save artifact content", async () => {
    const { app, databaseAdapter, writeCalls } = createApp();
    const viewerSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "viewer-write@example.com",
      "viewer"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md",
        {
          body: JSON.stringify({ content: "# Overwritten\n" }),
          headers: viewerSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": viewerSession.csrfToken,
            },
            viewerSession.orgId
          ),
          method: "PUT",
        }
      )
    );

    expect(response.status).toBe(403);
    expect(writeCalls).toHaveLength(0);
  });

  test("rejects a save with no path", async () => {
    const { app, databaseAdapter, writeCalls } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "nopath@example.com",
      "member"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content",
        {
          body: JSON.stringify({ content: "# Report\n" }),
          headers: memberSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": memberSession.csrfToken,
            },
            memberSession.orgId
          ),
          method: "PUT",
        }
      )
    );

    expect(response.status).toBe(400);
    expect(writeCalls).toHaveLength(0);
  });
});

test("workspace routes enforce profile access and serve read-only files", async () => {
  const { app, databaseAdapter } = createApp();
  const session = await setupFreshInstallSession(app, databaseAdapter);
  const root = getProfileSoulDir(session.orgId, "profile_1");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "SOUL.md"), "# Private soul");
  const request = (suffix: string, profile = "profile_1") =>
    app.fetch(
      new Request(`http://localhost:4310/v1/profiles/${profile}/${suffix}`, {
        headers: session.headers({}, session.orgId),
      })
    );
  const listing = await request("workspace");
  expect(listing.status).toBe(200);
  expect(
    (await listing.json()).entries.some(
      (entry: { filename: string }) => entry.filename === "SOUL.md"
    )
  ).toBe(true);
  const content = await request("workspace/content?path=SOUL.md");
  expect(content.status).toBe(200);
  expect(content.headers.get("Content-Disposition")).toContain("attachment");
  expect(content.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await content.text()).toBe("# Private soul");
  expect((await request("workspace", "other_profile")).status).toBe(404);
  expect(
    (await request("workspace/content?path=SOUL.md", "other_profile")).status
  ).toBe(404);
  expect((await request("workspace/content?path=../SOUL.md")).status).toBe(400);
  expect((await request("workspace/content")).status).toBe(400);
  expect(
    (
      await app.fetch(
        new Request("http://localhost:4310/v1/profiles/profile_1/workspace")
      )
    ).status
  ).toBe(401);
});

test("personal file pins persist and enforce user, org, profile and path boundaries", async () => {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const { app, authService } = createMinimalHonoApp({
    databaseAdapter,
    agent: {
      getProfile: async (orgId: string, profileId: string) => {
        const profile = await databaseAdapter.getProfile(profileId);
        if (!profile || profile.orgId !== orgId) {
          throw new NakamaApiError("Not found", 404);
        }
        return profile;
      },
    },
  });
  const owner = await setupFreshInstallSession(
    app,
    databaseAdapter,
    "pins@example.com"
  );
  const other = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter,
    "other-pins@example.com"
  );
  const now = new Date().toISOString();
  const otherUser = await databaseAdapter.getUserByEmail(
    "other-pins@example.com"
  );
  await databaseAdapter.upsertOrgMember({
    orgId: owner.orgId!,
    userId: otherUser!.id,
    role: "admin",
    createdAt: now,
  });
  for (const id of ["pins-profile", "other-pins-profile"]) {
    await databaseAdapter.upsertProfile({
      id,
      orgId: owner.orgId,
      name: id,
      isSuper: false,
      model: null,
      systemPrompt: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  const root = getProfileSoulDir(owner.orgId!, "pins-profile");
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  await writeFile(path.join(root, "artifacts/report.md"), "Report");
  await symlink("/etc/passwd", path.join(root, "outside"));
  const request = (
    session = owner,
    body?: unknown,
    profile = "pins-profile",
    orgId = owner.orgId
  ) =>
    app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${profile}/workspace/pins`,
        {
          method: body ? "PUT" : "GET",
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          ...(body ? { body: JSON.stringify(body) } : {}),
        }
      )
    );
  expect(
    (await request(owner, { path: "artifacts/report.md", pinned: true })).status
  ).toBe(204);
  expect(
    (await request(owner, { path: "artifacts/report.md", pinned: true })).status
  ).toBe(204);
  const pins = await (await request()).json();
  expect(pins.entries).toHaveLength(1);
  expect(pins.entries[0]).toMatchObject({
    path: "artifacts/report.md",
    kind: "file",
    sizeBytes: 6,
  });
  const anotherDevice = await loginUserSession(
    app,
    "pins@example.com",
    "password123",
    owner.orgId
  );
  expect((await (await request(anotherDevice)).json()).entries).toHaveLength(1);
  expect((await (await request(other)).json()).entries).toEqual([]);
  expect(
    (await request(other, { path: "artifacts/report.md", pinned: false }))
      .status
  ).toBe(204);
  expect((await (await request()).json()).entries).toHaveLength(1);
  expect(
    (await (await request(owner, undefined, "other-pins-profile")).json())
      .entries
  ).toEqual([]);
  await databaseAdapter.upsertOrganization({
    id: "pins-other-org",
    name: "Other",
    slug: "pins-other-org",
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    orgId: "pins-other-org",
    userId: (await databaseAdapter.getUserByEmail("pins@example.com"))!.id,
    role: "admin",
    createdAt: now,
  });
  expect(
    (await request(owner, undefined, "pins-profile", "pins-other-org")).status
  ).toBe(404);
  for (const filename of [
    "../secret",
    "/etc/passwd",
    "artifacts/../report.md",
    "outside",
  ]) {
    expect(
      (await request(owner, { path: filename, pinned: true })).status
    ).toBe(400);
  }
  expect(
    (await request(owner, { path: "artifacts", pinned: true })).status
  ).toBe(204);
  expect((await (await request()).json()).entries).toContainEqual(
    expect.objectContaining({ path: "artifacts", kind: "directory" })
  );
  expect(
    (
      await app.fetch(
        new Request(
          "http://localhost:4310/v1/profiles/pins-profile/workspace/content?path=artifacts",
          { headers: owner.headers({}, owner.orgId) }
        )
      )
    ).status
  ).toBe(404);
  expect(
    (await request(owner, { path: "artifacts", pinned: false })).status
  ).toBe(204);
  expect(
    (await request(owner, { path: "missing.txt", pinned: true })).status
  ).toBe(404);
  expect(
    (await request(owner, { path: "artifacts/report.md", pinned: "yes" }))
      .status
  ).toBe(400);
  await unlink(path.join(root, "artifacts/report.md"));
  expect((await (await request()).json()).entries).toEqual([]);
  expect(
    (await request(owner, { path: "artifacts/report.md", pinned: false }))
      .status
  ).toBe(204);
  const user = await databaseAdapter.getUserByEmail("pins@example.com");
  expect(
    await databaseAdapter.listFilePins(owner.orgId!, user!.id, "pins-profile")
  ).toEqual([]);
  expect(
    (
      await app.fetch(
        new Request(
          "http://localhost:4310/v1/profiles/pins-profile/workspace/pins"
        )
      )
    ).status
  ).toBe(401);
  await databaseAdapter.createUser({
    id: "pins-member",
    email: "pins-member@example.com",
    passwordHash: await authService.hashPassword("password123"),
    createdAt: now,
    updatedAt: now,
  });
  await databaseAdapter.upsertOrgMember({
    orgId: owner.orgId!,
    userId: "pins-member",
    role: "member",
    createdAt: now,
  });
  const member = await loginUserSession(
    app,
    "pins-member@example.com",
    "password123",
    owner.orgId
  );
  expect((await request(member)).status).toBe(403);
  expect(
    (await request(member, { path: "anything", pinned: true })).status
  ).toBe(403);
});
