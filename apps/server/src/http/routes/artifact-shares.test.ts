import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProfileArtifactsDir } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createHonoApp } from "../app";
import { isPublicRouteRequest } from "../public-routes";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { setupFreshInstallSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-artifact-shares-test-");

function createApp(databaseAdapter = createInMemoryDatabaseAdapter()) {
  const authService = new AuthService();
  return {
    databaseAdapter,
    authService,
    app: createHonoApp({
      agent: {} as never,
      automationService: {} as never,
      taskService: {} as never,
      systemStatus: { getStatus: async () => ({ ok: true }) } as never,
      workerManager: {} as never,
      mcpService: {} as never,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

describe("artifact share routes", () => {
  test("public artifact share GET is allowlisted", () => {
    expect(isPublicRouteRequest("GET", "/v1/public/artifact-shares/abc123")).toBe(true);
    expect(isPublicRouteRequest("POST", "/v1/public/artifact-shares/abc123")).toBe(false);
  });

  test("member can publish and anonymous visitor can read snapshot", async () => {
    const { app, databaseAdapter, authService } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_test";
    const now = new Date().toISOString();

    await databaseAdapter.upsertProfile({
      id: profileId,
      orgId,
      name: "Share Test",
      systemPrompt: "test",
      model: "openrouter/auto",
      isSuper: false,
      createdAt: now,
      updatedAt: now,
    });

    const artifactsDir = getProfileArtifactsDir(orgId, profileId);
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, "report.md"), "# Shared report", "utf8");

    const publishResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/profiles/${profileId}/artifacts/shares`, {
        method: "POST",
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          orgId,
        ),
        body: JSON.stringify({ path: "report.md" }),
      }),
    );

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as {
      id: string;
      token: string;
    };
    expect(published.token.length).toBeGreaterThan(20);

    const publicResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}`,
      ),
    );

    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.text()).toBe("# Shared report");

    const revokeResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/${profileId}/artifacts/shares/${published.id}`,
        {
          method: "DELETE",
          headers: session.headers(
            {
              "X-CSRF-Token": session.csrfToken,
            },
            orgId,
          ),
        },
      ),
    );

    expect(revokeResponse.status).toBe(200);

    const afterRevoke = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}`,
      ),
    );
    expect(afterRevoke.status).toBe(404);
    void authService;
  });
});
