import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProfileArtifactsDir } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { isPublicRouteRequest } from "../public-routes";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  setupFreshInstallSession,
  type TestBrowserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-artifact-shares-test-");

function createApp(databaseAdapter = createInMemoryDatabaseAdapter()) {
  return createMinimalHonoApp({
    agent: {},
    databaseAdapter,
  });
}

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> {
  const previous = new Map(
    Object.keys(vars).map((key) => [key, process.env[key]] as const)
  );
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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
  body: Record<string, unknown>;
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

  test("publish prefers clientOrigin over loopback request URL", async () => {
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

    expect(publishResponse.status).toBe(201);
    const published = (await publishResponse.json()) as {
      shareUrl: string | null;
      webPublicUrlConfigured: boolean;
    };
    expect(published.shareUrl).toMatch(/^https:\/\/nakama\.example\.com\/s\//);
    expect(published.webPublicUrlConfigured).toBe(true);
  });

  test("publish prefers configured web public URL over loopback request URL", async () => {
    await withEnv(
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
});
