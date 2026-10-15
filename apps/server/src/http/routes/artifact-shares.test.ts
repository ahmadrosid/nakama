import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as core from "@nakama/core";
import { getProfileArtifactsDir, writeArtifactFile } from "@nakama/core";
import { MAX_HTML_ARTIFACT_BYTES } from "@nakama/core/artifact-mime";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { setupTestConfigDir, withTestEnv } from "../../test-config-dir";
import { isPublicRouteRequest } from "../public-routes";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  setupFreshInstallSession,
  type TestBrowserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-artifact-shares-test-");

function createApp(databaseAdapter = createInMemoryDatabaseAdapter()) {
  return createMinimalHonoApp({
    agent: {
      readProfileArtifact: (
        orgId: string,
        profileId: string,
        filename: string
      ) => core.readArtifactFile({ orgId, profileId, filename }),
      writeProfileArtifact: (
        orgId: string,
        profileId: string,
        filename: string,
        content: string
      ) => writeArtifactFile({ content, filename, orgId, profileId }),
    },
    databaseAdapter,
  });
}

function saveArtifactRequest(params: {
  content: string;
  orgId: string;
  path: string;
  profileId: string;
  session: TestBrowserSession;
}): Request {
  return new Request(
    `http://localhost:4310/v1/profiles/${params.profileId}/artifacts/content?path=${encodeURIComponent(params.path)}`,
    {
      body: JSON.stringify({ content: params.content }),
      headers: params.session.headers(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": params.session.csrfToken,
        },
        params.orgId
      ),
      method: "PUT",
    }
  );
}

async function seedProfileArtifact(params: {
  content: string;
  databaseAdapter: DatabaseAdapter;
  filename: string;
  meta?: string;
  name: string;
  orgId: string;
  profileId: string;
}): Promise<string> {
  const now = new Date().toISOString();
  await params.databaseAdapter.upsertProfile({
    createdAt: now,
    id: params.profileId,
    isSuper: false,
    model: "openrouter/auto",
    name: params.name,
    orgId: params.orgId,
    systemPrompt: "test",
    updatedAt: now,
  });

  const artifactsDir = getProfileArtifactsDir(params.orgId, params.profileId);
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, params.filename), params.content);

  if (params.meta !== undefined) {
    await writeFile(
      join(artifactsDir, `${params.filename}.nakama-meta.json`),
      params.meta
    );
  }

  return now;
}

