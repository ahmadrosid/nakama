import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../services/agent-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import { setupFreshInstallSession } from "./test-session-helpers";

setupTestConfigDir("nakama-email-route-");

describe("email settings routes", () => {
  test("org admin can read and update email settings without exposing password", async () => {
    const databaseAdapter = createInMemoryDatabaseAdapter();
    const { app } = createMinimalHonoApp({
      agent: new AgentService(null, null, databaseAdapter),
      databaseAdapter,
    });

    const session = await setupFreshInstallSession(app, databaseAdapter);

    const getEmpty = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      })
    );
    expect(getEmpty.status).toBe(200);
    const emptyBody = (await getEmpty.json()) as Record<string, unknown>;
    expect(emptyBody.configured).toBe(false);
    expect("password" in emptyBody).toBe(false);

    const putResponse = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        body: JSON.stringify({
          from: "admin@example.com",
          imapHost: "imap.example.com",
          password: "secret-pass",
          smtpHost: "smtp.example.com",
          username: "admin@example.com",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(putResponse.status).toBe(200);
    const saved = (await putResponse.json()) as {
      configured: boolean;
      passwordMasked: string | null;
    };
    expect(saved.configured).toBe(true);
    expect(saved.passwordMasked).not.toBe("secret-pass");

    const putWithoutPassword = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        body: JSON.stringify({
          smtpHost: "smtp2.example.com",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      })
    );
    expect(putWithoutPassword.status).toBe(200);

    const getSaved = await app.fetch(
      new Request("http://localhost:4310/v1/settings/email", {
        headers: session.headers(),
      })
    );
    const savedBody = (await getSaved.json()) as {
      smtpHost: string | null;
      passwordMasked: string | null;
    };
    expect(savedBody.smtpHost).toBe("smtp2.example.com");
    expect(savedBody.passwordMasked).toBeTruthy();
  });
});
