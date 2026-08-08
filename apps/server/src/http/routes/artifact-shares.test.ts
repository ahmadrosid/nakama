import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProfileArtifactsDir } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createHonoApp } from "../app";
import { isPublicRouteRequest } from "../public-routes";
import { setupFreshInstallSession } from "../test-session-helpers";

setupTestConfigDir("nakama-artifact-shares-test-");

function createApp(databaseAdapter = createInMemoryDatabaseAdapter()) {
  const authService = new AuthService();
  return {
    app: createHonoApp({
      agent: {} as never,
      authService,
      automationService: {} as never,
      databaseAdapter,
      mcpService: {} as never,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as never,
      taskService: {} as never,
      webDistDir: null,
      workerManager: {} as never,
    }),
    authService,
    databaseAdapter,
  };
}

describe("artifact share routes", () => {
  test("public artifact share GET is allowlisted", () => {
    expect(
      isPublicRouteRequest("GET", "/v1/public/artifact-shares/abc123")
    ).toBe(true);
    expect(
      isPublicRouteRequest("POST", "/v1/public/artifact-shares/abc123")
    ).toBe(false);
  });

  test("member can publish and anonymous visitor can read snapshot", async () => {
    const { app, databaseAdapter, authService } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_test";
    const now = new Date().toISOString();

    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: profileId,
      isSuper: false,
      model: "openrouter/auto",
      name: "Share Test",
      orgId,
      systemPrompt: "test",
      updatedAt: now,
    });

    const artifactsDir = getProfileArtifactsDir(orgId, profileId);
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, "report.md"), "# Shared report", "utf8");

    const publishResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${profileId}/artifacts/shares`,
        {
          body: JSON.stringify({ path: "report.md" }),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as {
      id: string;
      token: string;
    };
    expect(published.token.length).toBeGreaterThan(20);

    const publicResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}`
      )
    );

    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.text()).toBe("# Shared report");

    const revokeResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${profileId}/artifacts/shares/${published.id}`,
        {
          headers: session.headers(
            {
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          method: "DELETE",
        }
      )
    );

    expect(revokeResponse.status).toBe(200);

    const afterRevoke = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}`
      )
    );
    expect(afterRevoke.status).toBe(404);
    void authService;
  });

  test("public video share resolves octet-stream to video/mp4 for inline playback", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_video";
    const now = new Date().toISOString();

    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: profileId,
      isSuper: false,
      model: "openrouter/auto",
      name: "Share Video",
      orgId,
      systemPrompt: "test",
      updatedAt: now,
    });

    const artifactsDir = getProfileArtifactsDir(orgId, profileId);
    await mkdir(artifactsDir, { recursive: true });
    // Minimal bytes; MIME comes from filename when sidecar is missing/generic.
    await writeFile(join(artifactsDir, "clip.mp4"), "fake-mp4-bytes");
    await writeFile(
      join(artifactsDir, "clip.mp4.nakama-meta.json"),
      JSON.stringify({
        mimeType: "application/octet-stream",
        savedAt: now,
        sizeBytes: 13,
      })
    );

    const publishResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${profileId}/artifacts/shares`,
        {
          body: JSON.stringify({ path: "clip.mp4" }),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as { token: string };

    const metaResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}?meta=1`
      )
    );
    expect(metaResponse.status).toBe(200);
    const meta = (await metaResponse.json()) as {
      mimeType: string;
      inlineAllowed: boolean;
      filename: string;
    };
    expect(meta.filename).toBe("clip.mp4");
    expect(meta.mimeType).toBe("video/mp4");
    expect(meta.inlineAllowed).toBe(true);

    const publicResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}`
      )
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("Content-Type")).toBe("video/mp4");
    expect(publicResponse.headers.get("Content-Disposition")).toContain(
      "inline"
    );
  });
});