function publishArtifactShareRequest(params: {
  body: core.PublishArtifactShareRequest;
  host?: string;
  orgId: string;
  profileId: string;
  session: TestBrowserSession;
}): Request {
  return new Request(
    `http://${params.host ?? "localhost"}:4310/v1/profiles/${params.profileId}/artifacts/shares`,
    {
      body: JSON.stringify(params.body),
      headers: params.session.headers(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": params.session.csrfToken,
        },
        params.orgId
      ),
      method: "POST",
    }
  );
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

    await seedProfileArtifact({
      content: "# Shared report",
      databaseAdapter,
      filename: "report.md",
      name: "Share Test",
      orgId,
      profileId,
    });

    const publishResponse = await app.fetch(
      publishArtifactShareRequest({
        body: { path: "report.md" },
        orgId,
        profileId,
        session,
      })
    );

    expect(publishResponse.status).toBe(201);

    // SAFETY: This test controls the fixture shape at this boundary.
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

    // Minimal bytes; MIME comes from filename when sidecar is missing/generic.
    await seedProfileArtifact({
      content: "fake-mp4-bytes",
      databaseAdapter,
      filename: "clip.mp4",
      meta: JSON.stringify({
        mimeType: "application/octet-stream",
        savedAt: now,
        sizeBytes: 13,
      }),
      name: "Share Video",
      orgId,
      profileId,
    });

    const publishResponse = await app.fetch(
      publishArtifactShareRequest({
        body: { path: "clip.mp4" },
        orgId,
        profileId,
        session,
      })
    );

    expect(publishResponse.status).toBe(201);
    // SAFETY: This test controls the fixture shape at this boundary.
    const published = (await publishResponse.json()) as { token: string };

    const metaResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(published.token)}?meta=1`
      )
    );

    expect(metaResponse.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
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
    expect(new Uint8Array(await publicResponse.arrayBuffer())).toEqual(
      new TextEncoder().encode("fake-mp4-bytes")
    );
  });

  test("HTML downloads use the frame policy and oversized HTML cannot be published", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_html";
    const content = "x".repeat(MAX_HTML_ARTIFACT_BYTES);
    await seedProfileArtifact({
      content,
      databaseAdapter,
      filename: "page.html",
      name: "HTML page",
      orgId,
      profileId,
    });
    const artifactUrl = `http://localhost:4310/v1/profiles/${profileId}/artifacts/content?path=page.html&inline=1`;

    const response = await app.fetch(
      new Request(artifactUrl, { headers: session.headers({}, orgId) })
    );

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(
      MAX_HTML_ARTIFACT_BYTES
    );

    const frame = await app.fetch(
      new Request("http://localhost:4310/artifact-frame")
    );

    expect(response.headers.get("Content-Security-Policy")).toBe(
      frame.headers.get("Content-Security-Policy")
    );
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=()"
    );

    const publish = () =>
      app.fetch(
        publishArtifactShareRequest({
          body: { path: "page.html" },
          orgId,
          profileId,
          session,
        })
      );

    const publishedResponse = await publish();
    expect(publishedResponse.status).toBe(201);
    const published = await publishedResponse.json();

    const publicResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${published.token}`
      )
    );

    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect((await publicResponse.arrayBuffer()).byteLength).toBe(
      MAX_HTML_ARTIFACT_BYTES
    );
    await writeFile(
      join(getProfileArtifactsDir(orgId, profileId), "page.html"),
      `${content}x`
    );
    expect(
      (
        await app.fetch(
          new Request(artifactUrl, { headers: session.headers({}, orgId) })
        )
      ).status
    ).toBe(413);
    expect((await publish()).status).toBe(413);

    const share = await databaseAdapter.getActiveArtifactShareByPath(
      orgId,
      profileId,
      "page.html"
    );

    await writeFile(share!.storagePath, `${content}x`);
    expect(
      (
        await app.fetch(
          new Request(
            `http://localhost:4310/v1/public/artifact-shares/${published.token}`
          )
        )
      ).status
    ).toBe(413);
  });

  test("publish refuses a clientOrigin off the request host", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_origin";

    await seedProfileArtifact({
      content: "hello",
      databaseAdapter,
      filename: "note.md",
      name: "Share Origin",
      orgId,
      profileId,
    });

    const publishResponse = await app.fetch(
      publishArtifactShareRequest({
        body: {
          clientOrigin: "https://nakama.example.com/",
          path: "note.md",
        },
        host: "127.0.0.1",
        orgId,
        profileId,
        session,
      })
    );

    // The origin ends up in the share link, so an unconfigured install takes
    // it only from loopback or the host the request arrived on.
    expect(publishResponse.status).toBe(400);
    await expect(publishResponse.json()).resolves.toEqual({
      error: "Origin is not allowed.",
    });
  });

  test("publish prefers configured web public URL over loopback request URL", async () => {
    await withTestEnv(
      { NAKAMA_WEB_PUBLIC_URL: "https://deployed.example.com/" },
      async () => {
        const { app, databaseAdapter } = createApp();
        const session = await setupFreshInstallSession(app, databaseAdapter);
        const orgId = session.orgId!;
        const profileId = "profile_share_env";

        await seedProfileArtifact({
          content: "hello",
          databaseAdapter,
          filename: "note.md",
          name: "Share Env",
          orgId,
          profileId,
        });

        const publishResponse = await app.fetch(
          publishArtifactShareRequest({
            body: { path: "note.md" },
            host: "127.0.0.1",
            orgId,
            profileId,
            session,
          })
        );

        expect(publishResponse.status).toBe(201);

        // SAFETY: This test controls the fixture shape at this boundary.
        const published = (await publishResponse.json()) as {
          shareUrl: string | null;
          webPublicUrlConfigured: boolean;
        };

        expect(published.shareUrl).toMatch(
          /^https:\/\/deployed\.example\.com\/s\//
        );
        expect(published.webPublicUrlConfigured).toBe(true);
      }
    );
  });

  test("editing a shared artifact refreshes what the public link serves", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_edit";

    await seedProfileArtifact({
      content: "# Draft\n",
      databaseAdapter,
      filename: "script.md",
      name: "Share Edit",
      orgId,
      profileId,
    });

    const publishResponse = await app.fetch(
      publishArtifactShareRequest({
        body: { path: "script.md" },
        orgId,
        profileId,
        session,
      })
    );

    expect(publishResponse.status).toBe(201);
    // SAFETY: This test controls the fixture shape at this boundary.
    const { token } = (await publishResponse.json()) as { token: string };

    const saveResponse = await app.fetch(
      saveArtifactRequest({
        content: "# Draft\n\nEdited by hand.\n",
        orgId,
        path: "script.md",
        profileId,
        session,
      })
    );

    expect(saveResponse.status).toBe(200);

    const shareResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(token)}`
      )
    );

    expect(await shareResponse.text()).toBe("# Draft\n\nEdited by hand.\n");
  });

  test("refreshes the share when the dashboard saves by absolute path", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_abs";

    await seedProfileArtifact({
      content: "# Draft\n",
      databaseAdapter,
      filename: "script.md",
      name: "Share Abs",
      orgId,
      profileId,
    });

    const publishResponse = await app.fetch(
      publishArtifactShareRequest({
        body: { path: "script.md" },
        orgId,
        profileId,
        session,
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const { token } = (await publishResponse.json()) as { token: string };

    // The artifacts list hands the dashboard absolute paths, so a save arrives
    // under a different string than the share was published with.
    const saveResponse = await app.fetch(
      saveArtifactRequest({
        content: "# Draft\n\nSaved from the dashboard.\n",
        orgId,
        path: join(getProfileArtifactsDir(orgId, profileId), "script.md"),
        profileId,
        session,
      })
    );

    expect(saveResponse.status).toBe(200);

    const shareResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(token)}`
      )
    );

    expect(await shareResponse.text()).toBe(
      "# Draft\n\nSaved from the dashboard.\n"
    );
  });

  test("failed snapshot replacement preserves the public share", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profileId = "profile_share_replace_fail";

    await seedProfileArtifact({
      content: "# Original share\n",
      databaseAdapter,
      filename: "report.md",
      name: "Share Replace Fail",
      orgId,
      profileId,
    });

    const publishResponse = await app.fetch(
      publishArtifactShareRequest({
        body: { path: "report.md" },
        orgId,
        profileId,
        session,
      })
    );

    expect(publishResponse.status).toBe(201);
    // SAFETY: This test controls the fixture shape at this boundary.
    const { token } = (await publishResponse.json()) as { token: string };

    const writeSpy = spyOn(
      core,
      "writeArtifactShareSnapshot"
    ).mockImplementation(async (input) => {
      expect(input.filename).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-report\.md$/i
      );
      throw new Error("simulated snapshot write failure");
    });

    try {
      const saveResponse = await app.fetch(
        saveArtifactRequest({
          content: "# Original share\n\nShould not replace.\n",
          orgId,
          path: "report.md",
          profileId,
          session,
        })
      );

      expect(saveResponse.status).toBeGreaterThanOrEqual(500);

      const shareResponse = await app.fetch(
        new Request(
          `http://localhost:4310/v1/public/artifact-shares/${encodeURIComponent(token)}`
        )
      );

      expect(shareResponse.status).toBe(200);
      expect(await shareResponse.text()).toBe("# Original share\n");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
