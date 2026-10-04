import { describe, expect, test } from "bun:test";
import { resolveComposioCallbackBaseUrl } from "../services/composio-callback-url";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
  setupFreshInstallSession,
  type TestBrowserSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-web-public-url-test-");

const API_URL = "http://localhost:4310/v1/system/web-public-url";

function putRequest(
  session: TestBrowserSession,
  body: unknown,
  orgId?: string,
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request(API_URL, {
    body: JSON.stringify(body),
    headers: session.headers(
      {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
        ...extraHeaders,
      },
      orgId
    ),
    method: "PUT",
  });
}

function readSavedBaseUrl(
  app: { fetch: typeof fetch },
  session: TestBrowserSession,
  orgId?: string
): Promise<string | null> {
  return app
    .fetch(new Request(API_URL, { headers: session.headers({}, orgId) }))
    .then(async (response) => {
      expect(response.status).toBe(200);
      return ((await response.json()) as { webPublicUrl: string | null })
        .webPublicUrl;
    });
}

describe("web public url settings", () => {
  test("platform admin can read and persist the deployment's public web URL", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    expect(await readSavedBaseUrl(app, session)).toBeNull();

    const putResponse = await app.fetch(
      putRequest(
        session,
        { webPublicUrl: "http://localhost:4310" },
        session.orgId
      )
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as { webPublicUrl: string };
    expect(saved.webPublicUrl).toBe("http://localhost:4310");
    expect(await readSavedBaseUrl(app, session)).toBe("http://localhost:4310");

    const headerAttempt = await app.fetch(
      putRequest(session, {}, session.orgId, { Origin: "https://evil.example" })
    );
    expect(headerAttempt.status).toBe(400);
    expect(await readSavedBaseUrl(app, session)).toBe("http://localhost:4310");
  });

  test("a host other than the deployment's own origin is refused", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const foreign = await app.fetch(
      putRequest(
        session,
        { webPublicUrl: "https://attacker.example" },
        session.orgId
      )
    );
    expect(foreign.status).toBe(400);
    expect(await readSavedBaseUrl(app, session)).toBeNull();

    // The origin the request was forwarded to is the deployment's own.
    const forwarded = await app.fetch(
      putRequest(
        session,
        { webPublicUrl: "https://nakama.example.com" },
        session.orgId,
        {
          "X-Forwarded-Host": "nakama.example.com",
          "X-Forwarded-Proto": "https",
        }
      )
    );
    expect(forwarded.status).toBe(200);
    expect(await readSavedBaseUrl(app, session)).toBe(
      "https://nakama.example.com"
    );
  });

  test("an org admin cannot rewrite the install-wide callback base", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "acme-admin@example.com",
      orgId: "org_acme",
      userId: "user_acme_admin",
    });
    const adminSession = await loginUserSession(
      app,
      "acme-admin@example.com",
      "password123",
      "org_acme"
    );

    const toAttacker = await app.fetch(
      putRequest(
        adminSession,
        { webPublicUrl: "https://attacker.example" },
        "org_acme"
      )
    );
    expect(toAttacker.status).toBe(403);

    // The origin allowlist is not the boundary: a value the deployment would
    // happily store is still refused for an org admin.
    const toOwnOrigin = await app.fetch(
      putRequest(
        adminSession,
        { webPublicUrl: "http://localhost:4310" },
        "org_acme"
      )
    );
    expect(toOwnOrigin.status).toBe(403);

    // The base an OAuth callback is built from still points at the deployment
    // rather than the attacker's host, and nothing was persisted.
    expect(
      resolveComposioCallbackBaseUrl({
        request: new Request("http://localhost:4310/v1/composio/callback"),
      })
    ).toBe("http://localhost:4310");

    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    expect(await readSavedBaseUrl(app, platformSession, "org_acme")).toBeNull();
    expect(
      (
        await app.fetch(
          new Request(API_URL, {
            headers: adminSession.headers({}, "org_acme"),
          })
        )
      ).status
    ).toBe(403);
  });
});
