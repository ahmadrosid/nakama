import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-web-public-url-test-");

describe("web public url settings", () => {
  test("org admin can read and persist the public web URL", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const getResponse = await app.fetch(
      new Request("http://localhost:4310/v1/system/web-public-url", {
        headers: session.headers({}, session.orgId),
      })
    );
    expect(getResponse.status).toBe(200);
    const initial = (await getResponse.json()) as {
      webPublicUrl: string | null;
    };
    expect(initial.webPublicUrl).toBeNull();

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/system/web-public-url", {
        body: JSON.stringify({
          webPublicUrl: "https://app.example.com/setup",
        }),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          session.orgId
        ),
        method: "PUT",
      })
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as { webPublicUrl: string };
    expect(saved.webPublicUrl).toBe("https://app.example.com/setup");

    const getAfterSave = await app.fetch(
      new Request("http://localhost:4310/v1/system/web-public-url", {
        headers: session.headers({}, session.orgId),
      })
    );
    const afterSave = (await getAfterSave.json()) as {
      webPublicUrl: string | null;
    };
    expect(afterSave.webPublicUrl).toBe("https://app.example.com/setup");

    const headerAttempt = await app.fetch(
      new Request("http://localhost:4310/v1/system/web-public-url", {
        body: JSON.stringify({}),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            Origin: "https://evil.example",
            "X-CSRF-Token": session.csrfToken,
          },
          session.orgId
        ),
        method: "PUT",
      })
    );
    expect(headerAttempt.status).toBe(400);

    const afterAttempt = await app.fetch(
      new Request("http://localhost:4310/v1/system/web-public-url", {
        headers: session.headers({}, session.orgId),
      })
    );
    expect(
      ((await afterAttempt.json()) as { webPublicUrl: string | null })
        .webPublicUrl
    ).toBe("https://app.example.com/setup");
  });
});
